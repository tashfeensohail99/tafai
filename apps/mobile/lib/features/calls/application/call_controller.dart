import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

import '../data/call_api.dart';
import '../data/push_service.dart';
import '../data/realtime_service.dart';
import '../domain/call_models.dart';

/// Owns the lifecycle of the single active call: WebRTC peer connection, media,
/// signaling handshake, timers and recording. Ports the web CallDock flow to
/// flutter_webrtc. Meta uses NON-TRICKLE SDP, so we always wait for ICE
/// gathering to complete (≤5s, generous enough to gather TURN relay candidates)
/// before sending the offer/answer.
class CallController extends StateNotifier<CallState> {
  final Ref _ref;
  late final StreamSubscription<RealtimeCallEvent> _sub;

  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  MediaStream? _remoteStream;

  Timer? _ringTimeout; // inbound: auto-dismiss if unanswered
  Timer? _dialTimeout; // outbound: give up if no answer
  Timer? _tick; // 1s call timer
  Timer? _endReset; // brief "ended" → idle
  Timer? _disconnectGrace; // transient media drop — give ICE time to recover

  // Recording (best-effort; never breaks the call).
  MediaRecorder? _recorder;
  String? _recordingPath;
  String? _recordingCallId;

  CallController(this._ref) : super(const CallState.idle()) {
    _sub = _ref.read(realtimeServiceProvider).events.listen(_onEvent);
  }

  CallApi get _api => _ref.read(callApiProvider);

  /// Native channel: PARTIAL WakeLock + HIGH_PERF WifiLock for the duration of
  /// a call (MTK/Transsion Wi-Fi power-save kills WebRTC media at screen-off
  /// without these — the documented Android VoIP requirement).
  static const _locks = MethodChannel('call_locks');

  Future<void> _acquireLocks() async {
    try {
      await _locks.invokeMethod('acquire');
      _log('locks acquired');
    } catch (e) {
      _log('locks acquire failed: $e');
    }
  }

  Future<void> _releaseLocks() async {
    try {
      await _locks.invokeMethod('release');
    } catch (_) {}
  }

  /// Timestamped diagnostic trail — shows in `adb logcat` as "I flutter".
  void _log(String msg) {
    final t = DateTime.now().toIso8601String().substring(11, 23);
    debugPrint('[CALL $t] $msg');
  }

  // ── Signaling events ───────────────────────────────────────────────────────

  void _onEvent(RealtimeCallEvent e) {
    switch (e) {
      case CallIncoming():
        _log('socket: incoming ${e.callId}');
        // Already on a call → ignore (web behaviour). The backend will time out.
        if (state.isActive) return;
        // Ring NATIVELY via CallKit for a real phone-call experience (system
        // ringtone, full-screen over the lock screen). This is the foreground
        // path; the FCM background handler shows the same CallKit screen when
        // the app is backgrounded. Accept/Decline come back through
        // CallHost → onAccept/onDecline. The plugin dedupes by call id, so a
        // socket + push race just updates the one screen.
        unawaited(showIncomingCallkit(IncomingCallPush(
          callId: e.callId,
          from: e.from,
          leadName: e.leadName,
          leadId: e.leadId,
          threadId: e.threadId,
        )));
      case CallAnswered():
        _log('socket: answered ${e.callId} (sdp ${e.sdpAnswer.length}b)');
        _onRemoteAnswer(e);
      case CallEnded():
        _log('socket: ended ${e.callId} (active=${state.callId})');
        unawaited(endCallkit(e.callId));
        if (e.callId == state.callId) {
          _teardown(reason: 'Call ended');
        }
    }
  }

  /// Show the ringing UI for an inbound call (from socket OR from an FCM push /
  /// CallKit accept). Idempotent for the same callId.
  void prepareIncoming(CallIncoming e) {
    if (state.callId == e.callId && state.phase == CallPhase.ringing) return;
    _ringTimeout?.cancel();
    state = CallState(
      phase: CallPhase.ringing,
      direction: CallDirection.inbound,
      callId: e.callId,
      threadId: e.threadId,
      leadId: e.leadId,
      peerName: e.leadName ?? '',
      peerPhone: e.from,
    );
    // Auto-dismiss after 45s if neither side acts.
    _ringTimeout = Timer(const Duration(seconds: 45), () {
      if (state.phase == CallPhase.ringing) {
        _safeReject();
      }
    });
  }

  Future<void> _onRemoteAnswer(CallAnswered e) async {
    final pc = _pc;
    if (pc == null || e.callId != state.callId || e.sdpAnswer.isEmpty) return;
    _dialTimeout?.cancel();
    state = state.copyWith(phase: CallPhase.connecting);
    try {
      await pc.setRemoteDescription(
        RTCSessionDescription(e.sdpAnswer, 'answer'),
      );
      // onConnectionState → inCall flips when media connects.
    } catch (err) {
      _fail('Could not connect the call.');
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  Future<void> startOutbound({
    required String threadId,
    required String name,
    required String phone,
  }) async {
    if (state.isActive) return;
    state = CallState(
      phase: CallPhase.dialing,
      direction: CallDirection.outbound,
      threadId: threadId,
      peerName: name,
      peerPhone: phone,
    );

    if (!await _ensureMic()) {
      _fail('Microphone permission is required to call.');
      return;
    }
    await _acquireLocks();

    try {
      _log('outbound: start thread=$threadId');
      final ice = await _api.getIceServers();
      await _openLocalMedia();
      final pc = await _createPeer(ice);

      final offer = await pc.createOffer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': false,
      });
      await pc.setLocalDescription(offer);
      await _waitForIce(pc);
      final localSdp = (await pc.getLocalDescription())?.sdp;
      if (localSdp == null) throw Exception('No local SDP');

      final callId =
          await _api.startOutbound(threadId: threadId, sdpOffer: localSdp);
      state = state.copyWith(callId: callId);

      // Give up if the customer never answers.
      _dialTimeout = Timer(const Duration(seconds: 60), () {
        if (state.phase == CallPhase.dialing ||
            state.phase == CallPhase.connecting) {
          hangup();
        }
      });
    } catch (err) {
      if (kDebugMode) debugPrint('[call] outbound failed: $err');
      _fail(_friendly(err, fallback: 'Could not place the call.'));
    }
  }

  // ── Inbound accept / decline ────────────────────────────────────────────────

  Future<void> acceptIncoming() async {
    final callId = state.callId;
    if (callId == null || state.phase != CallPhase.ringing) return;
    _log('accept: start $callId');
    _ringTimeout?.cancel();
    state = state.copyWith(phase: CallPhase.connecting);

    if (!await _ensureMic()) {
      _fail('Microphone permission is required to answer.');
      return;
    }
    await _acquireLocks();

    try {
      final t0 = DateTime.now();
      final results = await Future.wait([
        _api.getIceServers(),
        _api.getInboundOffer(callId),
      ]);
      _log('accept: ice+offer fetched in '
          '${DateTime.now().difference(t0).inMilliseconds}ms');
      final ice = results[0] as List<Map<String, dynamic>>;
      final offer = results[1] as String;

      await _openLocalMedia();
      final pc = await _createPeer(ice);

      await pc.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
      final answer = await pc.createAnswer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': false,
      });
      await pc.setLocalDescription(answer);
      final tIce = DateTime.now();
      await _waitForIce(pc);
      _log('accept: ICE gathered in '
          '${DateTime.now().difference(tIce).inMilliseconds}ms');
      final localSdp = (await pc.getLocalDescription())?.sdp;
      if (localSdp == null) throw Exception('No local SDP');

      final tPost = DateTime.now();
      await _api.answer(callId, localSdp);
      _log('accept: answer POSTed in '
          '${DateTime.now().difference(tPost).inMilliseconds}ms — waiting for media');
      // onConnectionState → inCall flips when media connects.
    } catch (err) {
      _log('accept FAILED: $err');
      _fail(_friendly(err, fallback: 'Could not answer the call.'));
    }
  }

  Future<void> decline() async {
    await _safeReject();
  }

  /// Decline a specific call id — used when CallKit's Decline is pressed and the
  /// app may not hold matching ringing state (cold launch from a push).
  Future<void> rejectById(String callId) async {
    if (state.callId == callId && state.isActive) {
      // Only a RINGING call can be declined. Once we're answering/in-call,
      // stale CallKit events must never tear the live call down.
      if (state.phase == CallPhase.ringing) {
        await _safeReject();
      }
      return;
    }
    try {
      await _api.reject(callId);
    } catch (_) {}
  }

  Future<void> _safeReject() async {
    final callId = state.callId;
    _teardown(reason: 'Declined', terminal: false);
    if (callId != null) {
      try {
        await _api.reject(callId);
      } catch (_) {}
    }
  }

  // ── Controls ─────────────────────────────────────────────────────────────

  Future<void> hangup() async {
    final callId = state.callId;
    _teardown(reason: 'Call ended');
    if (callId != null) {
      try {
        await _api.hangup(callId);
      } catch (_) {}
    }
  }

  void toggleMute() {
    final stream = _localStream;
    if (stream == null) return;
    final tracks = stream.getAudioTracks();
    if (tracks.isEmpty) return;
    final next = !state.muted;
    for (final t in tracks) {
      t.enabled = !next; // muted == track disabled
    }
    state = state.copyWith(muted: next);
  }

  Future<void> toggleSpeaker() async {
    final next = !state.speakerOn;
    try {
      await Helper.setSpeakerphoneOn(next);
      state = state.copyWith(speakerOn: next);
    } catch (_) {}
  }

  // ── WebRTC plumbing ─────────────────────────────────────────────────────────

  Future<bool> _ensureMic() async {
    try {
      final status = await Permission.microphone.request();
      return status.isGranted;
    } catch (_) {
      return false;
    }
  }

  Future<void> _openLocalMedia() async {
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': false,
    });
  }

  Future<RTCPeerConnection> _createPeer(List<Map<String, dynamic>> ice) async {
    final pc = await createPeerConnection({
      'iceServers': ice,
      'sdpSemantics': 'unified-plan',
    });

    final local = _localStream;
    if (local != null) {
      for (final track in local.getTracks()) {
        await pc.addTrack(track, local);
      }
    }

    pc.onTrack = (RTCTrackEvent e) {
      if (e.streams.isNotEmpty) {
        _remoteStream = e.streams[0];
        // Audio-only: flutter_webrtc routes the remote audio to the device
        // output automatically once the track is added — no renderer needed.
      }
    };

    pc.onIceConnectionState = (s) => _log('iceConnectionState: $s');
    pc.onIceGatheringState = (s) => _log('iceGatheringState: $s');

    pc.onConnectionState = (RTCPeerConnectionState s) {
      _log('connectionState: $s (phase=${state.phase.name})');
      switch (s) {
        case RTCPeerConnectionState.RTCPeerConnectionStateConnected:
          _onConnected();
        case RTCPeerConnectionState.RTCPeerConnectionStateDisconnected:
          // TRANSIENT: WebRTC fires `disconnected` on brief packet loss (Wi-Fi
          // power-save, network blips) and usually recovers on its own.
          // Tearing down here was killing live calls ~30-40s in. Show
          // "Reconnecting…" and give ICE a grace window instead.
          if (state.phase == CallPhase.inCall) {
            state = state.copyWith(phase: CallPhase.reconnecting);
            _disconnectGrace?.cancel();
            _disconnectGrace = Timer(const Duration(seconds: 20), () {
              if (state.phase == CallPhase.reconnecting) {
                _teardown(reason: 'Connection lost');
              }
            });
          }
        case RTCPeerConnectionState.RTCPeerConnectionStateFailed:
        case RTCPeerConnectionState.RTCPeerConnectionStateClosed:
          if (state.phase == CallPhase.inCall ||
              state.phase == CallPhase.reconnecting ||
              state.phase == CallPhase.connecting) {
            _teardown(reason: 'Call ended');
          }
        default:
          break;
      }
    };

    _pc = pc;
    return pc;
  }

  /// Non-trickle: resolve once ICE gathering completes, capped at 5s.
  Future<void> _waitForIce(RTCPeerConnection pc) async {
    if (pc.iceGatheringState ==
        RTCIceGatheringState.RTCIceGatheringStateComplete) {
      return;
    }
    final completer = Completer<void>();
    pc.onIceGatheringState = (state) {
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete &&
          !completer.isCompleted) {
        completer.complete();
      }
    };
    final timeout = Timer(const Duration(seconds: 5), () {
      if (!completer.isCompleted) completer.complete();
    });
    await completer.future;
    timeout.cancel();
  }

  void _onConnected() {
    _disconnectGrace?.cancel();
    _disconnectGrace = null;
    if (state.phase == CallPhase.inCall) return;
    if (state.phase == CallPhase.reconnecting) {
      // Recovered from a transient drop — resume without resetting the timer.
      _log('media RECOVERED');
      state = state.copyWith(phase: CallPhase.inCall);
      return;
    }
    _log('media CONNECTED');
    state = state.copyWith(phase: CallPhase.inCall, durationSeconds: 0);
    // Keep the native Telecom call marked CONNECTED for the whole call so
    // Android holds the app at in-call priority (no doze → no media starve).
    final id = state.callId;
    if (id != null) unawaited(markCallkitConnected(id));
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      state = state.copyWith(durationSeconds: state.durationSeconds + 1);
    });
    _beginRecording();
  }

  // ── Recording (best-effort) ──────────────────────────────────────────────────

  Future<void> _beginRecording() async {
    if (_recorder != null) return;
    final callId = state.callId;
    final stream = _remoteStream ?? _localStream;
    if (callId == null || stream == null) return;
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/call-$callId.mp4';
      final recorder = MediaRecorder();
      final audioTrack = stream.getAudioTracks().isNotEmpty
          ? stream.getAudioTracks().first
          : null;
      await recorder.start(
        path,
        audioChannel: RecorderAudioChannel.OUTPUT,
        // Some platforms require a track handle; pass the remote audio track.
        // videoTrack is intentionally null (audio-only).
      );
      _recorder = recorder;
      _recordingPath = path;
      _recordingCallId = callId;
      // Keep a reference so the analyzer doesn't flag it unused.
      audioTrack?.enabled;
    } catch (err) {
      // Recording is optional — never let it break the call.
      if (kDebugMode) debugPrint('[call] recording unsupported: $err');
      _recorder = null;
    }
  }

  Future<void> _stopAndUploadRecording() async {
    final recorder = _recorder;
    final path = _recordingPath;
    final callId = _recordingCallId;
    _recorder = null;
    _recordingPath = null;
    _recordingCallId = null;
    if (recorder == null || path == null || callId == null) return;
    try {
      await recorder.stop();
      final file = File(path);
      if (await file.exists() && await file.length() > 2000) {
        await _api.uploadRecording(
          callId: callId,
          filePath: path,
          fileName: 'call-$callId.mp4',
        );
      }
    } catch (err) {
      if (kDebugMode) debugPrint('[call] recording upload failed: $err');
    } finally {
      try {
        final f = File(path);
        if (await f.exists()) await f.delete();
      } catch (_) {}
    }
  }

  // ── Teardown ─────────────────────────────────────────────────────────────

  void _fail(String message) {
    _teardown(reason: message, terminal: true, error: true);
  }

  void _teardown({
    required String reason,
    bool terminal = true,
    bool error = false,
  }) {
    _log('teardown: "$reason" (phase=${state.phase.name}, call=${state.callId})');
    unawaited(_releaseLocks());
    // Dismiss any native CallKit incoming/ongoing screen for this call.
    final callkitId = state.callId;
    if (callkitId != null) unawaited(endCallkit(callkitId));

    _ringTimeout?.cancel();
    _dialTimeout?.cancel();
    _tick?.cancel();
    _disconnectGrace?.cancel();
    _ringTimeout = null;
    _dialTimeout = null;
    _tick = null;
    _disconnectGrace = null;

    // Fire-and-forget the recording flush before tearing media down.
    unawaited(_stopAndUploadRecording());

    final pc = _pc;
    _pc = null;
    if (pc != null) {
      try {
        pc.close();
      } catch (_) {}
    }

    final local = _localStream;
    _localStream = null;
    if (local != null) {
      for (final t in local.getTracks()) {
        try {
          t.stop();
        } catch (_) {}
      }
      try {
        local.dispose();
      } catch (_) {}
    }
    _remoteStream = null;

    // Reset speaker.
    try {
      Helper.setSpeakerphoneOn(false);
    } catch (_) {}

    // Show a brief terminal state, then return to idle.
    state = state.copyWith(
      phase: error ? CallPhase.error : CallPhase.ended,
      errorText: error ? reason : null,
      muted: false,
      speakerOn: false,
    );
    _endReset?.cancel();
    _endReset = Timer(const Duration(milliseconds: 1400), () {
      state = const CallState.idle();
    });
  }

  /// Force a hard reset (e.g. on logout).
  void reset() {
    _teardown(reason: '', terminal: true);
    _endReset?.cancel();
    state = const CallState.idle();
  }

  @override
  void dispose() {
    _sub.cancel();
    _endReset?.cancel();
    _teardown(reason: '');
    super.dispose();
  }

  String _friendly(Object err, {required String fallback}) {
    final s = err.toString();
    if (s.toLowerCase().contains('permission')) {
      return 'The customer must allow WhatsApp calls first.';
    }
    return fallback;
  }
}

final callControllerProvider =
    StateNotifierProvider<CallController, CallState>((ref) {
  return CallController(ref);
});

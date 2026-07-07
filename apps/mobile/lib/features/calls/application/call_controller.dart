import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

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

  // Pre-accept warm-up (Meta early media): started when the ring shows so the
  // peer + SDP are built (mic muted) and Meta runs ICE/DTLS DURING the ring —
  // acceptIncoming() then just unmutes + answers with the same SDP. The future
  // resolves true when the warmed _pc is reusable; false = it self-cleaned and
  // accept must run the classic build.
  String? _preWarmCallId;
  Future<bool>? _preWarmFuture;
  // Last connection state of the CURRENT peer — lets the warmed accept path
  // detect "media already connected during the ring" without an async getter.
  RTCPeerConnectionState? _lastPcState;

  // Last quality-CDR sample (ICE path, RTT, jitter, loss, bytes, networkType),
  // cached so teardown can post final metrics + an end reason without needing
  // the live peer (which is being closed).
  Map<String, dynamic>? _lastCdr;

  Timer? _ringTimeout; // inbound: auto-dismiss if unanswered
  Timer? _dialTimeout; // outbound: give up if no answer
  Timer? _tick; // 1s call timer
  Timer? _endReset; // brief "ended" → idle
  Timer? _disconnectGrace; // transient media drop — give ICE time to recover
  Timer? _heartbeat; // 15s liveness ping so the backend can free a dead leg
  String? _heartbeatCallId; // snapshot so a late tick can't ping a stale call

  // Recording (best-effort; never breaks the call).
  AudioRecorder? _recorder;
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
    // Warm the media pipeline + pre-accept while the ring plays, so Accept is
    // just unmute + answer. Self-cleaning on failure → classic accept path.
    _preWarmCallId = e.callId;
    _preWarmFuture = _preWarmIncoming(e.callId);
  }

  /// Pre-accept warm-up (Meta-recommended early media). During the ring:
  /// ICE config + offer are fetched, the mic is captured MUTED, the peer +
  /// SDP answer are built, candidates gathered, and /pre-accept POSTed so
  /// Meta establishes ICE/DTLS while the phone is still ringing. The customer
  /// keeps hearing ringing (audio only flows after the real accept).
  ///
  /// Resolves true when the warmed `_pc` is reusable by acceptIncoming().
  /// On ANY failure it disposes only its own artifacts and resolves false —
  /// accept then runs the classic build exactly as before.
  Future<bool> _preWarmIncoming(String callId) async {
    bool stillRinging() =>
        state.callId == callId && state.phase == CallPhase.ringing;
    try {
      // Never pop a permission prompt over the ringing/CallKit UI — if mic
      // isn't already granted, skip; acceptIncoming's _ensureMic prompts then.
      final mic = await Permission.microphone.status;
      if (!mic.isGranted) {
        _log('preWarm: mic not yet granted — skipping');
        return false;
      }

      final t0 = DateTime.now();
      final results = await Future.wait<dynamic>([
        _api.getIceServers(),
        _api.getInboundOffer(callId),
      ]);
      if (!stillRinging()) return false;
      final ice = results[0] as List<Map<String, dynamic>>;
      final offer = results[1] as String;

      await _openLocalMedia();
      if (!stillRinging()) return false;
      // Muted until Accept — the rep hasn't answered; nothing may be sent.
      final local = _localStream;
      if (local != null) {
        for (final t in local.getAudioTracks()) {
          t.enabled = false;
        }
      }

      final pc = await _createPeer(ice);
      await pc.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
      final answer = await pc.createAnswer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': false,
      });
      await pc.setLocalDescription(answer);
      await _waitForIce(pc);
      if (!identical(pc, _pc)) return false; // torn down / replaced mid-warm
      final localSdp = (await pc.getLocalDescription())?.sdp;
      if (localSdp == null) return false;
      _log('preWarm: pipeline ready in '
          '${DateTime.now().difference(t0).inMilliseconds}ms');

      // Rep already tapped Accept mid-warm: peer is usable; skip the
      // pre-accept POST — the real answer is being sent by acceptIncoming.
      if (!stillRinging()) return identical(pc, _pc);

      // Tell Meta to start ICE/DTLS now. Best-effort: the warmed peer is
      // reusable even if this POST fails (accept still saves the build time).
      try {
        await _api.preAccept(callId, localSdp);
        _log('preWarm: pre-accept sent — media warming during ring');
      } catch (e) {
        _log('preWarm: pre-accept POST failed (soft): $e');
      }
      return true;
    } catch (e) {
      _log('preWarm FAILED (soft): $e');
      // Dispose only our own artifacts; a concurrent teardown already nulled
      // the fields, and identical() keeps us off someone else's peer.
      final pc = _pc;
      if (pc != null && state.callId == callId && state.phase == CallPhase.ringing) {
        _pc = null;
        try {
          await pc.close();
        } catch (_) {}
        final local = _localStream;
        _localStream = null;
        if (local != null) {
          for (final t in local.getTracks()) {
            try {
              t.stop();
            } catch (_) {}
          }
          try {
            await local.dispose();
          } catch (_) {}
        }
      }
      return false;
    }
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
    unawaited(_acquireLocks()); // fire-and-forget — don't serialize on it

    try {
      _log('outbound: start thread=$threadId');
      final results = await Future.wait<dynamic>([
        _api.getIceServers(),
        _openLocalMedia(),
      ]);
      final ice = results[0] as List<Map<String, dynamic>>;
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

  /// Ask the customer to allow WhatsApp calls. Meta requires this opt-in before
  /// a business can place an outbound call (an inbound call from them does not
  /// count). Throws a mapped AppError on failure so the caller can surface it.
  Future<void> requestPermission(String threadId) async {
    await _api.requestPermission(threadId);
  }

  // ── Inbound accept / decline ────────────────────────────────────────────────

  /// Re-entrancy latch: CallKit can deliver duplicate ACCEPT events; only one
  /// answer flow may ever run per call.
  bool _accepting = false;

  Future<void> acceptIncoming() async {
    final callId = state.callId;
    if (callId == null || state.phase != CallPhase.ringing) return;
    if (_accepting) {
      _log('accept: duplicate invocation ignored ($callId)');
      return;
    }
    _accepting = true;
    _log('accept: start $callId');
    _ringTimeout?.cancel();
    state = state.copyWith(phase: CallPhase.connecting);

    if (!await _ensureMic()) {
      _fail('Microphone permission is required to answer.');
      return;
    }
    unawaited(_acquireLocks()); // fire-and-forget — don't serialize on it

    try {
      // Pre-warmed path: the peer + SDP were built (and Meta pre-accepted)
      // during the ring — Accept is just unmute + answer with the SAME SDP,
      // so audio starts near-instantly.
      final warmed = (_preWarmCallId == callId && _preWarmFuture != null) &&
          await _preWarmFuture!.catchError((_) => false);
      if (warmed && _pc != null) {
        final pc = _pc!;
        final local = _localStream;
        if (local != null) {
          for (final t in local.getAudioTracks()) {
            t.enabled = true; // unmute — the rep has now actually answered
          }
        }
        final localSdp = (await pc.getLocalDescription())?.sdp;
        if (localSdp != null) {
          final tPost = DateTime.now();
          await _api.answer(callId, localSdp);
          _log('accept(warm): answer POSTed in '
              '${DateTime.now().difference(tPost).inMilliseconds}ms');
          if (_lastPcState ==
              RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
            // Media already came up during the ring — _onConnected skipped it
            // while ringing, so flip to in-call now.
            _onConnected();
          }
          // else: onConnectionState → inCall flips when media connects.
          return;
        }
        // No SDP on the warmed peer (shouldn't happen) → classic rebuild below.
        _log('accept(warm): no local SDP — falling back to classic build');
      }

      final t0 = DateTime.now();
      // Network fetches and mic capture have no ordering dependency — run
      // them concurrently to shave ~1s off connect time.
      final results = await Future.wait<dynamic>([
        _api.getIceServers(),
        _api.getInboundOffer(callId),
        _openLocalMedia(),
      ]);
      _log('accept: ice+offer+mic ready in '
          '${DateTime.now().difference(t0).inMilliseconds}ms');
      final ice = results[0] as List<Map<String, dynamic>>;
      final offer = results[1] as String;

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
    // Never leave a previous capture orphaned (open mic with no owner).
    final old = _localStream;
    _localStream = null;
    if (old != null) {
      for (final t in old.getTracks()) {
        try {
          t.stop();
        } catch (_) {}
      }
      try {
        await old.dispose();
      } catch (_) {}
    }
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': false,
    });
  }

  Future<RTCPeerConnection> _createPeer(List<Map<String, dynamic>> ice) async {
    // One live peer per controller — close any leftover before replacing it.
    final leftover = _pc;
    _pc = null;
    if (leftover != null) {
      _log('createPeer: closing leftover peer');
      try {
        await leftover.close();
      } catch (_) {}
    }
    _lastPcState = null; // fresh peer — forget the previous peer's state
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
      if (!identical(pc, _pc)) return; // stale peer — ignore
      if (e.streams.isNotEmpty) {
        _remoteStream = e.streams[0];
        // Audio-only: flutter_webrtc routes the remote audio to the device
        // output automatically once the track is added — no renderer needed.
      }
    };

    pc.onIceConnectionState = (s) => _log('iceConnectionState: $s');
    pc.onIceGatheringState = (s) => _log('iceGatheringState: $s');

    pc.onConnectionState = (RTCPeerConnectionState s) {
      // A replaced/closed peer's death throes must never tear down the live
      // call — only the CURRENT peer may drive call state.
      if (!identical(pc, _pc)) {
        _log('connectionState(STALE peer): $s — ignored');
        return;
      }
      _lastPcState = s;
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
          if (state.phase == CallPhase.ringing) {
            // A pre-accept WARM-UP peer failed before the rep answered — must
            // NOT tear down the still-live ring. Discard the dead warm peer
            // (frees the captured mic) so acceptIncoming runs the classic
            // build; keep ringing.
            _discardWarmPeer(pc);
          } else if (state.phase == CallPhase.inCall ||
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

  /// Discard a pre-accept warm-up peer that died during the ring, freeing the
  /// captured (muted) mic, so acceptIncoming falls back to the classic build.
  /// Only touches the peer if it's still the current one — never a live call's.
  void _discardWarmPeer(RTCPeerConnection pc) {
    if (!identical(pc, _pc)) return;
    _log('discarding dead warm-up peer (ring still live)');
    _pc = null;
    _lastPcState = null;
    _preWarmCallId = null;
    _preWarmFuture = null;
    try {
      pc.close();
    } catch (_) {}
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
  }

  /// Non-trickle: the SDP we send must already carry usable candidates, so we
  /// wait for ICE gathering — but not blindly. Once a TURN relay candidate has
  /// arrived and gathering has been quiet for 800ms, the SDP is good enough — go
  /// (full completion resolves even earlier when it happens). The hard cap is
  /// 12s (was 5s): on a slow link the relay candidate — a TURN round-trip plus a
  /// TLS handshake — can take longer than 5s, and cutting it short sent the
  /// answer WITHOUT the relay path, so the call stuck "connecting", connected
  /// one-way, or dropped on CGNAT/mobile networks. 12s lets the relay candidate
  /// make it in; fast links still resolve in ~1-2s via the relay-quiet path.
  Future<void> _waitForIce(RTCPeerConnection pc) async {
    if (pc.iceGatheringState ==
        RTCIceGatheringState.RTCIceGatheringStateComplete) {
      return;
    }
    final completer = Completer<void>();
    Timer? quiet;
    void done() {
      if (!completer.isCompleted) completer.complete();
    }

    var haveRelay = false;
    pc.onIceCandidate = (c) {
      final cand = c.candidate ?? '';
      if (cand.contains('typ relay')) haveRelay = true;
      if (haveRelay) {
        quiet?.cancel();
        quiet = Timer(const Duration(milliseconds: 800), done);
      }
    };
    pc.onIceGatheringState = (state) {
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete) {
        done();
      }
    };
    final timeout = Timer(const Duration(seconds: 12), done);
    await completer.future;
    timeout.cancel();
    quiet?.cancel();
    pc.onIceCandidate = null;
  }

  void _onConnected() {
    // Pre-accept warm-up: media can reach 'connected' while the phone is STILL
    // RINGING (Meta ran ICE/DTLS during the ring — by design, no audio flows
    // until the real accept). Stay on the ringing UI; acceptIncoming() flips
    // to in-call after the answer POST.
    if (state.phase == CallPhase.ringing) return;
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
    // Liveness ping so the backend sweeper can free this leg if the app dies
    // mid-call (keeps running through a 'reconnecting' grace; only teardown
    // cancels it).
    _heartbeat?.cancel();
    _heartbeatCallId = state.callId;
    _heartbeat = Timer.periodic(const Duration(seconds: 15), (_) {
      final cid = _heartbeatCallId;
      if (cid != null &&
          cid == state.callId &&
          (state.phase == CallPhase.inCall || state.phase == CallPhase.reconnecting)) {
        unawaited(_api.heartbeat(cid));
        unawaited(_postStats()); // quality CDR sample (path + network + metrics)
      }
    });
    // Capture the candidate path + network the moment media connects — the web
    // dock does the same; mobile posted NO CDR before this, so app calls were
    // invisible in the quality data (exactly the reps we most need to see).
    unawaited(_postStats());
    _beginRecording();
  }

  // ── Quality CDR (best-effort, never affects the call) ────────────────────────

  String _platform() => Platform.isIOS ? 'ios' : 'android';

  /// The rep's current network medium, for the wifi-vs-mobile-data breakdown.
  Future<String> _networkType() async {
    try {
      // connectivity_plus ≥6 returns a List (a device can be on several at once);
      // pick the most call-relevant. Never throws into the caller.
      final results = await Connectivity().checkConnectivity();
      String map(ConnectivityResult r) {
        switch (r) {
          case ConnectivityResult.wifi:
            return 'wifi';
          case ConnectivityResult.mobile:
            return 'cellular';
          case ConnectivityResult.ethernet:
            return 'ethernet';
          case ConnectivityResult.vpn:
            return 'vpn';
          case ConnectivityResult.bluetooth:
            return 'bluetooth';
          case ConnectivityResult.none:
            return 'none';
          default:
            return 'other';
        }
      }

      if (results.isEmpty) return 'none';
      // Prefer a real medium over vpn/other when several are reported.
      const pref = [
        ConnectivityResult.wifi,
        ConnectivityResult.mobile,
        ConnectivityResult.ethernet,
      ];
      for (final p in pref) {
        if (results.contains(p)) return map(p);
      }
      return map(results.first);
    } catch (_) {
      return 'unknown';
    }
  }

  /// Read a compact quality snapshot from the live peer (selected ICE path, RTT,
  /// jitter, loss, bytes) — mirrors the web dock's sampleStats — cache it, and
  /// POST it with the rep's network + platform. Fully guarded.
  Future<void> _postStats() async {
    final pc = _pc;
    final cid = state.callId;
    if (pc == null || cid == null) return;
    try {
      final snap = <String, dynamic>{};
      final reports = await pc.getStats();
      String? pairId;
      var sawTransport = false;
      for (final r in reports) {
        if (r.type == 'transport') {
          sawTransport = true;
          final sel = r.values['selectedCandidatePairId'];
          if (sel is String) pairId = sel;
        }
      }
      String? selectedLocalId;
      for (final r in reports) {
        final v = r.values;
        final isSelectedPair = r.type == 'candidate-pair' &&
            ((pairId != null && r.id == pairId) ||
                (!sawTransport &&
                    (v['nominated'] == true || v['selected'] == true) &&
                    v['state'] == 'succeeded'));
        if (isSelectedPair) {
          final rtt = v['currentRoundTripTime'];
          if (rtt is num) snap['rttMs'] = (rtt * 1000).round();
          final lc = v['localCandidateId'];
          if (lc is String) selectedLocalId = lc;
        }
        if (r.type == 'inbound-rtp' && v['kind'] == 'audio') {
          final j = v['jitter'];
          if (j is num) snap['jitterMs'] = (j * 1000).round();
          final br = v['bytesReceived'];
          if (br is num) snap['bytesReceived'] = br.round();
          final recv = (v['packetsReceived'] is num) ? (v['packetsReceived'] as num) : 0;
          final lost = (v['packetsLost'] is num) ? (v['packetsLost'] as num) : 0;
          if (recv + lost > 0) {
            snap['packetLossPct'] = ((lost / (recv + lost)) * 1000).round() / 10;
          }
        }
        if (r.type == 'outbound-rtp' && v['kind'] == 'audio') {
          final bs = v['bytesSent'];
          if (bs is num) snap['bytesSent'] = bs.round();
        }
      }
      if (selectedLocalId != null) {
        for (final r in reports) {
          if (r.type == 'local-candidate' && r.id == selectedLocalId) {
            final ct = r.values['candidateType'];
            if (ct is String) snap['iceCandidateType'] = ct;
          }
        }
      }
      snap['networkType'] = await _networkType();
      snap['clientPlatform'] = _platform();
      _lastCdr = snap; // cache for the teardown CDR
      await _api.recordStats(cid, snap);
    } catch (e) {
      _log('postStats failed (soft): $e');
    }
  }

  /// Final CDR on teardown: the last in-call metrics + freshly-sampled network +
  /// an end reason. Uses the cached sample (not the live peer, which is closing).
  void _postFinalStats(String reason) {
    final cid = state.callId;
    if (cid == null) return;
    final mapped = _mapEndReason(reason);
    // Snapshot the cached metrics SYNCHRONOUSLY — teardown nulls _lastCdr right
    // after this returns, before the async closure below resumes.
    final cached = _lastCdr;
    unawaited(() async {
      final net = await _networkType();
      await _api.recordStats(cid, {
        ...?cached,
        'networkType': net,
        'clientPlatform': _platform(),
        if (mapped != null) 'endReason': mapped,
      });
    }());
  }

  /// Map a mobile teardown reason to the backend's whitelisted endReason set;
  /// null when there's no confident match (the backend drops unknown values).
  String? _mapEndReason(String reason) {
    final r = reason.toLowerCase();
    if (r.contains('lost')) return 'reconnect-timeout';
    if (r.contains('could not') || r.contains('answer')) return 'connect-timeout';
    if (r.contains('ended')) return 'hangup';
    return null;
  }

  // ── Recording (best-effort) ──────────────────────────────────────────────────
  //
  // flutter_webrtc's MediaRecorder cannot do audio-only on Android ("not
  // implemented" — proven live), so calls produced no recordings. We record
  // through the platform recorder instead, with the VOICE_COMMUNICATION
  // source: on most devices that taps the call audio path (both sides on
  // many OEMs, at minimum the rep side everywhere). Whisper transcription on
  // the backend works the same on the resulting m4a.

  Future<void> _beginRecording() async {
    if (_recorder != null) return;
    final callId = state.callId;
    if (callId == null) return;
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/call-$callId.m4a';
      final recorder = AudioRecorder();
      await recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          numChannels: 1,
          androidConfig: AndroidRecordConfig(
            audioSource: AndroidAudioSource.voiceCommunication,
          ),
        ),
        path: path,
      );
      _recorder = recorder;
      _recordingPath = path;
      _recordingCallId = callId;
      _log('recording started');
    } catch (err) {
      // Recording is optional — never let it break the call.
      _log('recording unavailable: $err');
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
      recorder.dispose();
      final file = File(path);
      if (await file.exists() && await file.length() > 2000) {
        await _api.uploadRecording(
          callId: callId,
          filePath: path,
          fileName: 'call-$callId.m4a',
        );
        _log('recording uploaded (${await file.length()} bytes)');
      }
    } catch (err) {
      _log('recording upload failed: $err');
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
    // Final quality CDR (last metrics + fresh networkType + end reason) before
    // we tear media down. Uses the cached sample, so it doesn't need the peer.
    _postFinalStats(reason);
    _accepting = false;
    unawaited(_releaseLocks());
    // Dismiss any native CallKit incoming/ongoing screen for this call.
    final callkitId = state.callId;
    if (callkitId != null) unawaited(endCallkit(callkitId));

    _ringTimeout?.cancel();
    _dialTimeout?.cancel();
    _tick?.cancel();
    _disconnectGrace?.cancel();
    _heartbeat?.cancel();
    _ringTimeout = null;
    _dialTimeout = null;
    _tick = null;
    _disconnectGrace = null;
    _heartbeat = null;
    _heartbeatCallId = null;
    // Any warmed peer is disposed right below; forget the warm-up handle.
    _preWarmCallId = null;
    _preWarmFuture = null;
    _lastPcState = null;
    _lastCdr = null; // _postFinalStats above already snapshotted it

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

    // Audible + haptic "call ended" cue so the rep notices even with the screen
    // off / phone in a pocket — only for a call that actually connected, not a
    // missed ring or a decline.
    final wasConnected =
        state.phase == CallPhase.inCall || state.phase == CallPhase.reconnecting;
    if (!error && wasConnected) {
      try {
        HapticFeedback.heavyImpact();
        SystemSound.play(SystemSoundType.alert);
      } catch (_) {}
    }

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

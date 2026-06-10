import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';

import 'call_api.dart';

/// Payload the backend sends in an `incoming_call` FCM data message.
class IncomingCallPush {
  final String callId;
  final String from;
  final String? leadName;
  final String? leadId;
  final String? threadId;
  const IncomingCallPush({
    required this.callId,
    required this.from,
    this.leadName,
    this.leadId,
    this.threadId,
  });

  static IncomingCallPush? fromData(Map<String, dynamic> d) {
    final callId = d['callId']?.toString();
    if (callId == null || callId.isEmpty) return null;
    return IncomingCallPush(
      callId: callId,
      // Backend sends `callerPhone` (`from` is a reserved FCM data key that
      // gets the whole push rejected). `from` kept as fallback for CallKit
      // extras we wrote ourselves.
      from: (d['callerPhone'] ?? d['from'])?.toString() ?? '',
      leadName: (d['leadName']?.toString().isNotEmpty ?? false)
          ? d['leadName'].toString()
          : null,
      leadId: (d['leadId']?.toString().isNotEmpty ?? false)
          ? d['leadId'].toString()
          : null,
      threadId: (d['threadId']?.toString().isNotEmpty ?? false)
          ? d['threadId'].toString()
          : null,
    );
  }
}

/// Show the native incoming-call screen (Android Telecom/ConnectionService).
/// Safe to call from the background isolate — it touches no app state.
Future<void> showIncomingCallkit(IncomingCallPush call) async {
  final params = CallKitParams(
    id: call.callId,
    nameCaller: (call.leadName?.isNotEmpty ?? false) ? call.leadName! : call.from,
    appName: 'Tashfeen',
    handle: call.from,
    type: 0, // audio
    textAccept: 'Accept',
    textDecline: 'Decline',
    duration: 45000,
    extra: <String, dynamic>{
      'callId': call.callId,
      'from': call.from,
      'leadName': call.leadName ?? '',
      'leadId': call.leadId ?? '',
      'threadId': call.threadId ?? '',
    },
    android: const AndroidParams(
      isCustomNotification: true,
      isShowLogo: false,
      // Play the device's default ringtone for the whole ring (loops).
      ringtonePath: 'system_ringtone_default',
      backgroundColor: '#0D1B3A',
      actionColor: '#2563EB',
      incomingCallNotificationChannelName: 'Incoming WhatsApp Calls',
      // Full-screen call UI over the lock screen (like a real phone call),
      // and let it wake/turn on the screen.
      isShowFullLockedScreen: true,
      isShowCallID: true,
    ),
  );
  await FlutterCallkitIncoming.showCallkitIncoming(params);
}

Future<void> endCallkit(String callId) async {
  try {
    await FlutterCallkitIncoming.endCall(callId);
  } catch (_) {}
}

/// FCM background handler — MUST be a top-level function annotated for the
/// AOT entry-point tree-shaker. Runs in its own isolate when the app is
/// backgrounded or killed; its only job is to ring via CallKit.
@pragma('vm:entry-point')
Future<void> firebaseCallBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
  final data = message.data;
  final type = data['type']?.toString();
  if (type == 'incoming_call') {
    final call = IncomingCallPush.fromData(data);
    if (call != null) await showIncomingCallkit(call);
  } else if (type == 'call_cancelled') {
    final id = data['callId']?.toString();
    if (id != null && id.isNotEmpty) await endCallkit(id);
  }
}

/// Foreground/background FCM + CallKit wiring for incoming calls. Everything is
/// guarded so a missing Firebase config (no google-services.json yet) degrades
/// to a no-op instead of crashing — foreground calls still ring via the socket.
class CallPushService {
  CallPushService._();
  static final CallPushService instance = CallPushService._();

  bool _firebaseReady = false;
  bool _wired = false;
  StreamSubscription<CallEvent?>? _callkitSub;

  /// A CallKit "Accept" that arrived before [onAccept] was wired (cold start
  /// from the lock screen). Replayed once the app handler is ready.
  IncomingCallPush? _pendingAccept;

  /// Invoked when the user accepts a CallKit incoming screen. Wired by CallHost
  /// to hand the call to the CallController.
  void Function(IncomingCallPush call)? onAccept;

  /// Invoked when the user declines/ends from CallKit. Wired by CallHost.
  void Function(String callId)? onDecline;

  /// Call once at startup (before runApp ideally). Initializes Firebase and
  /// registers the background handler. No-op if Firebase isn't configured.
  Future<void> initEarly() async {
    // Start listening for CallKit accept/decline NOW (before runApp), so a
    // cold-start "Accept" from the lock screen is captured + buffered even
    // before the app UI mounts. Independent of Firebase.
    wire();
    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
      FirebaseMessaging.onBackgroundMessage(firebaseCallBackgroundHandler);
    } catch (e) {
      if (kDebugMode) debugPrint('[push] Firebase not configured: $e');
    }
  }

  /// Wire foreground handlers + CallKit events. Idempotent.
  void wire() {
    if (_wired) return;
    _wired = true;

    // Foreground data messages. Incoming calls in the foreground are handled by
    // the live socket → in-app overlay (avoids a double ring with CallKit), so
    // here we only honour cancellations to clear any stale native screen.
    FirebaseMessaging.onMessage.listen((m) {
      final type = m.data['type']?.toString();
      if (type == 'call_cancelled') {
        final id = m.data['callId']?.toString();
        if (id != null && id.isNotEmpty) endCallkit(id);
      }
    });

    _callkitSub?.cancel();
    _callkitSub = FlutterCallkitIncoming.onEvent.listen((event) {
      if (event == null) return;
      final body = (event.body is Map)
          ? (event.body as Map).map((k, v) => MapEntry(k.toString(), v))
          : <String, dynamic>{};
      final extra = (body['extra'] is Map)
          ? (body['extra'] as Map).map((k, v) => MapEntry(k.toString(), v))
          : <String, dynamic>{};
      final callId = (extra['callId'] ?? body['id'])?.toString();
      switch (event.event) {
        case Event.actionCallAccept:
          final call = IncomingCallPush.fromData(extra);
          if (call != null) {
            if (onAccept != null) {
              onAccept!(call);
            } else {
              // App not mounted yet (cold start from lock screen) — buffer it
              // and replay the moment CallHost wires the handler.
              _pendingAccept = call;
            }
          }
        case Event.actionCallDecline:
        case Event.actionCallTimeout:
          // Real user declines only. actionCallEnded is deliberately NOT here:
          // our own endCallkit() (dismissing the native screen right after
          // Accept, or during teardown) fires it — mapping it to a decline was
          // POSTing /reject immediately after /answer and killing the call
          // mid-setup ("call not connecting").
          if (callId != null && callId.isNotEmpty) onDecline?.call(callId);
        default:
          break;
      }
    });
  }

  /// Ask for notification permission (Android 13+) and register this device's
  /// FCM token with the backend so it can be rung.
  Future<void> registerToken(CallApi api) async {
    if (!_firebaseReady) return;
    try {
      await FirebaseMessaging.instance.requestPermission();
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) {
        await api.registerDevice(token: token, platform: 'ANDROID');
      }
      FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        api.registerDevice(token: t, platform: 'ANDROID').catchError((_) {});
      });
    } catch (e) {
      if (kDebugMode) debugPrint('[push] token register failed: $e');
    }
  }

  /// Deliver any CallKit "Accept" that arrived before [onAccept] was wired
  /// (cold start from the lock screen). Call right after setting onAccept.
  void replayPendingAccept() {
    final p = _pendingAccept;
    _pendingAccept = null;
    if (p != null) onAccept?.call(p);
  }

  /// Cold-start fallback: if the app was launched by accepting a call, that call
  /// is already active in the OS — connect straight to it (skip the home screen).
  Future<void> checkColdStartAccept() async {
    if (_pendingAccept != null) return; // the event path already has it
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      if (calls is List && calls.isNotEmpty && calls.first is Map) {
        final m =
            (calls.first as Map).map((k, v) => MapEntry(k.toString(), v));
        final extra = (m['extra'] is Map)
            ? (m['extra'] as Map).map((k, v) => MapEntry(k.toString(), v))
            : <String, dynamic>{};
        if (extra['callId'] == null && m['id'] != null) {
          extra['callId'] = m['id'];
        }
        final call = IncomingCallPush.fromData(extra);
        if (call != null) onAccept?.call(call);
      }
    } catch (_) {}
  }

  void dispose() {
    _callkitSub?.cancel();
    _callkitSub = null;
  }
}

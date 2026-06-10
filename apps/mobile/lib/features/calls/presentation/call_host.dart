import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/auth/token_storage.dart';
import '../../auth/data/auth_repository.dart';
import '../application/call_controller.dart';
import '../data/call_api.dart';
import '../data/push_service.dart';
import '../data/realtime_service.dart';
import '../domain/call_models.dart';
import 'call_overlay.dart';

/// Wraps the whole app. Keeps the signaling socket connected whenever a rep is
/// authenticated (so foreground incoming calls ring), registers the device for
/// FCM call-pushes (so backgrounded/locked calls ring via CallKit), bridges
/// CallKit accept/decline to the CallController, and mounts the [CallOverlay]
/// above every route.
class CallHost extends ConsumerStatefulWidget {
  final Widget child;
  const CallHost({super.key, required this.child});

  @override
  ConsumerState<CallHost> createState() => _CallHostState();
}

class _CallHostState extends ConsumerState<CallHost>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _wirePush();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _sync(ref.read(authControllerProvider));
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // OEMs (XOS etc.) freeze the socket while backgrounded — make sure we're
    // connected again the moment the rep comes back, or rings never arrive.
    if (state == AppLifecycleState.resumed) {
      ref.read(realtimeServiceProvider).ensureConnected();
    }
  }

  /// Fresh access token for the socket handshake. Pings /auth/me first so the
  /// API client's interceptor refreshes an expired token (and restores the
  /// persisted one on cold start) before we hand it to the gateway.
  Future<String?> _freshToken() async {
    final storage = ref.read(tokenStorageProvider);
    try {
      await ref.read(authRepositoryProvider).me();
    } catch (_) {
      // Offline or signed out — return whatever we have; the retry loop will
      // try again with backoff.
    }
    return storage.accessToken;
  }

  void _wirePush() {
    final push = CallPushService.instance;
    push.wire();
    // CallKit "Accept" → close the native screen, take over with the in-app
    // overlay, and run the WebRTC answer handshake — straight into the call,
    // no detour through the home screen.
    push.onAccept = (call) {
      final cur = ref.read(callControllerProvider);
      if (cur.isActive && cur.callId == call.callId) return; // already handling
      endCallkit(call.callId);
      final ctrl = ref.read(callControllerProvider.notifier);
      ctrl.prepareIncoming(CallIncoming(
        callId: call.callId,
        from: call.from,
        leadName: call.leadName,
        leadId: call.leadId,
        threadId: call.threadId,
      ));
      ctrl.acceptIncoming();
    };
    // CallKit "Decline" / ended / timeout → reject on the backend.
    push.onDecline = (callId) {
      ref.read(callControllerProvider.notifier).rejectById(callId);
    };
    // If the user accepted from the lock screen and the app cold-started, the
    // accept arrived before this handler existed — deliver it now so we go
    // straight into the call instead of landing on the home screen.
    push.replayPendingAccept();
    push.checkColdStartAccept();
  }

  void _sync(AuthState s) {
    final realtime = ref.read(realtimeServiceProvider);
    if (s.isAuthenticated) {
      realtime.start(_freshToken);
      // Ensure the controller is alive so it subscribes to call events.
      ref.read(callControllerProvider.notifier);
      // Register this device for high-priority call pushes (no-op until an FCM
      // key is configured in Admin → API Keys and Firebase is set up).
      CallPushService.instance.registerToken(ref.read(callApiProvider));
    } else {
      realtime.disconnect();
      ref.read(callControllerProvider.notifier).reset();
    }
  }

  @override
  Widget build(BuildContext context) {
    // React to login / logout transitions.
    ref.listen<AuthState>(authControllerProvider, (_, next) => _sync(next));

    return Stack(
      textDirection: TextDirection.ltr,
      children: [
        widget.child,
        const CallOverlay(),
      ],
    );
  }
}

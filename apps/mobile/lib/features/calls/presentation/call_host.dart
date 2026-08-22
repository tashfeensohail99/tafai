import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/auth/token_storage.dart';
import '../../../core/router/app_router.dart';
import '../../auth/data/auth_repository.dart';
import '../../whatsapp/data/whatsapp_repository.dart';
import '../../whatsapp/presentation/thread_screen.dart';
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
      if (!mounted) return;
      _sync(ref.read(authControllerProvider));
      // Replay a buffered cold-start CallKit "Accept" only AFTER the first
      // frame: the handler mutates the call provider, and Riverpod forbids
      // modifying providers while the first widget tree is still building
      // (doing it in initState red-screened the app on lock-screen accepts).
      final push = CallPushService.instance;
      push.replayPendingAccept();
      push.checkColdStartAccept();
      push.replayPendingThreadOpen();
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
    // A live call's periodic 15s heartbeat is suspended by the OS while the
    // screen is off (proximity/idle) during a call. Poke one at the pause AND
    // resume boundaries so the backend stale-call sweeper doesn't terminate a
    // call that merely went quiet for a screen-off stretch — the "turn the
    // screen back on and the call has dropped" bug.
    if (state == AppLifecycleState.resumed ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      ref.read(callControllerProvider.notifier).pokeHeartbeat();
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
      // Keep the native Telecom call ALIVE (connected) for the whole call —
      // ending it here made Android stop treating the app as in-call, so the
      // OS dozed it ~30-40s after the screen turned off and the media path
      // starved and dropped. It is ended in the controller's teardown.
      markCallkitConnected(call.callId);
      final ctrl = ref.read(callControllerProvider.notifier);
      final incoming = CallIncoming(
        callId: call.callId,
        from: call.from,
        leadName: call.leadName,
        leadId: call.leadId,
        threadId: call.threadId,
      );
      // A DIFFERENT call accepted from the CallKit screen while one is already
      // live (backgrounded call-waiting): end the current call first, then take
      // this one. Accepting straight into prepareIncoming used to overwrite the
      // live call's state and strand its media leg.
      if (cur.isActive && cur.callId != call.callId) {
        ctrl.switchToCall(incoming);
        return;
      }
      ctrl.prepareIncoming(incoming);
      ctrl.acceptIncoming();
    };
    // CallKit "Decline" / ended / timeout → reject on the backend.
    push.onDecline = (callId) {
      ref.read(callControllerProvider.notifier).rejectById(callId);
    };
    // "New WhatsApp message" notification tapped → open that chat directly.
    push.onOpenThread = (threadId) async {
      try {
        final t =
            await ref.read(whatsappRepositoryProvider).getThread(threadId);
        rootNavigatorKey.currentState?.push(
          MaterialPageRoute(builder: (_) => ThreadScreen(thread: t)),
        );
      } catch (_) {
        // Thread fetch failed (offline / signed out) — the app still opens
        // on the inbox, which is an acceptable fallback.
      }
    };
    // NOTE: the cold-start accept replay (replayPendingAccept /
    // checkColdStartAccept) is deliberately NOT here — _wirePush runs in
    // initState, mid-first-build, where call-state changes are illegal.
    // It happens in initState's post-frame callback instead.
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

    // Reset the "minimized" call flag when a call ENDS or a new one starts
    // RINGING, so the next call is shown full-screen (never stuck minimized).
    // Guarded on prev→next transitions so it doesn't fire on in-call timer ticks.
    ref.listen<CallState>(callControllerProvider, (prev, next) {
      final wasActive = prev?.isActive ?? false;
      final becameRinging =
          next.phase == CallPhase.ringing && prev?.phase != CallPhase.ringing;
      if ((wasActive && !next.isActive) || becameRinging) {
        ref.read(callMinimizedProvider.notifier).state = false;
      }
    });

    return Stack(
      textDirection: TextDirection.ltr,
      children: [
        widget.child,
        const CallOverlay(),
      ],
    );
  }
}

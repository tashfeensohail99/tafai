import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/auth/token_storage.dart';
import '../application/call_controller.dart';
import '../data/realtime_service.dart';
import 'call_overlay.dart';

/// Wraps the whole app. Keeps the signaling socket connected whenever a rep is
/// authenticated (so foreground incoming calls ring), tears it down on logout,
/// and mounts the [CallOverlay] above every route.
class CallHost extends ConsumerStatefulWidget {
  final Widget child;
  const CallHost({super.key, required this.child});

  @override
  ConsumerState<CallHost> createState() => _CallHostState();
}

class _CallHostState extends ConsumerState<CallHost> {
  @override
  void initState() {
    super.initState();
    // Sync once after first frame for the already-authenticated case.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _sync(ref.read(authControllerProvider));
    });
  }

  void _sync(AuthState s) {
    final realtime = ref.read(realtimeServiceProvider);
    if (s.isAuthenticated) {
      final token = ref.read(tokenStorageProvider).accessToken;
      if (token != null) realtime.connect(token);
      // Ensure the controller is alive so it subscribes to call events.
      ref.read(callControllerProvider.notifier);
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

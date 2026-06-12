import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../data/app_lock_controller.dart';

/// Wraps the whole app. When the app lock is enabled and the app returns from
/// the background, it covers the UI and requires biometric / device-credential
/// auth before the content is shown again (the WhatsApp "App lock" model).
class AppLockGate extends ConsumerStatefulWidget {
  final Widget child;
  const AppLockGate({super.key, required this.child});

  @override
  ConsumerState<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends ConsumerState<AppLockGate>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!ref.read(appLockEnabledProvider)) return;
    // Lock the moment we leave the foreground, so nothing is visible in the
    // app switcher or to whoever picks the phone up next.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      ref.read(appLockedProvider.notifier).state = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = ref.watch(appLockEnabledProvider);
    final locked = ref.watch(appLockedProvider);
    return Stack(
      children: [
        widget.child,
        if (enabled && locked)
          _LockScreen(
            onUnlocked: () =>
                ref.read(appLockedProvider.notifier).state = false,
          ),
      ],
    );
  }
}

/// Full-screen cover shown while locked. Auto-prompts the OS auth sheet once on
/// appear; the user can re-trigger it with the Unlock button.
class _LockScreen extends StatefulWidget {
  final VoidCallback onUnlocked;
  const _LockScreen({required this.onUnlocked});

  @override
  State<_LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<_LockScreen> {
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _unlock());
  }

  Future<void> _unlock() async {
    if (_busy) return;
    setState(() => _busy = true);
    final ok = await authenticateLock();
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) widget.onUnlocked();
  }

  @override
  Widget build(BuildContext context) {
    // Opaque navy cover — hides the underlying UI completely.
    return Material(
      color: AppTokens.brandNavy,
      child: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.lock_rounded,
                    color: Colors.white, size: 38),
              ),
              const SizedBox(height: AppTokens.space5),
              const Text(
                'Tashfeen CRM is locked',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: AppTokens.space2),
              Text(
                'Verify it’s you to continue',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.7),
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: AppTokens.space6),
              FilledButton.icon(
                onPressed: _busy ? null : _unlock,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: AppTokens.brandNavy,
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppTokens.space6, vertical: AppTokens.space3),
                ),
                icon: _busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: AppTokens.brandNavy),
                      )
                    : const Icon(Icons.fingerprint, size: 20),
                label: const Text('Unlock',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

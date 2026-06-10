import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../data/call_permissions.dart';

/// Walks the rep through granting everything the softphone needs to ring like a
/// real phone call. Used both as first-run onboarding and from the account menu
/// ("Call setup"). Re-checks status whenever the app resumes (the user returns
/// from a system settings page).
class CallSetupScreen extends ConsumerStatefulWidget {
  /// When true, shows a "Skip for now" affordance (first-run onboarding).
  final bool onboarding;
  const CallSetupScreen({super.key, this.onboarding = false});

  @override
  ConsumerState<CallSetupScreen> createState() => _CallSetupScreenState();
}

class _CallSetupScreenState extends ConsumerState<CallSetupScreen>
    with WidgetsBindingObserver {
  CallPermissionState _state = const CallPermissionState.unknown();
  bool _loading = true;
  bool _busy = false;

  CallPermissions get _perms => ref.read(callPermissionsProvider);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Returning from a system settings page → re-check.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final s = await _perms.check();
    if (mounted) {
      setState(() {
        _state = s;
        _loading = false;
      });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      await _refresh();
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enableAll() => _run(() async {
        await _perms.requestMicrophone();
        await _perms.requestNotification();
        await _perms.requestOverlay();
        await _perms.requestBattery();
        if (!_state.fullScreenIntent) {
          await _perms.requestFullScreenIntent();
        }
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        title: const Text('Call setup',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
        actions: [
          if (widget.onboarding)
            TextButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: const Text('Skip', style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(AppTokens.space4),
              children: [
                _Header(allGranted: _state.allGranted),
                const SizedBox(height: AppTokens.space4),
                _PermTile(
                  icon: Icons.mic,
                  title: 'Microphone',
                  subtitle: 'Required to talk on calls.',
                  granted: _state.microphone,
                  busy: _busy,
                  onAllow: () => _run(_perms.requestMicrophone),
                ),
                _PermTile(
                  icon: Icons.notifications_active_outlined,
                  title: 'Notifications',
                  subtitle: 'Required to show incoming calls.',
                  granted: _state.notification,
                  busy: _busy,
                  onAllow: () => _run(_perms.requestNotification),
                ),
                _PermTile(
                  icon: Icons.phonelink_ring,
                  title: 'Display over other apps',
                  subtitle:
                      'Lets a call ring full-screen over the lock screen, like a normal call.',
                  granted: _state.overlay,
                  busy: _busy,
                  onAllow: () => _run(_perms.requestOverlay),
                ),
                _PermTile(
                  icon: Icons.fullscreen,
                  title: 'Full-screen call on lock screen',
                  subtitle:
                      'Android 14+: turn ON “Full screen notifications” so a locked phone shows the ringing call, not just a small notification.',
                  granted: _state.fullScreenIntent,
                  busy: _busy,
                  onAllow: () => _run(_perms.requestFullScreenIntent),
                ),
                _PermTile(
                  icon: Icons.battery_charging_full,
                  title: 'Allow background activity',
                  subtitle:
                      'Turns off battery optimisation so calls still ring when the app is closed.',
                  granted: _state.battery,
                  busy: _busy,
                  onAllow: () => _run(_perms.requestBattery),
                ),
                _PermTile(
                  icon: Icons.restart_alt,
                  title: 'Auto-start (some phones)',
                  subtitle:
                      'On Infinix / Xiaomi / Oppo / Vivo, open settings and enable “Auto-start” so calls ring when the app is closed.',
                  granted: null, // can't be detected — manual
                  busy: _busy,
                  allowLabel: 'Open settings',
                  onAllow: () => _run(_perms.openSettings),
                ),
                const SizedBox(height: AppTokens.space4),
                SizedBox(
                  height: 50,
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _enableAll,
                    icon: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.check_circle_outline),
                    label: const Text('Enable all'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTokens.brandNavy,
                      textStyle: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                if (widget.onboarding && _state.essentialGranted) ...[
                  const SizedBox(height: AppTokens.space2),
                  SizedBox(
                    height: 48,
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      child: const Text("Done — I'm set up"),
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}

class _Header extends StatelessWidget {
  final bool allGranted;
  const _Header({required this.allGranted});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTokens.space4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadow,
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: (allGranted ? AppTokens.statusSuccess : AppTokens.brandNavy)
                  .withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            alignment: Alignment.center,
            child: Icon(
              allGranted ? Icons.verified_rounded : Icons.call,
              color: allGranted ? AppTokens.statusSuccess : AppTokens.brandNavy,
            ),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Text(
              allGranted
                  ? "You're all set — calls will ring like a normal phone call."
                  : 'Allow these so calls ring properly, even when your phone is locked.',
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.4,
                color: AppTokens.textSecondaryLight,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PermTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool? granted; // null = can't detect (manual)
  final bool busy;
  final String allowLabel;
  final VoidCallback onAllow;

  const _PermTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.granted,
    required this.busy,
    required this.onAllow,
    this.allowLabel = 'Allow',
  });

  @override
  Widget build(BuildContext context) {
    final isGranted = granted == true;
    return Container(
      margin: const EdgeInsets.only(bottom: AppTokens.space3),
      padding: const EdgeInsets.all(AppTokens.space3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadowSm,
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppTokens.brandNavy.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 20, color: AppTokens.brandNavy),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppTokens.textPrimaryLight)),
                const SizedBox(height: 2),
                Text(subtitle,
                    style: const TextStyle(
                        fontSize: 12,
                        height: 1.35,
                        color: AppTokens.textMutedLight)),
              ],
            ),
          ),
          const SizedBox(width: AppTokens.space2),
          if (isGranted)
            const Icon(Icons.check_circle, color: AppTokens.statusSuccess, size: 26)
          else
            TextButton(
              onPressed: busy ? null : onAllow,
              child: Text(allowLabel),
            ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/update/app_update.dart';
import '../../calls/presentation/call_setup_screen.dart';
import '../../security/data/app_lock_controller.dart';

/// Whether this device can do biometric / device-credential auth.
final _deviceSupportsLockProvider =
    FutureProvider<bool>((ref) => deviceSupportsLock());

/// Account + security + about screen, reachable from the home hamburger menu.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final update = ref.watch(appUpdateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: AppTokens.space4),
        children: [
          // ── Profile header ──────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space4, vertical: AppTokens.space2),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: AppTokens.brandNavyLight,
                  child: Text(
                    user?.initials ?? '?',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: AppTokens.space3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.displayName ?? 'Signed in',
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                      if (user != null)
                        Text(user.email,
                            style: const TextStyle(
                                fontSize: 13,
                                color: AppTokens.textMutedLight)),
                      if (user?.employee?.department != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            user!.employee!.department!.name,
                            style: const TextStyle(
                                fontSize: 12,
                                color: AppTokens.textMutedLight),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTokens.space4),

          // ── Security ────────────────────────────────────────────────────
          const _SectionHeader('Security'),
          const _AppLockTile(),

          const SizedBox(height: AppTokens.space4),

          // ── Updates ─────────────────────────────────────────────────────
          const _SectionHeader('App'),
          ListTile(
            leading: const Icon(Icons.system_update_outlined),
            title: const Text('Check for updates'),
            subtitle: Text(
              update.when(
                data: (s) => s.updateAvailable
                    ? 'New version ${s.latestVersion} available'
                    : 'You’re on the latest version',
                loading: () => 'Checking…',
                error: (_, __) => 'Couldn’t check right now',
              ),
            ),
            trailing: update.maybeWhen(
              data: (s) => s.updateAvailable
                  ? FilledButton(
                      onPressed: () => launchUrl(
                        Uri.parse(downloadsPageUrl),
                        mode: LaunchMode.externalApplication,
                      ),
                      child: const Text('Get it'),
                    )
                  : const Icon(Icons.check_circle_outline,
                      color: AppTokens.statusSuccess),
              orElse: () => const SizedBox.shrink(),
            ),
            onTap: () => ref.invalidate(appUpdateProvider),
          ),
          ListTile(
            leading: const Icon(Icons.call_outlined),
            title: const Text('Call setup'),
            subtitle: const Text('Permissions for incoming calls'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const CallSetupScreen()),
            ),
          ),

          const SizedBox(height: AppTokens.space4),

          // ── Account ─────────────────────────────────────────────────────
          const _SectionHeader('Account'),
          ListTile(
            leading: const Icon(Icons.lock_reset_outlined),
            title: const Text('Change password'),
            onTap: () => context.push(AppRoutes.changePassword),
          ),
          ListTile(
            leading: const Icon(Icons.logout, color: AppTokens.statusDanger),
            title: const Text('Sign out',
                style: TextStyle(color: AppTokens.statusDanger)),
            onTap: () => _confirmSignOut(context, ref),
          ),

          const SizedBox(height: AppTokens.space6),
          Center(
            child: update.maybeWhen(
              data: (s) => Text(
                'Version ${s.currentVersion}',
                style: const TextStyle(
                    fontSize: 12, color: AppTokens.textMutedLight),
              ),
              orElse: () => const SizedBox.shrink(),
            ),
          ),
          const SizedBox(height: AppTokens.space2),
          const Center(
            child: Text(
              'Tashfeen Immigration Solutions',
              style:
                  TextStyle(fontSize: 11, color: AppTokens.textDisabledLight),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You’ll need to sign in again to use the app.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: AppTokens.statusDanger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(authControllerProvider.notifier).logout();
    }
  }
}

/// The app-lock row — a switch that verifies the user before turning the lock
/// on, and is disabled with a hint on devices that can't authenticate.
class _AppLockTile extends ConsumerWidget {
  const _AppLockTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(appLockEnabledProvider);
    final supported = ref.watch(_deviceSupportsLockProvider).valueOrNull ?? true;

    return SwitchListTile(
      secondary: const Icon(Icons.fingerprint),
      title: const Text('App lock'),
      subtitle: Text(
        supported
            ? 'Require Face ID / fingerprint when reopening the app'
            : 'Set a screen lock on your phone to use this',
      ),
      value: enabled,
      onChanged: !supported
          ? null
          : (want) async {
              if (want) {
                // Verify the user can authenticate before arming the lock, so
                // they can't lock themselves out.
                final ok = await authenticateLock(
                    reason: 'Confirm it’s you to turn on App lock');
                if (ok) {
                  await ref.read(appLockEnabledProvider.notifier).set(true);
                }
              } else {
                await ref.read(appLockEnabledProvider.notifier).set(false);
              }
            },
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String label;
  const _SectionHeader(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppTokens.space4, AppTokens.space2, AppTokens.space4, AppTokens.space1),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: AppTokens.textMutedLight,
        ),
      ),
    );
  }
}

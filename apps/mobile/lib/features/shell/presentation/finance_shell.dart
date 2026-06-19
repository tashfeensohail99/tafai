import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/update/app_update.dart';
import '../../../core/update/forced_update_screen.dart';

/// Finance portal shell. Module-0 placeholder — the real tabbed shell
/// (Home / Customers / Agreements / Chat) and screens land in the Finance
/// module build. Keeps the compulsory-update gate; does NOT show the Sales
/// call-setup onboarding (calls are a Sales-only feature).
class FinanceShell extends ConsumerWidget {
  const FinanceShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final update = ref.watch(appUpdateProvider).valueOrNull;
    if (update != null && update.updateAvailable) {
      return ForcedUpdateScreen(latestVersion: update.latestVersion);
    }
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        title: const Text('Finance',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout, color: Colors.white),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Finance portal\nComing in the next build.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, color: AppTokens.textMutedLight),
          ),
        ),
      ),
    );
  }
}

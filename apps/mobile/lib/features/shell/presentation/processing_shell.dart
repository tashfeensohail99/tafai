import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/update/app_update.dart';
import '../../../core/update/forced_update_screen.dart';

/// Processing portal shell. Module-0 placeholder — the real tabbed shell
/// (Dashboard / My Cases / Documents / Tasks, + manager extras) and the case
/// workspace land in the Processing module build (the largest module). Keeps
/// the compulsory-update gate; no Sales call-setup onboarding.
class ProcessingShell extends ConsumerWidget {
  const ProcessingShell({super.key});

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
        title: const Text('Processing',
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
            'Processing portal\nComing in the next build.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, color: AppTokens.textMutedLight),
          ),
        ),
      ),
    );
  }
}

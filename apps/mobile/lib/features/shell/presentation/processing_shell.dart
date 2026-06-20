import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/navigation/shell_index.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/update/app_update.dart';
import '../../../core/update/forced_update_screen.dart';
import '../../processing/data/processing_providers.dart';
import '../../processing/presentation/shell_tabs/dashboard_tab.dart';
import '../../processing/presentation/shell_tabs/documents_queue_tab.dart';
import '../../processing/presentation/shell_tabs/intake_tab.dart';
import '../../processing/presentation/shell_tabs/manager_dashboard_tab.dart';
import '../../processing/presentation/shell_tabs/my_cases_tab.dart';
import '../../processing/presentation/shell_tabs/tasks_queue_tab.dart';

/// Processing portal shell. A bottom-nav scaffold whose tabs hold the main
/// processing work surfaces. Case workspaces are pushed as separate routes over
/// it (Navigator.push). Clones the Sales [AppShell] chrome — navy AppBar +
/// hamburger (name / email / Settings / Logout) + the compulsory-update gate —
/// but uses its own shellIndex key ('processing') so its tab state never
/// collides with Sales/Finance.
///
/// Associates see: Dashboard / My Cases / Documents / Tasks. Managers also see
/// Intake + Manager (gated on processing_manager). All manager surfaces fail
/// closed server-side, so this is purely a UX gate.
class ProcessingShell extends ConsumerWidget {
  const ProcessingShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Compulsory update gate — identical to AppShell. Fails open: renders
    // nothing until the check resolves; a flaky check resolves to "no update".
    final update = ref.watch(appUpdateProvider).valueOrNull;
    if (update != null && update.updateAvailable) {
      return ForcedUpdateScreen(latestVersion: update.latestVersion);
    }

    final user = ref.watch(currentUserProvider);
    final isManager = ref.watch(isProcessingManagerProvider);

    // Tab set depends on role — managers get the two extra surfaces.
    final tabs = <_TabDef>[
      const _TabDef('Home', Icons.home_outlined, Icons.home,
          ProcessingDashboardTab()),
      const _TabDef('My Cases', Icons.folder_outlined, Icons.folder,
          MyCasesTab(), navLabel: 'Cases'),
      const _TabDef('Documents', Icons.fact_check_outlined, Icons.fact_check,
          DocumentsQueueTab(), navLabel: 'Docs'),
      const _TabDef('Tasks', Icons.checklist_outlined, Icons.checklist,
          TasksQueueTab()),
      if (isManager) ...[
        const _TabDef('Intake', Icons.inbox_outlined, Icons.inbox, IntakeTab()),
        const _TabDef('Manager', Icons.insights_outlined, Icons.insights,
            ManagerDashboardTab(), navLabel: 'Team'),
      ],
    ];

    // Clamp the persisted index to the available tab count (it can be stale if
    // the user's role changed between launches — e.g. manager tabs disappear).
    var index = ref.watch(shellIndexProvider('processing'));
    if (index >= tabs.length) index = 0;

    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        leadingWidth: 60,
        leading: Padding(
          padding: const EdgeInsets.only(left: 10),
          child: PopupMenuButton<String>(
            tooltip: 'Menu',
            position: PopupMenuPosition.under,
            offset: const Offset(0, 6),
            child: Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppTokens.brandNavyLight,
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.30),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.menu, color: Colors.white, size: 24),
            ),
            onSelected: (value) async {
              switch (value) {
                case 'settings':
                  context.push(AppRoutes.settings);
                  break;
                case 'logout':
                  await ref.read(authControllerProvider.notifier).logout();
                  break;
              }
            },
            itemBuilder: (context) {
              return [
                PopupMenuItem<String>(
                  enabled: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '👋  ${user?.displayName ?? 'Welcome'}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (user != null)
                        Text(
                          user.email,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTokens.textMutedLight,
                          ),
                        ),
                    ],
                  ),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem<String>(
                  value: 'settings',
                  child: Row(
                    children: [
                      Icon(Icons.settings_outlined, size: 18),
                      SizedBox(width: 10),
                      Text('Settings'),
                    ],
                  ),
                ),
                const PopupMenuItem<String>(
                  value: 'logout',
                  child: Row(
                    children: [
                      Icon(Icons.logout, size: 18),
                      SizedBox(width: 10),
                      Text('Sign out'),
                    ],
                  ),
                ),
              ];
            },
          ),
        ),
        title: Text(
          tabs[index].label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: 18,
            letterSpacing: -0.3,
          ),
        ),
      ),
      body: IndexedStack(
        index: index,
        children: [for (final t in tabs) t.body],
      ),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: AppTokens.brandNavy,
          surfaceTintColor: Colors.transparent,
          indicatorColor: Colors.white.withValues(alpha: 0.16),
          height: 64,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            final selected = states.contains(WidgetState.selected);
            return TextStyle(
              fontSize: 11,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color:
                  selected ? Colors.white : Colors.white.withValues(alpha: 0.55),
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            final selected = states.contains(WidgetState.selected);
            return IconThemeData(
              color:
                  selected ? Colors.white : Colors.white.withValues(alpha: 0.55),
              size: 22,
            );
          }),
        ),
        child: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (i) {
            HapticFeedback.selectionClick();
            ref.read(shellIndexProvider('processing').notifier).state = i;
          },
          destinations: [
            for (final t in tabs)
              NavigationDestination(
                icon: Icon(t.icon),
                selectedIcon: Icon(t.selectedIcon),
                label: t.navLabel ?? t.label,
              ),
          ],
        ),
      ),
    );
  }
}

class _TabDef {
  final String label;
  final String? navLabel;
  final IconData icon;
  final IconData selectedIcon;
  final Widget body;
  const _TabDef(this.label, this.icon, this.selectedIcon, this.body,
      {this.navLabel});
}

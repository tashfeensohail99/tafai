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
import '../../finance/presentation/finance_agreements_screen.dart';
import '../../finance/presentation/finance_customers_screen.dart';
import '../../finance/presentation/finance_dashboard_screen.dart';
import '../../whatsapp/presentation/inbox_screen.dart';

/// Finance portal shell. A bottom-nav scaffold whose tabs hold the main finance
/// work surfaces (Home / Customers / Agreements / Chat). Record-detail screens
/// (customer profile, agreement review) are pushed as separate routes over it.
///
/// Clones the Sales [AppShell] chrome — navy AppBar + hamburger (name / email /
/// Settings / Logout) + the compulsory-update gate — but uses its own
/// shellIndex key ('finance') so its tab state never collides with Sales.
/// Does NOT show the Sales call-setup onboarding (calls are a Sales feature).
class FinanceShell extends ConsumerWidget {
  const FinanceShell({super.key});

  static const _tabs = <_TabDef>[
    _TabDef('Home', Icons.home_outlined, Icons.home),
    _TabDef('Customers', Icons.groups_outlined, Icons.groups),
    _TabDef('Agreements', Icons.description_outlined, Icons.description),
    _TabDef('Chat', Icons.chat_bubble_outline, Icons.chat_bubble),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Compulsory update gate — identical to AppShell. Fails open: renders
    // nothing until the check resolves; a flaky check resolves to "no update".
    final update = ref.watch(appUpdateProvider).valueOrNull;
    if (update != null && update.updateAvailable) {
      return ForcedUpdateScreen(latestVersion: update.latestVersion);
    }

    final user = ref.watch(currentUserProvider);
    final index = ref.watch(shellIndexProvider('finance'));

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
          _tabs[index].label,
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
        children: const [
          FinanceDashboardScreen(),
          FinanceCustomersScreen(),
          FinanceAgreementsScreen(),
          InboxScreen(),
        ],
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
              color: selected
                  ? Colors.white
                  : Colors.white.withValues(alpha: 0.55),
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            final selected = states.contains(WidgetState.selected);
            return IconThemeData(
              color: selected
                  ? Colors.white
                  : Colors.white.withValues(alpha: 0.55),
              size: 22,
            );
          }),
        ),
        child: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (i) {
            HapticFeedback.selectionClick();
            ref.read(shellIndexProvider('finance').notifier).state = i;
          },
          destinations: [
            for (final t in _tabs)
              NavigationDestination(
                icon: Icon(t.icon),
                selectedIcon: Icon(t.selectedIcon),
                label: t.label,
              ),
          ],
        ),
      ),
    );
  }
}

class _TabDef {
  final String label;
  final IconData icon;
  final IconData selectedIcon;
  const _TabDef(this.label, this.icon, this.selectedIcon);
}

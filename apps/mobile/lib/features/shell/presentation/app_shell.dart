import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/navigation/shell_index.dart';
import '../../../core/router/app_router.dart';
import '../../../core/settings/theme_provider.dart';
import '../../../core/theme/tokens.dart';
import '../../appointments/presentation/appointments_screen.dart';
import '../../dashboard/presentation/dashboard_screen.dart';
import '../../leads/presentation/leads_list_screen.dart';
import '../../followups/presentation/followups_screen.dart';
import '../../notifications/data/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../whatsapp/presentation/inbox_screen.dart';

/// The authenticated home: a bottom-nav scaffold whose tabs hold the main
/// work surfaces. Record-detail screens are pushed as separate routes over it.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  Timer? _pollTimer;

  static const _tabs = <_TabDef>[
    _TabDef('Home', Icons.home_outlined, Icons.home),
    _TabDef('Leads', Icons.people_alt_outlined, Icons.people_alt),
    _TabDef('Follow-ups', Icons.checklist_outlined, Icons.checklist),
    _TabDef('Appointments', Icons.event_outlined, Icons.event),
    _TabDef('Chat', Icons.chat_bubble_outline, Icons.chat_bubble),
  ];

  @override
  void initState() {
    super.initState();
    // Keep the bell badge live without sockets (FCM covers real-time later).
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      ref.invalidate(unreadCountProvider);
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _openNotifications() async {
    await Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
    if (mounted) ref.invalidate(unreadCountProvider);
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final index = ref.watch(shellIndexProvider);
    final unread = ref.watch(unreadCountProvider).valueOrNull ?? 0;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: Text(
          _tabs[index].label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: 18,
            letterSpacing: -0.3,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            icon: Badge.count(
              count: unread,
              isLabelVisible: unread > 0,
              child: const Icon(Icons.notifications_outlined, color: Colors.white),
            ),
            onPressed: _openNotifications,
          ),
          PopupMenuButton<String>(
            tooltip: 'Account',
            icon: CircleAvatar(
              radius: 14,
              backgroundColor: AppTokens.brandNavyLight,
              child: Text(
                user?.initials ?? '?',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppTokens.brandSilverText,
                ),
              ),
            ),
            onSelected: (value) async {
              switch (value) {
                case 'change-password':
                  context.push(AppRoutes.changePassword);
                  break;
                case 'dark-mode':
                  ref.read(themeModeProvider.notifier).toggle();
                  break;
                case 'logout':
                  await ref.read(authControllerProvider.notifier).logout();
                  break;
              }
            },
            itemBuilder: (context) {
              final isDark = ref.read(themeModeProvider) == ThemeMode.dark;
              return [
                PopupMenuItem<String>(
                  enabled: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.displayName ?? '',
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
                PopupMenuItem<String>(
                  value: 'dark-mode',
                  child: Row(
                    children: [
                      Icon(isDark
                          ? Icons.light_mode_outlined
                          : Icons.dark_mode_outlined,
                          size: 18),
                      const SizedBox(width: 10),
                      Text(isDark ? 'Light mode' : 'Dark mode'),
                    ],
                  ),
                ),
                const PopupMenuItem<String>(
                  value: 'change-password',
                  child: Text('Change password'),
                ),
                const PopupMenuItem<String>(
                  value: 'logout',
                  child: Text('Sign out'),
                ),
              ];
            },
          ),
          const SizedBox(width: AppTokens.space2),
        ],
      ),
      body: IndexedStack(
        index: index,
        children: const [
          DashboardScreen(),
          LeadsListScreen(),
          FollowUpsScreen(),
          AppointmentsScreen(),
          InboxScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: AppTokens.brandNavy,
          surfaceTintColor: Colors.transparent,
          indicatorColor: AppTokens.brandNavyLight,
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
          onDestinationSelected: (i) =>
              ref.read(shellIndexProvider.notifier).state = i,
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

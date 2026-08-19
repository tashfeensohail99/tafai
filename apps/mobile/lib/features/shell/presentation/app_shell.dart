import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/navigation/shell_index.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/update/app_update.dart';
import '../../../core/update/forced_update_screen.dart';
import '../../appointments/presentation/appointments_screen.dart';
import '../../calls/data/call_permissions.dart';
import '../../calls/domain/call_history.dart';
import '../../calls/presentation/call_setup_screen.dart';
import '../../calls/presentation/calls_screen.dart';
import '../../dashboard/presentation/dashboard_screen.dart';
import '../../leads/presentation/leads_list_screen.dart';
import '../../followups/presentation/followups_screen.dart';
import '../../notifications/data/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../whatsapp/presentation/inbox_screen.dart';

/// Show the first-run call-permission onboarding at most once per app launch.
bool _callSetupAutoShown = false;

/// Persisted flag: once the rep has seen the call-setup screen we never
/// auto-open it again (they can reopen it from the menu). Without this it
/// reappeared on every launch whenever a special-access permission wasn't
/// granted — which some OEM phones can't grant at all.
const String _callSetupSeenKey = 'call_setup_seen_v1';

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
    // Bottom-nav shows the singular "Appointment" so it fits on ONE line — the
    // plural was wide enough to wrap onto a second line on narrower phones,
    // knocking this tab out of vertical alignment with the others. The AppBar
    // title still uses the natural plural `label`.
    _TabDef('Appointments', Icons.event_outlined, Icons.event, navLabel: 'Appointment'),
    _TabDef('Chat', Icons.chat_bubble_outline, Icons.chat_bubble),
    _TabDef('Calls', Icons.phone_outlined, Icons.call),
  ];

  @override
  void initState() {
    super.initState();
    // Keep the bell badge live without sockets (FCM covers real-time later).
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      ref.invalidate(unreadCountProvider);
      ref.invalidate(myMissedCallCountProvider);
    });
    // First run after login: if call permissions aren't set up, walk the rep
    // through them so incoming calls ring properly. Shown at most once/launch.
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeShowCallSetup());
  }

  Future<void> _maybeShowCallSetup() async {
    if (_callSetupAutoShown || !mounted) return;
    _callSetupAutoShown = true;
    // Once the rep has seen this screen we never auto-open it again — they can
    // reopen "Call setup" from the menu. Previously it had no memory and
    // re-appeared on EVERY launch whenever a special-access permission (e.g.
    // "Display over other apps") wasn't granted, which some OEM phones can't
    // grant at all — so it nagged endlessly with no reliable way to dismiss it.
    var status = await ref.read(callPermissionsProvider).check();

    // The MICROPHONE is not like the other permissions: without it the rep
    // can't talk at all, AND the pre-accept warm-up is skipped — so every call
    // they answer falls back to the slow build path (ICE gather, up to 12s of
    // silence after tapping Accept). The "seen once" flag below deliberately
    // stops the setup SCREEN from nagging about special-access permissions
    // that some OEM phones simply cannot grant, but it must never permanently
    // suppress the one permission calls cannot work without. Ask for it on its
    // own, ahead of that flag; Android stops showing this prompt by itself once
    // the user has denied twice, so it can't turn into a nag.
    if (!status.microphone) {
      await ref.read(callPermissionsProvider).requestMicrophone();
      if (!mounted) return;
      status = await ref.read(callPermissionsProvider).check();
    }

    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_callSetupSeenKey) ?? false) return;
    if (!mounted || status.essentialGranted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const CallSetupScreen(onboarding: true)),
    );
    await prefs.setBool(_callSetupSeenKey, true);
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
    final index = ref.watch(shellIndexProvider('sales'));
    final unread = ref.watch(unreadCountProvider).valueOrNull ?? 0;
    final missedCalls = ref.watch(myMissedCallCountProvider).valueOrNull ?? 0;

    // Compulsory update gate — once a newer build is published, the app is
    // blocked until the agent installs it, so the whole team stays current.
    // Fails open: renders nothing until the check resolves, and a flaky check
    // resolves to "no update", so app launch is never blocked by the network.
    final update = ref.watch(appUpdateProvider).valueOrNull;
    if (update != null && update.updateAvailable) {
      return ForcedUpdateScreen(latestVersion: update.latestVersion);
    }

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        // Unmistakable hamburger menu on the LEFT — a shadowed, raised
        // button so it clearly reads as "tap me for the menu" (it used to be
        // a plain initials circle on the right that looked identical to the
        // dashboard's profile avatar, so nobody could tell it opened a menu).
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
          const SizedBox(width: AppTokens.space2),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: IndexedStack(
              index: index,
              children: const [
                DashboardScreen(),
                LeadsListScreen(),
                FollowUpsScreen(),
                AppointmentsScreen(),
                InboxScreen(),
                CallsScreen(),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: AppTokens.brandNavy,
          surfaceTintColor: Colors.transparent,
          indicatorColor: Colors.white.withValues(alpha: 0.16),
          height: 64,
          // Show the label only on the SELECTED tab (icon-only for the rest) —
          // frees the horizontal space so the bar holds 6+ tabs cleanly instead
          // of cramping five labels across the width.
          labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
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
            ref.read(shellIndexProvider('sales').notifier).state = i;
          },
          destinations: [
            for (final t in _tabs)
              NavigationDestination(
                icon: t.label == 'Calls' && missedCalls > 0
                    ? Badge.count(count: missedCalls, child: Icon(t.icon))
                    : Icon(t.icon),
                selectedIcon: t.label == 'Calls' && missedCalls > 0
                    ? Badge.count(count: missedCalls, child: Icon(t.selectedIcon))
                    : Icon(t.selectedIcon),
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

  /// Optional shorter label for the bottom nav (where horizontal space is
  /// tight). Falls back to [label] when null.
  final String? navLabel;
  final IconData icon;
  final IconData selectedIcon;
  const _TabDef(this.label, this.icon, this.selectedIcon, {this.navLabel});
}

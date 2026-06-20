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
import '../../../core/widgets/app_states.dart';
import '../../client/data/portal_providers.dart';
import '../../client/presentation/client_appointments_tab.dart';
import '../../client/presentation/client_case_tab.dart';
import '../../client/presentation/client_documents_tab.dart';
import '../../client/presentation/client_messages_tab.dart';
import '../../client/presentation/client_notifications_screen.dart';
import '../../client/presentation/client_profile_screen.dart';
import '../../client/presentation/client_timeline_tab.dart';

/// Client portal shell — the tabbed home for an external customer.
///
/// Clones the [FinanceShell] / [AppShell] chrome: navy AppBar + hamburger
/// (name / email / Settings / Logout) + the compulsory-update gate. Uses its
/// own shellIndex key ('client') so its tab state never collides with the
/// staff shells. No Sales call-setup onboarding (clients don't take calls).
///
/// GATING: clients carry an EMPTY permissions[] — this shell (and every screen
/// it hosts) gates purely on the 'client' ROLE, which the router already
/// enforces for /portal. We NEVER call hasPermission()/hasAnyPermission() here.
/// A client with portalAccessEnabled=false authenticates fine but gets 403 on
/// every /portal/* call; that surfaces as a ForbiddenError from
/// [portalCasesProvider], which we render as a clean "no access" state rather
/// than crashing.
class ClientShell extends ConsumerStatefulWidget {
  const ClientShell({super.key});

  @override
  ConsumerState<ClientShell> createState() => _ClientShellState();
}

class _ClientShellState extends ConsumerState<ClientShell> {
  static const _tabs = <_TabDef>[
    _TabDef('My Case', Icons.assignment_outlined, Icons.assignment),
    _TabDef('Documents', Icons.folder_outlined, Icons.folder),
    _TabDef('Messages', Icons.chat_bubble_outline, Icons.chat_bubble),
    _TabDef('Appointments', Icons.event_outlined, Icons.event,
        navLabel: 'Appts'),
    _TabDef('Timeline', Icons.timeline_outlined, Icons.timeline),
  ];

  Future<void> _openNotifications() async {
    final tabIndex = await Navigator.of(context).push<int>(
      MaterialPageRoute(builder: (_) => const ClientNotificationsScreen()),
    );
    if (!mounted) return;
    if (tabIndex != null && tabIndex >= 0 && tabIndex < _tabs.length) {
      ref.read(shellIndexProvider('client').notifier).state = tabIndex;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Compulsory update gate — identical to AppShell/FinanceShell. Fails open:
    // renders nothing until the check resolves; a flaky check → "no update".
    final update = ref.watch(appUpdateProvider).valueOrNull;
    if (update != null && update.updateAvailable) {
      return ForcedUpdateScreen(latestVersion: update.latestVersion);
    }

    final user = ref.watch(currentUserProvider);
    final index = ref.watch(shellIndexProvider('client'));
    // Resolve the active case once on shell load; tabs read the id from here.
    final casesAsync = ref.watch(portalCasesProvider);
    final activeCaseId = ref.watch(activeCaseIdProvider);

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
                case 'profile':
                  await Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const ClientProfileScreen(),
                    ),
                  );
                  break;
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
                  value: 'profile',
                  child: Row(
                    children: [
                      Icon(Icons.person_outline, size: 18),
                      SizedBox(width: 10),
                      Text('My profile'),
                    ],
                  ),
                ),
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
            icon: const Icon(Icons.notifications_outlined, color: Colors.white),
            onPressed: _openNotifications,
          ),
          const SizedBox(width: AppTokens.space2),
        ],
      ),
      body: _body(casesAsync, activeCaseId, index),
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
            ref.read(shellIndexProvider('client').notifier).state = i;
          },
          destinations: [
            for (final t in _tabs)
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

  /// The shell body. We resolve the active case at the shell level so a 403
  /// (portalAccessEnabled=false / inactive account) renders ONE clean error
  /// state instead of every tab failing independently. Once resolved, the tabs
  /// receive the active caseId and load their own data.
  Widget _body(
    AsyncValue<List<dynamic>> casesAsync,
    String? activeCaseId,
    int index,
  ) {
    return casesAsync.when(
      loading: () => const SkeletonList(),
      error: (e, _) => _ForbiddenAwareError(error: e),
      data: (_) => IndexedStack(
        index: index,
        children: [
          ClientCaseTab(caseId: activeCaseId),
          ClientDocumentsTab(caseId: activeCaseId),
          ClientMessagesTab(caseId: activeCaseId),
          const ClientAppointmentsTab(),
          ClientTimelineTab(caseId: activeCaseId),
        ],
      ),
    );
  }
}

/// A 403 (no portal access / inactive client) reads as a friendly access
/// notice; anything else falls back to the generic retryable error view.
class _ForbiddenAwareError extends ConsumerWidget {
  final Object error;
  const _ForbiddenAwareError({required this.error});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final msg = messageForError(error);
    final isForbidden = msg.toLowerCase().contains('permission') ||
        msg.toLowerCase().contains('access') ||
        msg.toLowerCase().contains('not active');
    if (isForbidden) {
      return const AppStateView(
        icon: Icons.lock_outline,
        title: 'Portal access not enabled',
        message:
            'Your client portal isn’t active yet. Please contact your '
            'consultant — they can enable access for your account.',
      );
    }
    return ErrorView(
      error: error,
      onRetry: () => ref.invalidate(portalCasesProvider),
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

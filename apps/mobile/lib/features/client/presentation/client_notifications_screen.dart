import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/portal_providers.dart';
import '../domain/portal_models.dart';
import 'portal_helpers.dart';

/// Notifications — a derived feed (unread messages, missing/rejected/expiring
/// docs, upcoming appointments, recent stage changes). Pushed as a route over
/// the ClientShell. Tapping a row pops with the tab index the notification
/// deep-links to, which the shell then switches to.
///
/// The shell tab indices: 0 = Case, 1 = Documents, 2 = Messages, 3 = Appointments.
class ClientNotificationsScreen extends ConsumerWidget {
  const ClientNotificationsScreen({super.key});

  /// Map a notification's `kind` (and the web `href` tail) to a shell tab index.
  static int tabForNotification(PortalNotification n) {
    switch (n.kind) {
      case 'UNREAD_MESSAGE':
        return 2; // Messages
      case 'MISSING_DOCUMENT':
      case 'REJECTED_DOCUMENT':
      case 'EXPIRING_DOCUMENT':
        return 1; // Documents
      case 'UPCOMING_APPOINTMENT':
        return 3; // Appointments
      case 'STAGE_CHANGE':
      default:
        return 0; // Case overview
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(portalNotificationsProvider);
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text(
          'Notifications',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
      ),
      body: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(portalNotificationsProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const EmptyView(
              icon: Icons.notifications_none,
              title: 'You’re all caught up',
              message: 'New updates about your application will appear here.',
            );
          }
          return RefreshIndicator(
            color: AppTokens.brandNavy,
            onRefresh: () => ref.refresh(portalNotificationsProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppTokens.space4),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) => _NotificationCard(
                item: items[i],
                onTap: () =>
                    Navigator.of(context).pop(tabForNotification(items[i])),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  final PortalNotification item;
  final VoidCallback onTap;
  const _NotificationCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final fg = severityColor(item.severity);
    final bg = severityBg(item.severity);
    return Material(
      color: Colors.white,
      borderRadius: const BorderRadius.all(AppTokens.radiusCard),
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        child: Container(
          decoration: const BoxDecoration(
            borderRadius: BorderRadius.all(AppTokens.radiusCard),
            boxShadow: AppTokens.cardShadowSm,
          ),
          padding: const EdgeInsets.all(AppTokens.space4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                ),
                alignment: Alignment.center,
                child: Icon(notificationIcon(item.kind), size: 18, color: fg),
              ),
              const SizedBox(width: AppTokens.space3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: const TextStyle(
                        fontSize: AppTokens.fontSizeSm,
                        fontWeight: FontWeight.w700,
                        color: AppTokens.textPrimaryLight,
                        height: 1.3,
                      ),
                    ),
                    if (item.body.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        item.body,
                        style: const TextStyle(
                          fontSize: AppTokens.fontSizeSm,
                          color: AppTokens.textMutedLight,
                          height: 1.35,
                        ),
                      ),
                    ],
                    if (item.createdAt != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        relativeTime(item.createdAt!),
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppTokens.textDisabledLight,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(Icons.chevron_right,
                  size: 18, color: AppTokens.textDisabledLight),
            ],
          ),
        ),
      ),
    );
  }
}

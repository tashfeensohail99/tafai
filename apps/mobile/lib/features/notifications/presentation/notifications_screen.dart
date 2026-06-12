import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/navigation/shell_index.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../leads/presentation/lead_detail_screen.dart';
import '../data/notifications_providers.dart';
import '../data/notifications_repository.dart';
import '../domain/app_notification.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  Future<void> _markAll() async {
    try {
      await ref.read(notificationsRepositoryProvider).markAllRead();
      ref.invalidate(notificationsListProvider);
      ref.invalidate(unreadCountProvider);
    } catch (_) {}
  }

  Future<void> _open(AppNotification n) async {
    if (n.isUnread) {
      try {
        await ref.read(notificationsRepositoryProvider).markRead(n.id);
      } catch (_) {}
      ref.invalidate(notificationsListProvider);
      ref.invalidate(unreadCountProvider);
    }
    if (!mounted) return;
    _route(n.link);
  }

  /// Deep-link the relative `link` to an in-app destination.
  void _route(String? link) {
    final l = link ?? '';
    if (l.startsWith('/sales/leads/')) {
      final id = l
          .substring('/sales/leads/'.length)
          .split('?')
          .first
          .split('/')
          .first;
      if (id.isNotEmpty) {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: id)),
        );
      }
      return;
    }
    int? tab;
    if (l.startsWith('/sales/appointments')) {
      tab = 3;
    } else if (l.startsWith('/sales/follow-ups')) {
      tab = 2;
    } else if (l.startsWith('/sales/inbox')) {
      tab = 4;
    }
    if (tab != null) {
      ref.read(shellIndexProvider.notifier).state = tab;
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationsListProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: _markAll,
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(notificationsListProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const EmptyView(
              icon: Icons.notifications_none,
              title: 'No notifications',
              message: 'Reminders, new chats and lead activity show up here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(unreadCountProvider);
              ref.invalidate(notificationsListProvider);
              await ref.read(notificationsListProvider.future);
            },
            child: ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 64),
              itemBuilder: (_, i) =>
                  _NotificationTile(n: items[i], onTap: () => _open(items[i])),
            ),
          );
        },
      ),
    );
  }
}

IconData _iconFor(String type) => switch (type) {
      'APPOINTMENT_BOOKED' || 'APPOINTMENT_REMINDER' => Icons.event_outlined,
      'FOLLOWUP_DUE' || 'FOLLOWUP_OVERDUE_DIGEST' => Icons.alarm_outlined,
      'LEAD_ASSIGNED' => Icons.person_add_alt_1,
      'AGREEMENT_APPROVED' => Icons.verified_outlined,
      'AGREEMENT_CHANGES_REQUESTED' => Icons.edit_note_outlined,
      'WHATSAPP_MESSAGE' || 'WHATSAPP_CALL' => Icons.chat_bubble_outline,
      _ => Icons.notifications_outlined,
    };

Color _colorFor(String type) => switch (type) {
      'APPOINTMENT_BOOKED' || 'APPOINTMENT_REMINDER' => AppTokens.statusInfo,
      'FOLLOWUP_DUE' || 'FOLLOWUP_OVERDUE_DIGEST' => AppTokens.statusWarning,
      'LEAD_ASSIGNED' => AppTokens.primary600,
      'AGREEMENT_APPROVED' => AppTokens.statusSuccess,
      'AGREEMENT_CHANGES_REQUESTED' => AppTokens.statusWarning,
      'WHATSAPP_MESSAGE' || 'WHATSAPP_CALL' => AppTokens.statusSuccess,
      _ => AppTokens.statusNeutral,
    };

class _NotificationTile extends StatelessWidget {
  final AppNotification n;
  final VoidCallback onTap;
  const _NotificationTile({required this.n, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final color = _colorFor(n.type);
    return InkWell(
      onTap: onTap,
      child: Container(
        color: n.isUnread ? AppTokens.primary50 : null,
        padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space4, vertical: AppTokens.space3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: color.withValues(alpha: 0.12),
              child: Icon(_iconFor(n.type), size: 18, color: color),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          n.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: t.titleSmall?.copyWith(
                              fontWeight: n.isUnread
                                  ? FontWeight.w700
                                  : FontWeight.w500),
                        ),
                      ),
                      const SizedBox(width: AppTokens.space2),
                      Text(relativeTime(n.createdAt),
                          style: t.bodySmall?.copyWith(
                              color: AppTokens.textMutedLight, fontSize: 11)),
                    ],
                  ),
                  if (n.body != null && n.body!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(n.body!,
                        style: t.bodySmall
                            ?.copyWith(color: AppTokens.textSecondaryLight)),
                  ],
                ],
              ),
            ),
            if (n.isUnread)
              Container(
                margin: const EdgeInsets.only(left: AppTokens.space2, top: 6),
                width: 9,
                height: 9,
                decoration: const BoxDecoration(
                    color: AppTokens.primary600, shape: BoxShape.circle),
              ),
          ],
        ),
      ),
    );
  }
}

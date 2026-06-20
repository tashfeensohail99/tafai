import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/portal_providers.dart';
import '../domain/portal_models.dart';

/// Activity Timeline tab — a client-safe feed of stage changes, document
/// review decisions, and officer/system messages (newest first). Internal
/// notes, tasks and officer rejection notes are filtered out server-side.
/// Body widget (no Scaffold; lives in the ClientShell IndexedStack).
class ClientTimelineTab extends ConsumerWidget {
  final String? caseId;
  const ClientTimelineTab({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = caseId;
    if (id == null) {
      return const EmptyView(
        icon: Icons.timeline_outlined,
        title: 'No activity yet',
        message:
            'Once your case is set up, its progress and updates will appear here.',
      );
    }

    final async = ref.watch(portalTimelineProvider(id));
    return async.when(
      loading: () => const SkeletonList(),
      error: (e, _) => ErrorView(
        error: e,
        onRetry: () => ref.invalidate(portalTimelineProvider(id)),
      ),
      data: (events) {
        if (events.isEmpty) {
          return const EmptyView(
            icon: Icons.timeline_outlined,
            title: 'No activity yet',
            message: 'Updates to your case will show up here as they happen.',
          );
        }
        // Backend returns ascending by time — render newest-first.
        final ordered = events.reversed.toList();
        return RefreshIndicator(
          color: AppTokens.brandNavy,
          onRefresh: () async {
            ref.invalidate(portalTimelineProvider(id));
            await ref.read(portalTimelineProvider(id).future);
          },
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space4, AppTokens.space4, AppTokens.space16),
            itemCount: ordered.length,
            itemBuilder: (_, i) => _TimelineRow(event: ordered[i]),
          ),
        );
      },
    );
  }
}

class _TimelineRow extends StatelessWidget {
  final PortalTimelineEvent event;
  const _TimelineRow({required this.event});

  (IconData, Color) get _visual {
    if (event.isStageChange) {
      return (Icons.flag_outlined, AppTokens.primary600);
    }
    if (event.isDocumentReview) {
      return event.isRejection
          ? (Icons.error_outline, AppTokens.statusWarning)
          : (Icons.check_circle_outline, AppTokens.statusSuccess);
    }
    return (Icons.chat_bubble_outline, AppTokens.statusInfo);
  }

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _visual;
    final when =
        event.createdAt != null ? relativeTime(event.createdAt!) : '';
    final sub = [
      if (event.actor != null && event.actor!.trim().isNotEmpty) event.actor!,
      if (when.isNotEmpty) when,
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space3),
      child: PremiumCard(
        padding: const EdgeInsets.all(AppTokens.space3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: const BorderRadius.all(AppTokens.radiusMd),
              ),
              alignment: Alignment.center,
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    event.description,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      height: 1.35,
                      color: AppTokens.textPrimaryLight,
                    ),
                  ),
                  if (sub.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      sub,
                      style: const TextStyle(
                          fontSize: 11.5, color: AppTokens.textMutedLight),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

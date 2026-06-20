import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';

/// Timeline tab — read-only audit trail from /processing/cases/:id/audit.
class CaseTimelineTab extends ConsumerWidget {
  final String caseId;
  const CaseTimelineTab({super.key, required this.caseId});

  static const Map<String, ({Color color, String label})> _eventStyle = {
    'CASE_CREATED': (color: AppTokens.statusInfo, label: 'Case opened'),
    'INTAKE_ACKNOWLEDGED':
        (color: AppTokens.primary600, label: 'Intake acknowledged'),
    'STAGE_CHANGED': (color: AppTokens.primary600, label: 'Stage changed'),
    'CASE_ASSIGNED': (color: AppTokens.primary600, label: 'Case assigned'),
    'CASE_PRIORITY_CHANGED':
        (color: AppTokens.statusWarning, label: 'Priority changed'),
    'DOCUMENT_ACCEPTED':
        (color: AppTokens.statusSuccess, label: 'Document accepted'),
    'DOCUMENT_REJECTED':
        (color: AppTokens.statusDanger, label: 'Document rejected'),
    'DOCUMENT_WAIVED':
        (color: AppTokens.statusNeutral, label: 'Document waived'),
    'DOCUMENT_REQUESTED':
        (color: AppTokens.statusInfo, label: 'Document requested'),
    'DOCUMENT_UPLOADED':
        (color: AppTokens.statusInfo, label: 'Document uploaded'),
    'NOTE_CREATED': (color: AppTokens.statusInfo, label: 'Note added'),
    'TASK_CREATED': (color: AppTokens.statusNeutral, label: 'Task created'),
    'TASK_UPDATED': (color: AppTokens.statusNeutral, label: 'Task updated'),
    'COMMUNICATION_SENT':
        (color: AppTokens.statusInfo, label: 'Message sent'),
    'CASE_CANCELLED':
        (color: AppTokens.statusDanger, label: 'Case cancelled'),
  };

  String _describe(CaseAuditLog e) {
    final friendly = _eventStyle[e.action]?.label ?? e.action.replaceAll('_', ' ');
    if (e.fromValue != null && e.toValue != null) {
      return '$friendly: ${e.fromValue} → ${e.toValue}';
    }
    if (e.toValue != null) return '$friendly: ${e.toValue}';
    return friendly;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseAuditProvider(caseId));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(caseAuditProvider(caseId).future),
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(
              error: e,
              onRetry: () => ref.invalidate(caseAuditProvider(caseId)),
            ),
          ),
        ]),
        data: (events) {
          if (events.isEmpty) {
            return ListView(children: const [
              Padding(
                padding: EdgeInsets.only(top: 80),
                child: EmptyView(
                  icon: Icons.history,
                  title: 'No activity yet',
                  message: 'Events appear here as the case progresses.',
                ),
              ),
            ]);
          }
          return ListView.builder(
            padding: const EdgeInsets.all(AppTokens.space4),
            itemCount: events.length,
            itemBuilder: (_, i) {
              final e = events[i];
              final style = _eventStyle[e.action];
              final color = style?.color ?? AppTokens.statusNeutral;
              final isLast = i == events.length - 1;
              final actor = e.performedBy?.display ?? 'System';
              return IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Column(
                      children: [
                        Container(
                          width: 12,
                          height: 12,
                          margin: const EdgeInsets.only(top: 4),
                          decoration: BoxDecoration(
                            color: color,
                            shape: BoxShape.circle,
                          ),
                        ),
                        if (!isLast)
                          Expanded(
                            child: Container(
                              width: 2,
                              color: AppTokens.borderLight,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(width: AppTokens.space3),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: AppTokens.space4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_describe(e),
                                style: const TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600)),
                            const SizedBox(height: 2),
                            Text('by $actor · ${relativeTime(e.createdAt)}',
                                style: const TextStyle(
                                    fontSize: 12,
                                    color: AppTokens.textMutedLight)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

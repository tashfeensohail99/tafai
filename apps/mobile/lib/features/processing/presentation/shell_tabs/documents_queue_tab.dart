import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';
import '../case_workspace_screen.dart';
import '../processing_ui.dart';

/// Cross-case document review queue — every document across the user's cases in
/// an actionable status (SUBMITTED / UNDER_REVIEW / REJECTED / EXPIRING_SOON /
/// EXPIRED). Tapping a row opens the owning case workspace.
class DocumentsQueueTab extends ConsumerStatefulWidget {
  const DocumentsQueueTab({super.key});

  @override
  ConsumerState<DocumentsQueueTab> createState() => _DocumentsQueueTabState();
}

class _DocumentsQueueTabState extends ConsumerState<DocumentsQueueTab> {
  String _filter = 'ALL';

  static const _filters = [
    ('ALL', 'All'),
    ('SUBMITTED', 'Awaiting review'),
    ('UNDER_REVIEW', 'Under review'),
    ('REJECTED', 'Rejected'),
    ('EXPIRING_SOON', 'Expiring'),
  ];

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(aggregatedDocumentsProvider);
    return Column(
      children: [
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space4, vertical: AppTokens.space2),
            children: _filters.map((f) {
              final on = _filter == f.$1;
              return Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  label: Text(f.$2, style: const TextStyle(fontSize: 12)),
                  selected: on,
                  onSelected: (_) => setState(() => _filter = f.$1),
                  selectedColor: AppTokens.primary100,
                  backgroundColor: AppTokens.surfaceLight,
                  side: const BorderSide(color: AppTokens.borderLight),
                ),
              );
            }).toList(),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.refresh(aggregatedDocumentsProvider.future),
            child: async.when(
              loading: () => const SkeletonList(),
              error: (e, _) => ListView(children: [
                Padding(
                  padding: const EdgeInsets.all(AppTokens.space6),
                  child: ErrorView(
                    error: e,
                    onRetry: () =>
                        ref.invalidate(aggregatedDocumentsProvider),
                  ),
                ),
              ]),
              data: (docs) {
                final filtered = _filter == 'ALL'
                    ? docs
                    : _filter == 'EXPIRING_SOON'
                        ? docs
                            .where((d) =>
                                d.status == 'EXPIRING_SOON' ||
                                d.status == 'EXPIRED')
                            .toList()
                        : docs.where((d) => d.status == _filter).toList();
                if (filtered.isEmpty) {
                  return ListView(children: const [
                    Padding(
                      padding: EdgeInsets.only(top: 80),
                      child: EmptyView(
                        icon: Icons.check_circle_outline,
                        title: 'No documents need attention',
                        message:
                            'Documents appear here as clients upload them.',
                      ),
                    ),
                  ]);
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(AppTokens.space4),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppTokens.space3),
                  itemBuilder: (_, i) => _DocQueueCard(doc: filtered[i]),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

class _DocQueueCard extends StatelessWidget {
  final AggregatedDocument doc;
  const _DocQueueCard({required this.doc});

  @override
  Widget build(BuildContext context) {
    final d = doc;
    return InkWell(
      borderRadius: const BorderRadius.all(AppTokens.radiusCard),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CaseWorkspaceScreen(caseId: d.caseId),
        ),
      ),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(d.documentName,
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w600)),
                ),
                const Icon(Icons.chevron_right,
                    color: AppTokens.textMutedLight),
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                StatusPill(
                    label: docStatusLabel(d.status), tone: docStatusTone(d.status)),
                StatusPill(
                    label: d.criticality, tone: criticalityTone(d.criticality)),
                if (d.validityExpiryDate != null)
                  Text('Expires ${formatDate(d.validityExpiryDate!)}',
                      style: const TextStyle(
                          fontSize: 11.5, color: AppTokens.textMutedLight)),
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            Row(
              children: [
                InitialsAvatar(name: d.caseRef.personName, radius: 12),
                const SizedBox(width: AppTokens.space2),
                Expanded(
                  child: Text(
                    '${d.caseRef.personName} · ${labelForServiceCode(d.caseRef.service)} / ${d.caseRef.targetCountry}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12, color: AppTokens.textMutedLight),
                  ),
                ),
                priorityPill(d.caseRef.priority),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

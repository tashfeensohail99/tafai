import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/auth/auth_controller.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';
import '../case_workspace_screen.dart';
import '../processing_ui.dart';

/// Dashboard tab — role KPIs. Same numbers render for managers (global
/// aggregates) and associates (their own caseload); the framing differs.
class ProcessingDashboardTab extends ConsumerWidget {
  const ProcessingDashboardTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final isManager = ref.watch(isProcessingManagerProvider);
    final metricsAsync = ref.watch(processingDashboardProvider);
    final casesAsync =
        ref.watch(processingCasesProvider(const CasesQuery()));
    final greeting = user?.displayName.split(' ').first ?? 'there';

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(processingDashboardProvider);
        ref.invalidate(processingCasesProvider(const CasesQuery()));
        await ref.read(processingDashboardProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.all(AppTokens.space4),
        children: [
          Text('Hi $greeting',
              style: const TextStyle(
                  fontSize: 20, fontWeight: FontWeight.w700)),
          Text(
            isManager ? 'Processing — Manager' : 'Processing — Associate',
            style: const TextStyle(
                fontSize: 13, color: AppTokens.textMutedLight),
          ),
          const SizedBox(height: AppTokens.space4),
          metricsAsync.when(
            loading: () => const SizedBox(
                height: 200, child: Center(child: CircularProgressIndicator())),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(processingDashboardProvider),
            ),
            data: (m) => _kpiGrid(m, isManager),
          ),
          const SizedBox(height: AppTokens.space5),
          Row(
            children: [
              Text(isManager ? 'Recent active cases' : 'My active cases',
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: AppTokens.space3),
          casesAsync.when(
            loading: () => const SkeletonList(items: 4),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () =>
                  ref.invalidate(processingCasesProvider(const CasesQuery())),
            ),
            data: (res) {
              final active =
                  res.cases.where((c) => !c.isTerminal).take(8).toList();
              if (active.isEmpty) {
                return const SectionCard(
                  child: EmptyView(
                    icon: Icons.folder_open_outlined,
                    title: 'No active cases',
                    message: 'Assigned work will appear here.',
                  ),
                );
              }
              return Column(
                children: active
                    .map((c) => Padding(
                          padding:
                              const EdgeInsets.only(bottom: AppTokens.space3),
                          child: CaseListCard(caseItem: c),
                        ))
                    .toList(),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _kpiGrid(ProcessingDashboardMetrics m, bool isManager) {
    final tiles = [
      KpiCard(
        label: isManager ? 'Active cases' : 'My active cases',
        value: '${m.activeCases}',
        hint: isManager ? 'Team-wide' : 'Assigned to you',
        icon: Icons.folder_open_outlined,
        tone: priorityTone('NORMAL'),
      ),
      KpiCard(
        label: isManager ? 'Pending docs' : 'My pending docs',
        value: '${m.myPendingDocs}',
        hint: 'Collection / review',
        icon: Icons.fact_check_outlined,
        tone: m.myPendingDocs > 0
            ? priorityTone('NORMAL')
            : docStatusTone('NOT_SUBMITTED'),
      ),
      KpiCard(
        label: isManager ? 'Client follow-ups' : 'My follow-ups',
        value: '${m.myClientFollowUp}',
        hint: 'Awaiting client',
        icon: Icons.how_to_reg_outlined,
        tone: m.myClientFollowUp > 0
            ? priorityTone('URGENT')
            : docStatusTone('ACCEPTED'),
      ),
      KpiCard(
        label: isManager ? 'Ready to file' : 'My ready to file',
        value: '${m.readyToSubmit}',
        hint: 'Final submission pending',
        icon: Icons.send_outlined,
        tone: m.readyToSubmit > 0
            ? docStatusTone('ACCEPTED')
            : docStatusTone('NOT_SUBMITTED'),
      ),
      KpiCard(
        label: isManager ? 'Approved' : 'My approved',
        value: '${m.myApproved}',
        hint: 'Lifetime',
        icon: Icons.check_circle_outline,
        tone: docStatusTone('ACCEPTED'),
      ),
      KpiCard(
        label: isManager ? 'Refused' : 'My refused',
        value: '${m.myRefused}',
        hint: 'Lifetime',
        icon: Icons.cancel_outlined,
        tone: m.myRefused > 0
            ? docStatusTone('NOT_SUBMITTED')
            : docStatusTone('ACCEPTED'),
      ),
    ];
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: AppTokens.space3,
      crossAxisSpacing: AppTokens.space3,
      childAspectRatio: 1.55,
      children: tiles,
    );
  }
}

/// Reusable single-column case card used across Dashboard / My Cases.
class CaseListCard extends StatelessWidget {
  final ProcessingCaseListItem caseItem;
  const CaseListCard({super.key, required this.caseItem});

  @override
  Widget build(BuildContext context) {
    final c = caseItem;
    return InkWell(
      borderRadius: const BorderRadius.all(AppTokens.radiusCard),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CaseWorkspaceScreen(caseId: c.id),
        ),
      ),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                InitialsAvatar(name: c.personName, radius: 18),
                const SizedBox(width: AppTokens.space3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.personName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 1),
                      Text(
                        '${labelForServiceCode(c.service)} · ${c.targetCountry}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12.5,
                            color: AppTokens.textMutedLight),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right,
                    color: AppTokens.textMutedLight),
              ],
            ),
            const SizedBox(height: AppTokens.space3),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                stagePill(c.stage),
                priorityPill(c.priority),
                Text(relativeTime(c.updatedAt),
                    style: const TextStyle(
                        fontSize: 11.5, color: AppTokens.textMutedLight)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

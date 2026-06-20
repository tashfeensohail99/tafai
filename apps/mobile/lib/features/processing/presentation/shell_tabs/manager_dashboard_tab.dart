import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';
import '../case_workspace_screen.dart';
import '../new_client_screen.dart';
import '../processing_ui.dart';
import '../refund_lane_screen.dart';

/// Manager Dashboard — admin overview: team workload, stage breakdown, SLA
/// breaches, recent intake. Manager-only (gated in the shell).
class ManagerDashboardTab extends ConsumerWidget {
  const ManagerDashboardTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(processingAdminOverviewProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(processingAdminOverviewProvider.future),
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(
              error: e,
              onRetry: () =>
                  ref.invalidate(processingAdminOverviewProvider),
            ),
          ),
        ]),
        data: (d) => ListView(
          padding: const EdgeInsets.all(AppTokens.space4),
          children: [
            _managerTools(context),
            const SizedBox(height: AppTokens.space5),
            _kpiGrid(d.totals),
            const SizedBox(height: AppTokens.space5),
            if (d.casesByType.isNotEmpty) ...[
              const SectionLabel('Cases by type'),
              const SizedBox(height: AppTokens.space2),
              _barCard(d.casesByType
                  .map((r) => (label: labelForServiceCode(r.service), count: r.count))
                  .toList()),
              const SizedBox(height: AppTokens.space5),
            ],
            if (d.officerWorkload.isNotEmpty) ...[
              const SectionLabel('Officer workload'),
              const SizedBox(height: AppTokens.space2),
              _barCard(d.officerWorkload
                  .map((o) => (label: o.name, count: o.activeCases))
                  .toList()),
              const SizedBox(height: AppTokens.space5),
            ],
            if (d.stageBreakdown.isNotEmpty) ...[
              const SectionLabel('Stage breakdown'),
              const SizedBox(height: AppTokens.space2),
              _barCard(d.stageBreakdown
                  .map((s) => (label: stageLabel(s.stage), count: s.count))
                  .toList()),
              const SizedBox(height: AppTokens.space5),
            ],
            const SectionLabel('SLA breached'),
            const SizedBox(height: AppTokens.space2),
            if (d.breachedCases.isEmpty)
              const SectionCard(
                child: Row(children: [
                  Icon(Icons.check_circle_outline,
                      size: 18, color: AppTokens.statusSuccess),
                  SizedBox(width: AppTokens.space2),
                  Expanded(
                    child: Text('SLA clear — no active cases past deadline.',
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ]),
              )
            else
              ...d.breachedCases.map((c) => Padding(
                    padding: const EdgeInsets.only(bottom: AppTokens.space3),
                    child: _breachedCard(context, c),
                  )),
            if (d.recentIntake.isNotEmpty) ...[
              const SizedBox(height: AppTokens.space5),
              const SectionLabel('Recent intake'),
              const SizedBox(height: AppTokens.space2),
              ...d.recentIntake.map((r) => Padding(
                    padding: const EdgeInsets.only(bottom: AppTokens.space3),
                    child: _intakeCard(context, r),
                  )),
            ],
          ],
        ),
      ),
    );
  }

  Widget _managerTools(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionLabel('Manager tools'),
        const SizedBox(height: AppTokens.space2),
        _ToolTile(
          icon: Icons.person_add_alt_1_outlined,
          title: 'New client',
          subtitle: 'Create a client + case directly (no Finance handover)',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const NewClientScreen()),
          ),
        ),
        _ToolTile(
          icon: Icons.assignment_return_outlined,
          title: 'Refund / Escalation',
          subtitle: 'Rejected cases needing refund or appeal',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const RefundLaneScreen()),
          ),
        ),
      ],
    );
  }

  Widget _kpiGrid(AdminOverviewTotals t) {
    final tiles = [
      KpiCard(
          label: 'Active cases',
          value: '${t.active}',
          hint: 'Across all officers',
          icon: Icons.folder_open_outlined,
          tone: priorityTone('NORMAL')),
      KpiCard(
          label: 'Awaiting review',
          value: '${t.newIntake}',
          hint: 'From Finance',
          icon: Icons.inbox_outlined,
          tone: t.newIntake > 0
              ? priorityTone('URGENT')
              : docStatusTone('NOT_SUBMITTED')),
      KpiCard(
          label: 'Unassigned',
          value: '${t.unassigned}',
          hint: t.unassigned > 0 ? 'Reassign needed' : 'All routed',
          icon: Icons.person_off_outlined,
          tone: t.unassigned > 0
              ? docStatusTone('REJECTED')
              : docStatusTone('ACCEPTED')),
      KpiCard(
          label: 'Pending docs',
          value: '${t.pendingDocuments}',
          hint: 'Submitted / review',
          icon: Icons.fact_check_outlined,
          tone: t.pendingDocuments > 0
              ? priorityTone('URGENT')
              : docStatusTone('ACCEPTED')),
      KpiCard(
          label: 'Final submission',
          value: '${t.finalSubmissionPending}',
          hint: 'Ready to file',
          icon: Icons.send_outlined,
          tone: priorityTone('NORMAL')),
      KpiCard(
          label: 'SLA breached',
          value: '${t.slaBreached}',
          hint: 'Past deadline',
          icon: Icons.warning_amber_rounded,
          tone: t.slaBreached > 0
              ? docStatusTone('REJECTED')
              : docStatusTone('ACCEPTED')),
    ];
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: AppTokens.space3,
      crossAxisSpacing: AppTokens.space3,
      childAspectRatio: 1.5,
      children: tiles,
    );
  }

  Widget _barCard(List<({String label, int count})> rows) {
    final max = rows.fold<int>(1, (m, r) => r.count > m ? r.count : m);
    return SectionCard(
      child: Column(
        children: rows
            .map((r) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 130,
                        child: Text(r.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 12.5, fontWeight: FontWeight.w500)),
                      ),
                      const SizedBox(width: AppTokens.space2),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: r.count / max,
                            minHeight: 8,
                            backgroundColor: AppTokens.surfaceSubtleLight,
                            valueColor: const AlwaysStoppedAnimation(
                                AppTokens.primary600),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppTokens.space2),
                      SizedBox(
                        width: 28,
                        child: Text('${r.count}',
                            textAlign: TextAlign.right,
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
  }

  Widget _breachedCard(BuildContext context, BreachedCaseRow c) {
    return InkWell(
      borderRadius: const BorderRadius.all(AppTokens.radiusCard),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => CaseWorkspaceScreen(caseId: c.id)),
      ),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(c.clientName ?? '—',
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w600)),
                ),
                if (c.slaDueAt != null)
                  Text(relativeTime(c.slaDueAt!),
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppTokens.statusDanger)),
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                stagePill(c.stage),
                Text(
                  '${labelForServiceCode(c.service)} · ${c.targetCountry}',
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.textMutedLight),
                ),
                Text(c.officerName ?? 'Unassigned',
                    style: TextStyle(
                        fontSize: 12,
                        color: c.officerName == null
                            ? AppTokens.statusWarning
                            : AppTokens.textMutedLight)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _intakeCard(BuildContext context, RecentIntakeRow r) {
    return InkWell(
      borderRadius: const BorderRadius.all(AppTokens.radiusCard),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => CaseWorkspaceScreen(caseId: r.id)),
      ),
      child: SectionCard(
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(r.clientName ?? '—',
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 1),
                  Text(
                    '${labelForServiceCode(r.service)} · ${r.targetCountry} · ${relativeTime(r.createdAt)}',
                    style: const TextStyle(
                        fontSize: 12, color: AppTokens.textMutedLight),
                  ),
                ],
              ),
            ),
            priorityPill(r.priority),
          ],
        ),
      ),
    );
  }
}

/// A tappable manager-tool row (icon + title + subtitle + chevron). Used for
/// the entry points into the refund lane, reports, new-client and template
/// admin surfaces.
class _ToolTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  const _ToolTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space2),
      child: InkWell(
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        onTap: onTap,
        child: SectionCard(
          padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space4, vertical: AppTokens.space3),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(
                  color: AppTokens.primary100,
                  borderRadius: BorderRadius.all(AppTokens.radiusMd),
                ),
                alignment: Alignment.center,
                child: Icon(icon, size: 18, color: AppTokens.primary700),
              ),
              const SizedBox(width: AppTokens.space3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 1),
                    Text(subtitle,
                        style: const TextStyle(
                            fontSize: 11.5, color: AppTokens.textMutedLight)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right,
                  size: 20, color: AppTokens.textMutedLight),
            ],
          ),
        ),
      ),
    );
  }
}

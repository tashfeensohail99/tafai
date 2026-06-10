import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../../../core/widgets/shimmer.dart';
import '../../auth/domain/auth_user.dart';
import '../../leads/domain/lead.dart';
import '../../leads/domain/lead_stats.dart';
import '../../leads/presentation/lead_visuals.dart';
import '../data/dashboard_providers.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(mySalesStatsProvider);
    final summaryAsync = ref.watch(dashboardSummaryProvider);
    final user = ref.watch(currentUserProvider);

    return RefreshIndicator(
      color: AppTokens.brandNavy,
      onRefresh: () async {
        ref.invalidate(mySalesStatsProvider);
        ref.invalidate(dashboardSummaryProvider);
        await Future.wait([
          ref.read(mySalesStatsProvider.future),
          ref.read(dashboardSummaryProvider.future),
        ]).catchError((_) => <Object>[]);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
            AppTokens.space4, AppTokens.space4,
            AppTokens.space4, AppTokens.space16),
        children: [
          _GreetingBanner(user: user),
          const SizedBox(height: AppTokens.space5),
          statsAsync.when(
            loading: () => const _KpiSkeleton(),
            error: (e, _) => _MiniError(
              message: messageForError(e),
              onRetry: () => ref.invalidate(mySalesStatsProvider),
            ),
            data: (stats) => _KpiGrid(stats: stats),
          ),
          const SizedBox(height: AppTokens.space6),
          summaryAsync.when(
            loading: () => const _SummarySkeleton(),
            error: (e, _) => _MiniError(
              message: messageForError(e),
              onRetry: () => ref.invalidate(dashboardSummaryProvider),
            ),
            data: (summary) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (summary.pipeline.isNotEmpty) ...[
                  const SectionLabel('Pipeline'),
                  const SizedBox(height: AppTokens.space3),
                  _PipelineRow(pipeline: summary.pipeline),
                  const SizedBox(height: AppTokens.space6),
                ],
                const SectionLabel('Recent leads'),
                const SizedBox(height: AppTokens.space3),
                _RecentLeadsList(leads: summary.recentLeads),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Greeting banner ──────────────────────────────────────────────────────────

class _GreetingBanner extends StatelessWidget {
  final AuthUser? user;
  const _GreetingBanner({required this.user});

  @override
  Widget build(BuildContext context) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good morning'
        : hour < 17
            ? 'Good afternoon'
            : 'Good evening';
    final first = user?.employee?.firstName.trim() ?? '';
    final name =
        first.isNotEmpty ? first : (user?.displayName ?? 'Welcome');

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                greeting,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppTokens.textMutedLight,
                  letterSpacing: 0.1,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                name,
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: AppTokens.textPrimaryLight,
                  letterSpacing: -0.6,
                  height: 1.15,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 3),
              const Text(
                "Today's overview",
                style: TextStyle(
                  fontSize: 13,
                  color: AppTokens.textMutedLight,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: AppTokens.space3),
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [AppTokens.brandNavy, AppTokens.brandNavyLight],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: AppTokens.brandNavy.withValues(alpha: 0.30),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: Text(
            user?.initials ?? '?',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
        ),
      ],
    );
  }
}

// ── KPI grid ─────────────────────────────────────────────────────────────────

class _KpiGrid extends StatelessWidget {
  final MySalesStats stats;
  const _KpiGrid({required this.stats});

  @override
  Widget build(BuildContext context) {
    final slaColor = stats.slaScore >= 80
        ? AppTokens.statusSuccess
        : stats.slaScore >= 50
            ? AppTokens.statusWarning
            : AppTokens.statusDanger;
    return Column(
      children: [
        Row(children: [
          Expanded(
            child: MetricCard(
              icon: Icons.people_alt_rounded,
              value: '${stats.assignedLeads}',
              label: 'Assigned leads',
              accentColor: AppTokens.brandNavy,
            ),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: MetricCard(
              icon: Icons.checklist_rounded,
              value: '${stats.openFollowUps}',
              label: 'Open follow-ups',
              accentColor: AppTokens.brandNavy,
            ),
          ),
        ]),
        const SizedBox(height: AppTokens.space3),
        Row(children: [
          Expanded(
            child: MetricCard(
              icon: Icons.alarm_rounded,
              value: '${stats.overdueFollowUps}',
              label: 'Overdue',
              accentColor: stats.overdueFollowUps > 0
                  ? AppTokens.statusDanger
                  : AppTokens.statusNeutral,
            ),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: MetricCard(
              icon: Icons.speed_rounded,
              value: '${stats.slaScore}%',
              label: 'SLA score',
              accentColor: slaColor,
            ),
          ),
        ]),
      ],
    );
  }
}

// ── Pipeline strip ────────────────────────────────────────────────────────────

class _PipelineRow extends StatelessWidget {
  final List<PipelineStage> pipeline;
  const _PipelineRow({required this.pipeline});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      clipBehavior: Clip.none,
      child: Row(
        children: [
          for (final p in pipeline) ...[
            _PipelineTile(stage: p.stage, count: p.count),
            const SizedBox(width: 10),
          ],
        ],
      ),
    );
  }
}

class _PipelineTile extends StatelessWidget {
  final String stage;
  final int count;
  const _PipelineTile({required this.stage, required this.count});

  @override
  Widget build(BuildContext context) {
    final color = leadStatusColor(stage);
    return Container(
      constraints: const BoxConstraints(minWidth: 76),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(height: 3, color: color),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: color,
                    letterSpacing: -0.5,
                    height: 1.0,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  leadStatusLabel(stage),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppTokens.textMutedLight,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Recent leads ──────────────────────────────────────────────────────────────

class _RecentLeadsList extends StatelessWidget {
  final List<RecentLead> leads;
  const _RecentLeadsList({required this.leads});

  @override
  Widget build(BuildContext context) {
    if (leads.isEmpty) {
      return PremiumCard(
        padding: const EdgeInsets.all(AppTokens.space6),
        child: const Center(
          child: Text(
            'No recent leads yet.',
            style: TextStyle(color: AppTokens.textMutedLight),
          ),
        ),
      );
    }
    return Column(
      children: [
        for (final lead in leads) ...[
          _RecentLeadTile(lead: lead),
          const SizedBox(height: AppTokens.space2),
        ],
      ],
    );
  }
}

class _RecentLeadTile extends StatelessWidget {
  final RecentLead lead;
  const _RecentLeadTile({required this.lead});

  String _initials(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final color = leadStatusColor(lead.stage);
    return Container(
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.white,
        child: InkWell(
          onTap: () => context.push(AppRoutes.leadDetail(lead.id)),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 4, color: color),
                const SizedBox(width: 12),
                Container(
                  width: 38,
                  height: 38,
                  margin: const EdgeInsets.symmetric(vertical: 12),
                  decoration: BoxDecoration(
                    color: AppTokens.avatarTintLight,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _initials(lead.fullName),
                    style: const TextStyle(
                      color: AppTokens.avatarFg,
                      fontWeight: FontWeight.w800,
                      fontSize: 13,
                    ),
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          lead.fullName.isEmpty ? '(no name)' : lead.fullName,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppTokens.textPrimaryLight,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          lead.phone,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTokens.textMutedLight,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 12, 13, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      PremiumStatusBadge(
                        label: leadStatusLabel(lead.stage),
                        color: color,
                        compact: true,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        relativeTime(lead.assignedAt),
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppTokens.textMutedLight,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

class _KpiSkeleton extends StatelessWidget {
  const _KpiSkeleton();

  @override
  Widget build(BuildContext context) {
    Widget box() => Expanded(
          child: Container(
            height: 110,
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.all(AppTokens.radiusCard),
              boxShadow: AppTokens.cardShadow,
            ),
            padding: const EdgeInsets.all(AppTokens.space4),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBox(width: 36, height: 36, radius: 8),
                SizedBox(height: AppTokens.space3),
                SkeletonBox(width: 52, height: 24),
                SizedBox(height: 6),
                SkeletonBox(width: 90, height: 11),
              ],
            ),
          ),
        );
    return Shimmer(
      child: Column(
        children: [
          Row(children: [box(), const SizedBox(width: AppTokens.space3), box()]),
          const SizedBox(height: AppTokens.space3),
          Row(children: [box(), const SizedBox(width: AppTokens.space3), box()]),
        ],
      ),
    );
  }
}

class _SummarySkeleton extends StatelessWidget {
  const _SummarySkeleton();

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SkeletonBox(width: 90, height: 11),
          const SizedBox(height: AppTokens.space4),
          for (var i = 0; i < 4; i++) ...[
            Container(
              height: 66,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.all(AppTokens.radiusCard),
              ),
            ),
            const SizedBox(height: AppTokens.space2),
          ],
        ],
      ),
    );
  }
}

class _MiniError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _MiniError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_outlined,
              color: AppTokens.statusNeutral, size: 20),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Text(message,
                style: Theme.of(context).textTheme.bodyMedium, maxLines: 2),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

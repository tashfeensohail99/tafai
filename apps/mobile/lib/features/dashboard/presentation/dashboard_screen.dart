import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
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
      onRefresh: () async {
        ref.invalidate(mySalesStatsProvider);
        ref.invalidate(dashboardSummaryProvider);
        await Future.wait([
          ref.read(mySalesStatsProvider.future),
          ref.read(dashboardSummaryProvider.future),
        ]).catchError((_) => <Object>[]);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTokens.space4, AppTokens.space5,
            AppTokens.space4, AppTokens.space10),
        children: [
          _Greeting(user: user),
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
                  const _SectionHeader('Pipeline'),
                  const SizedBox(height: AppTokens.space3),
                  _PipelineStrip(pipeline: summary.pipeline),
                  const SizedBox(height: AppTokens.space6),
                ],
                const _SectionHeader('Recent leads'),
                const SizedBox(height: AppTokens.space3),
                _RecentLeads(leads: summary.recentLeads),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  final AuthUser? user;
  const _Greeting({required this.user});

  @override
  Widget build(BuildContext context) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good morning'
        : hour < 17
            ? 'Good afternoon'
            : 'Good evening';
    final first = user?.employee?.firstName.trim() ?? '';
    final name = first.isNotEmpty ? first : (user?.displayName ?? 'Welcome');
    final t = Theme.of(context).textTheme;
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$greeting,', style: t.bodyMedium),
              const SizedBox(height: 2),
              Text(
                name,
                style: t.displayLarge?.copyWith(fontSize: AppTokens.fontSize2xl),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        const SizedBox(width: AppTokens.space3),
        CircleAvatar(
          radius: 24,
          backgroundColor: AppTokens.primary100,
          child: Text(
            user?.initials ?? '?',
            style: const TextStyle(
              color: AppTokens.primary700,
              fontWeight: FontWeight.w700,
              fontSize: AppTokens.fontSizeLg,
            ),
          ),
        ),
      ],
    );
  }
}

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
            child: _KpiCard(
              icon: Icons.people_alt_outlined,
              value: '${stats.assignedLeads}',
              label: 'Assigned leads',
              color: AppTokens.primary600,
            ),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: _KpiCard(
              icon: Icons.checklist_outlined,
              value: '${stats.openFollowUps}',
              label: 'Open follow-ups',
              color: AppTokens.statusInfo,
            ),
          ),
        ]),
        const SizedBox(height: AppTokens.space3),
        Row(children: [
          Expanded(
            child: _KpiCard(
              icon: Icons.alarm_outlined,
              value: '${stats.overdueFollowUps}',
              label: 'Overdue',
              color: stats.overdueFollowUps > 0
                  ? AppTokens.statusDanger
                  : AppTokens.statusNeutral,
            ),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: _KpiCard(
              icon: Icons.speed_outlined,
              value: '${stats.slaScore}%',
              label: 'SLA score',
              color: slaColor,
            ),
          ),
        ]),
      ],
    );
  }
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  final Color color;
  const _KpiCard({
    required this.icon,
    required this.value,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(AppTokens.space2),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: const BorderRadius.all(AppTokens.radiusMd),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: AppTokens.space3),
            Text(value,
                style: t.displayLarge?.copyWith(fontSize: AppTokens.fontSize2xl)),
            const SizedBox(height: 2),
            Text(label, style: t.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Text(
      title.toUpperCase(),
      style: const TextStyle(
        fontSize: AppTokens.fontSizeXs,
        fontWeight: FontWeight.w700,
        color: AppTokens.statusNeutral,
        letterSpacing: 0.6,
      ),
    );
  }
}

class _PipelineStrip extends StatelessWidget {
  final List<PipelineStage> pipeline;
  const _PipelineStrip({required this.pipeline});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final p in pipeline) ...[
            _PipelineChip(stage: p.stage, count: p.count),
            const SizedBox(width: AppTokens.space3),
          ],
        ],
      ),
    );
  }
}

class _PipelineChip extends StatelessWidget {
  final String stage;
  final int count;
  const _PipelineChip({required this.stage, required this.count});

  @override
  Widget build(BuildContext context) {
    final color = leadStatusColor(stage);
    final t = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppTokens.space4, vertical: AppTokens.space3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: const BorderRadius.all(AppTokens.radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$count',
              style:
                  t.titleLarge?.copyWith(color: color, fontWeight: FontWeight.w700)),
          Text(leadStatusLabel(stage), style: t.bodySmall?.copyWith(color: color)),
        ],
      ),
    );
  }
}

class _RecentLeads extends StatelessWidget {
  final List<RecentLead> leads;
  const _RecentLeads({required this.leads});

  @override
  Widget build(BuildContext context) {
    if (leads.isEmpty) {
      return const Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: EdgeInsets.all(AppTokens.space6),
          child: Center(
            child: Text('No recent leads yet.',
                style: TextStyle(color: AppTokens.textMutedLight)),
          ),
        ),
      );
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < leads.length; i++) ...[
            if (i > 0)
              const Divider(
                  height: 1,
                  indent: AppTokens.space4,
                  endIndent: AppTokens.space4),
            _RecentLeadRow(lead: leads[i]),
          ],
        ],
      ),
    );
  }
}

class _RecentLeadRow extends StatelessWidget {
  final RecentLead lead;
  const _RecentLeadRow({required this.lead});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final color = leadStatusColor(lead.stage);
    return InkWell(
      onTap: () => context.push(AppRoutes.leadDetail(lead.id)),
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space4, vertical: AppTokens.space3),
        child: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: color.withValues(alpha: 0.12),
              child: Text(
                _initials(lead.fullName),
                style: TextStyle(
                    color: color, fontWeight: FontWeight.w700, fontSize: 12),
              ),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    lead.fullName.isEmpty ? '(no name)' : lead.fullName,
                    style: t.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(lead.phone, style: t.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: AppTokens.space2),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                StatusBadge(label: leadStatusLabel(lead.stage), color: color),
                const SizedBox(height: 4),
                Text(relativeTime(lead.assignedAt), style: t.bodySmall),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}

class _KpiSkeleton extends StatelessWidget {
  const _KpiSkeleton();
  @override
  Widget build(BuildContext context) {
    Widget box() => const Expanded(
          child: Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: EdgeInsets.all(AppTokens.space4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonBox(width: 36, height: 36, radius: 6),
                  SizedBox(height: AppTokens.space3),
                  SkeletonBox(width: 48, height: 26),
                  SizedBox(height: 6),
                  SkeletonBox(width: 80, height: 12),
                ],
              ),
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
    return const Shimmer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SkeletonBox(width: 120, height: 14),
          SizedBox(height: AppTokens.space4),
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: EdgeInsets.all(AppTokens.space4),
              child: Column(
                children: [
                  SkeletonBox(height: 40),
                  SizedBox(height: AppTokens.space4),
                  SkeletonBox(height: 40),
                  SizedBox(height: AppTokens.space4),
                  SkeletonBox(height: 40),
                ],
              ),
            ),
          ),
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
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
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
      ),
    );
  }
}

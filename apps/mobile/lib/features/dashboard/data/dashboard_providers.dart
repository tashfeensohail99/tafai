import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../leads/data/leads_repository.dart';
import '../../leads/domain/lead_stats.dart';

/// GET /leads/dashboard-summary — counts, pipeline, recent leads.
final dashboardSummaryProvider =
    FutureProvider.autoDispose<LeadDashboardSummary>((ref) async {
  return ref.watch(leadsRepositoryProvider).dashboardSummary();
});

/// GET /leads/my-stats — per-agent counters + SLA.
final mySalesStatsProvider =
    FutureProvider.autoDispose<MySalesStats>((ref) async {
  return ref.watch(leadsRepositoryProvider).myStats();
});

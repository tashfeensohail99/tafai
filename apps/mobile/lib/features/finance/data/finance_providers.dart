import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../agreements/data/agreements_repository.dart';
import '../../agreements/domain/agreement.dart';
import '../domain/finance_models.dart';
import 'finance_repository.dart';

// ─── Customers list ─────────────────────────────────────────────────────────

/// Debounced search query for the Customers tab.
final financeCustomersSearchProvider = StateProvider<String>((ref) => '');

/// The customer pipeline list for the current search.
final financeCustomersProvider =
    FutureProvider.autoDispose<List<FinanceCustomerRow>>((ref) async {
  final search = ref.watch(financeCustomersSearchProvider);
  return ref
      .watch(financeRepositoryProvider)
      .customers(search: search.trim().isEmpty ? null : search.trim());
});

// ─── Customer profile ───────────────────────────────────────────────────────

/// A single customer's aggregated profile, by leadId.
final financeCustomerProfileProvider =
    FutureProvider.autoDispose.family<FinanceCustomerProfile, String>(
  (ref, leadId) => ref.watch(financeRepositoryProvider).customerProfile(leadId),
);

// ─── Dashboard ──────────────────────────────────────────────────────────────

/// Bundle for the dashboard: the handover queue + revenue + agreements-to-review.
class FinanceDashboardData {
  final List<FinanceDashboardHandover> handovers;
  final FinanceRevenue revenue;
  final int agreementsToReview;

  const FinanceDashboardData({
    required this.handovers,
    required this.revenue,
    required this.agreementsToReview,
  });
}

final financeDashboardProvider =
    FutureProvider.autoDispose<FinanceDashboardData>((ref) async {
  final repo = ref.watch(financeRepositoryProvider);
  // Fetch in parallel; the review-count is best-effort (defaults to 0).
  final results = await Future.wait([
    repo.handovers(),
    repo.revenueByService(),
    repo.agreementsToReviewCount().then<int>((v) => v).catchError((_) => 0),
  ]);
  return FinanceDashboardData(
    handovers: results[0] as List<FinanceDashboardHandover>,
    revenue: results[1] as FinanceRevenue,
    agreementsToReview: results[2] as int,
  );
});

// ─── Agreements queue ─────────────────────────────────────────────────────

/// The firm-wide agreements list (Finance review queue).
final financeAgreementsProvider =
    FutureProvider.autoDispose<List<Agreement>>((ref) async {
  return ref.watch(financeRepositoryProvider).agreements();
});

/// Single agreement detail, by id. Reuses the agreements feature repository
/// (GET /agreements/:id) which already maps the rich [Agreement] with bio,
/// payment plan and events.
final financeAgreementDetailProvider =
    FutureProvider.autoDispose.family<Agreement, String>((ref, id) async {
  return ref.watch(agreementsRepositoryProvider).get(id);
});

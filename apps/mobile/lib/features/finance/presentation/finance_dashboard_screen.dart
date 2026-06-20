import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/finance_providers.dart';
import '../domain/finance_models.dart';

/// Finance Dashboard — the verification queue + KPI cards a finance officer
/// sees on sign-in. Body widget (no Scaffold of its own; lives in the shell's
/// IndexedStack). Mirrors the web FinanceDashboardPage's KPIs + "my queue".
class FinanceDashboardScreen extends ConsumerWidget {
  const FinanceDashboardScreen({super.key});

  String _money(double n, [String ccy = 'CAD']) =>
      '$ccy ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(financeDashboardProvider);
    return async.when(
      loading: () => const SkeletonList(),
      error: (e, _) => ErrorView(
        error: e,
        onRetry: () => ref.invalidate(financeDashboardProvider),
      ),
      data: (data) {
        final userId = ref.watch(currentUserProvider)?.id;
        final handovers = data.handovers;
        final newFromSales =
            handovers.where((h) => h.status == 'SUBMITTED').length;
        final underReview = handovers
            .where((h) =>
                h.status == 'IN_REVIEW' && h.reviewedByUserId == userId)
            .length;
        final awaitingBalance =
            handovers.where((h) => h.status == 'PAYMENT_RECORDED').length;
        final readyForProcessing =
            handovers.where((h) => h.status == 'PAYMENT_VERIFIED').length;
        final verifiedCount = handovers
            .where((h) =>
                h.status == 'PAYMENT_VERIFIED' ||
                h.status == 'SENT_TO_PROCESSING')
            .length;
        final queue = handovers
            .where((h) => h.status == 'SUBMITTED' || h.status == 'IN_REVIEW')
            .take(8)
            .toList();
        final problems = handovers
            .where((h) => h.status == 'REJECTED' || h.status == 'CANCELLED')
            .take(6)
            .toList();

        return RefreshIndicator(
          color: AppTokens.brandNavy,
          onRefresh: () => ref.refresh(financeDashboardProvider.future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space4, AppTokens.space4, AppTokens.space16),
            children: [
              // ── KPI grid (2 columns) ──────────────────────────────────────
              GridView(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                // Fixed cell HEIGHT (not a width ratio) so the icon + value +
                // 2-line label always fit — a ratio overflowed by ~6px on
                // this screen and would re-break at other widths.
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  crossAxisSpacing: AppTokens.space3,
                  mainAxisSpacing: AppTokens.space3,
                  mainAxisExtent: 152,
                ),
                children: [
                  MetricCard(
                    icon: Icons.description_outlined,
                    value: '${data.agreementsToReview}',
                    label: 'Agreements to review',
                    accentColor: data.agreementsToReview > 0
                        ? AppTokens.statusWarning
                        : AppTokens.statusSuccess,
                  ),
                  MetricCard(
                    icon: Icons.inbox_outlined,
                    value: '$newFromSales',
                    label: 'New from Sales',
                    accentColor: AppTokens.statusInfo,
                  ),
                  MetricCard(
                    icon: Icons.schedule_outlined,
                    value: '$underReview',
                    label: 'Under verification',
                    accentColor: AppTokens.primary600,
                  ),
                  MetricCard(
                    icon: Icons.account_balance_wallet_outlined,
                    value: '$awaitingBalance',
                    label: 'Awaiting balance',
                    accentColor: AppTokens.statusWarning,
                  ),
                  MetricCard(
                    icon: Icons.send_outlined,
                    value: '$readyForProcessing',
                    label: 'Ready for processing',
                    accentColor: AppTokens.statusSuccess,
                  ),
                  MetricCard(
                    icon: Icons.receipt_long_outlined,
                    value: _money(data.revenue.allTime),
                    label: 'Collected all-time',
                    accentColor: AppTokens.brandNavy,
                  ),
                ],
              ),
              const SizedBox(height: AppTokens.space5),

              // ── Payments to verify (my queue) ─────────────────────────────
              SectionLabel('Payments to verify · ${queue.length}'),
              const SizedBox(height: AppTokens.space2),
              if (queue.isEmpty)
                _emptyCard(
                  Icons.verified_outlined,
                  'No cases waiting',
                  'When Sales hands over the next case it shows up here.',
                )
              else
                ...queue.map((h) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppTokens.space2),
                      child: _QueueCard(handover: h),
                    )),

              if (problems.isNotEmpty) ...[
                const SizedBox(height: AppTokens.space4),
                SectionLabel('Problem pile · ${problems.length}'),
                const SizedBox(height: AppTokens.space2),
                ...problems.map((h) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppTokens.space2),
                      child: _QueueCard(handover: h, problem: true),
                    )),
              ],

              // ── Collection summary ────────────────────────────────────────
              if (data.revenue.byService.isNotEmpty) ...[
                const SizedBox(height: AppTokens.space4),
                const SectionLabel('Collection summary'),
                const SizedBox(height: AppTokens.space2),
                PremiumCard(
                  padding: const EdgeInsets.all(AppTokens.space4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _money(data.revenue.allTime),
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          color: AppTokens.textPrimaryLight,
                        ),
                      ),
                      Text(
                        '$verifiedCount verified payments · all time',
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppTokens.textMutedLight,
                        ),
                      ),
                      const SizedBox(height: AppTokens.space3),
                      for (final s in data.revenue.byService)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(s.service,
                                    style: const TextStyle(
                                        fontSize: 13,
                                        color:
                                            AppTokens.textSecondaryLight)),
                              ),
                              Text(_money(s.allTime),
                                  style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700,
                                      color: AppTokens.textPrimaryLight)),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _emptyCard(IconData icon, String title, String caption) {
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space5),
      child: Column(
        children: [
          Icon(icon, size: 34, color: AppTokens.statusSuccess),
          const SizedBox(height: AppTokens.space2),
          Text(title,
              style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppTokens.textPrimaryLight)),
          const SizedBox(height: 4),
          Text(caption,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 12, color: AppTokens.textMutedLight)),
        ],
      ),
    );
  }
}

/// A queue / problem row — tap opens the customer profile (Payments tab).
class _QueueCard extends StatelessWidget {
  final FinanceDashboardHandover handover;
  final bool problem;
  const _QueueCard({required this.handover, this.problem = false});

  String _statusLabel(String s) => switch (s) {
        'SUBMITTED' => 'New from Sales',
        'IN_REVIEW' => 'Under verification',
        'PAYMENT_RECORDED' => 'Payment recorded',
        'PAYMENT_VERIFIED' => 'Verified',
        'REJECTED' => 'Correction required',
        'CANCELLED' => 'Cancelled',
        'SENT_TO_PROCESSING' => 'Sent to processing',
        _ => s,
      };

  Color _statusColor(String s) => switch (s) {
        'SUBMITTED' => AppTokens.statusInfo,
        'IN_REVIEW' => AppTokens.primary600,
        'PAYMENT_RECORDED' => AppTokens.statusWarning,
        'PAYMENT_VERIFIED' || 'SENT_TO_PROCESSING' => AppTokens.statusSuccess,
        'REJECTED' || 'CANCELLED' => AppTokens.statusDanger,
        _ => AppTokens.statusNeutral,
      };

  @override
  Widget build(BuildContext context) {
    final name = handover.clientName.isEmpty ? '—' : handover.clientName;
    final ccy = handover.currency;
    final amt =
        '$ccy ${handover.submittedAmount.toStringAsFixed(handover.submittedAmount == handover.submittedAmount.roundToDouble() ? 0 : 2)}';
    return PremiumCard(
      onTap: () =>
          context.push(AppRoutes.financeCustomer(handover.leadId)),
      padding: const EdgeInsets.all(AppTokens.space3),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: problem
                  ? AppTokens.statusDanger.withValues(alpha: 0.10)
                  : AppTokens.avatarTintLight,
              borderRadius: const BorderRadius.all(AppTokens.radiusMd),
            ),
            alignment: Alignment.center,
            child: Icon(
              problem ? Icons.error_outline : Icons.payments_outlined,
              size: 18,
              color:
                  problem ? AppTokens.statusDanger : AppTokens.brandNavy,
            ),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppTokens.textPrimaryLight)),
                const SizedBox(height: 3),
                Row(
                  children: [
                    PremiumStatusBadge(
                      label: _statusLabel(handover.status),
                      color: _statusColor(handover.status),
                      compact: true,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        problem && handover.financeNotes != null
                            ? handover.financeNotes!
                            : amt,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12,
                            color: AppTokens.textMutedLight),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (handover.submittedAt != null)
            Text(relativeTime(handover.submittedAt!),
                style: const TextStyle(
                    fontSize: 11, color: AppTokens.textMutedLight)),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../../../core/widgets/premium_ui.dart';
import '../../agreements/domain/agreement.dart';
import '../data/finance_providers.dart';

const _actionable = {'SUBMITTED', 'FINANCE_REVIEW'};

/// Finance "Agreements" tab — the review queue. Body widget (no Scaffold;
/// lives in the shell IndexedStack). Mirrors the web FinanceAgreementsPage:
/// "Awaiting review" first, then everything else. Tap → agreement detail.
class FinanceAgreementsScreen extends ConsumerWidget {
  const FinanceAgreementsScreen({super.key});

  Color _statusColor(String status) => switch (status) {
        'DRAFT' => AppTokens.statusNeutral,
        'SUBMITTED' || 'FINANCE_REVIEW' || 'SENT' => AppTokens.statusInfo,
        'CHANGES_REQUESTED' ||
        'EDITED_PENDING_SALES' =>
          AppTokens.statusWarning,
        'APPROVED' || 'SIGNED' => AppTokens.statusSuccess,
        'CANCELLED' || 'REJECTED' => AppTokens.statusDanger,
        _ => AppTokens.statusNeutral,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(financeAgreementsProvider);
    return async.when(
      loading: () => const SkeletonList(),
      error: (e, _) => ErrorView(
        error: e,
        onRetry: () => ref.invalidate(financeAgreementsProvider),
      ),
      data: (rows) {
        final queue =
            rows.where((a) => _actionable.contains(a.status)).toList();
        final others =
            rows.where((a) => !_actionable.contains(a.status)).toList();
        return RefreshIndicator(
          color: AppTokens.brandNavy,
          onRefresh: () => ref.refresh(financeAgreementsProvider.future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space4, AppTokens.space4, AppTokens.space16),
            children: [
              SectionLabel('Awaiting review · ${queue.length}'),
              const SizedBox(height: AppTokens.space2),
              if (queue.isEmpty)
                const _Note('Nothing awaiting review.')
              else
                ...queue.map((a) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppTokens.space2),
                      child: _AgreementCard(
                          agreement: a, color: _statusColor(a.status)),
                    )),
              const SizedBox(height: AppTokens.space4),
              SectionLabel('All other agreements · ${others.length}'),
              const SizedBox(height: AppTokens.space2),
              if (others.isEmpty)
                const _Note('No other agreements.')
              else
                ...others.map((a) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppTokens.space2),
                      child: _AgreementCard(
                          agreement: a, color: _statusColor(a.status)),
                    )),
            ],
          ),
        );
      },
    );
  }
}

class _AgreementCard extends StatelessWidget {
  final Agreement agreement;
  final Color color;
  const _AgreementCard({required this.agreement, required this.color});

  @override
  Widget build(BuildContext context) {
    final a = agreement;
    final name = [a.leadFirstName, a.leadLastName]
        .whereType<String>()
        .where((s) => s.isNotEmpty)
        .join(' ');
    final resubmitted = (a.financeNotes?.isNotEmpty ?? false) &&
        _actionable.contains(a.status);
    return PremiumCard(
      onTap: () => context.push(AppRoutes.financeAgreement(a.id)),
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  a.agreementNumber ?? a.categoryKey ?? 'Agreement',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'monospace',
                      color: AppTokens.textPrimaryLight),
                ),
              ),
              StatusBadge(label: a.statusLabel, color: color),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            [
              if (name.isNotEmpty) name,
              if (a.leadReferenceCode != null) a.leadReferenceCode!,
              if (a.amountDisplay != null) a.amountDisplay!,
            ].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
                fontSize: 12, color: AppTokens.textMutedLight),
          ),
          if (resubmitted || a.submittedAt != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                if (resubmitted)
                  const Padding(
                    padding: EdgeInsets.only(right: 8),
                    child: StatusBadge(
                        label: 'Resubmitted',
                        color: AppTokens.statusWarning),
                  ),
                if (a.submittedAt != null)
                  Text('Submitted ${formatDate(a.submittedAt!)}',
                      style: const TextStyle(
                          fontSize: 11,
                          color: AppTokens.textMutedLight)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Note extends StatelessWidget {
  final String text;
  const _Note(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: AppTokens.space4),
        child: Center(
          child: Text(text,
              style: const TextStyle(
                  fontSize: 13, color: AppTokens.textMutedLight)),
        ),
      );
}

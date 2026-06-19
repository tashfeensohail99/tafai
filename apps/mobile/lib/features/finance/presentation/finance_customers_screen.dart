import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../../leads/domain/lead_options.dart';
import '../data/finance_providers.dart';
import '../domain/finance_models.dart';

/// Finance "Customers" tab — the searchable finance pipeline. Body widget (no
/// Scaffold; lives in the shell IndexedStack). Mirrors the leads-list pattern
/// (debounced search + tappable cards) and the web FinanceCustomersPage.
class FinanceCustomersScreen extends ConsumerStatefulWidget {
  const FinanceCustomersScreen({super.key});

  @override
  ConsumerState<FinanceCustomersScreen> createState() =>
      _FinanceCustomersScreenState();
}

class _FinanceCustomersScreenState
    extends ConsumerState<FinanceCustomersScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      ref.read(financeCustomersSearchProvider.notifier).state = v;
    });
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(financeCustomersProvider);
    final search = ref.watch(financeCustomersSearchProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
          child: PremiumSearchBar(
            controller: _searchCtrl,
            hint: 'Search name, phone, or reference…',
            onChanged: _onSearch,
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        Expanded(
          child: async.when(
            loading: () => const SkeletonList(),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(financeCustomersProvider),
            ),
            data: (rows) {
              if (rows.isEmpty) {
                final filtered = search.isNotEmpty;
                return EmptyView(
                  icon: filtered ? Icons.search_off : Icons.groups_outlined,
                  title: filtered
                      ? 'No matching customers'
                      : 'No customers yet',
                  message: filtered
                      ? 'Try a different search.'
                      : 'Customers appear here once an agreement, contract, or payment exists.',
                );
              }
              return RefreshIndicator(
                color: AppTokens.brandNavy,
                onRefresh: () =>
                    ref.refresh(financeCustomersProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                      AppTokens.space1, AppTokens.space4, AppTokens.space16),
                  itemCount: rows.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppTokens.space3),
                  itemBuilder: (_, i) => _CustomerCard(row: rows[i]),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _CustomerCard extends StatelessWidget {
  final FinanceCustomerRow row;
  const _CustomerCard({required this.row});

  ({String text, Color color}) _phase() {
    if (row.hasPendingPayment) {
      return (text: 'Payment to verify', color: AppTokens.statusWarning);
    }
    if (row.processingStage != null) {
      return (
        text: 'Processing · ${_label(row.processingStage!)}',
        color: AppTokens.primary600
      );
    }
    if (row.hasContract) {
      return (
        text: row.contractStatus != null
            ? _label(row.contractStatus!)
            : 'Active',
        color: AppTokens.statusSuccess
      );
    }
    if (row.agreementStatus != null) {
      return (
        text: 'Agreement · ${_label(row.agreementStatus!)}',
        color: _statusColor(row.agreementStatus!)
      );
    }
    return (text: _label(row.status), color: _statusColor(row.status));
  }

  static String _label(String s) =>
      s.replaceAll('_', ' ').toLowerCase();

  static Color _statusColor(String status) {
    final s = status.toUpperCase();
    if (['SIGNED', 'APPROVED', 'PAID', 'ACTIVE', 'COMPLETED', 'CONVERTED']
        .contains(s)) {
      return AppTokens.statusSuccess;
    }
    if (['SENT', 'SUBMITTED', 'FINANCE_REVIEW', 'IN_REVIEW', 'PARTIALLY_PAID']
        .contains(s)) {
      return AppTokens.statusInfo;
    }
    if (['CHANGES_REQUESTED', 'PENDING', 'DRAFT', 'OVERDUE'].contains(s)) {
      return AppTokens.statusWarning;
    }
    if (['CANCELLED', 'REJECTED', 'LOST'].contains(s)) {
      return AppTokens.statusDanger;
    }
    return AppTokens.statusNeutral;
  }

  String _money(double n) =>
      '${row.currency} ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final phase = _phase();
    final name = row.fullName.isEmpty ? '—' : row.fullName;
    return PremiumCard(
      onTap: () => context.push(AppRoutes.financeCustomer(row.leadId)),
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: AppTokens.avatarTintLight,
                  borderRadius: BorderRadius.all(AppTokens.radiusMd),
                ),
                alignment: Alignment.center,
                child: Text(
                  _initials(name),
                  style: const TextStyle(
                    color: AppTokens.avatarFg,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
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
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppTokens.textPrimaryLight)),
                    const SizedBox(height: 2),
                    Text(
                      '${row.referenceCode} · ${row.phone}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12,
                          color: AppTokens.textMutedLight),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${serviceTypeLabel(row.serviceInterest)}${row.targetCountry != null ? ' · ${row.targetCountry}' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12,
                          color: AppTokens.textMutedLight),
                    ),
                  ],
                ),
              ),
              PremiumStatusBadge(
                  label: phase.text, color: phase.color, compact: true),
            ],
          ),
          const SizedBox(height: AppTokens.space3),
          const Divider(height: 1),
          const SizedBox(height: AppTokens.space2),
          Row(
            children: [
              _moneyTile('Fee', _money(row.fee), AppTokens.textSecondaryLight),
              _moneyTile(
                  'Paid', _money(row.paid), AppTokens.statusSuccess),
              _moneyTile(
                'Outstanding',
                _money(row.outstanding),
                row.outstanding > 0
                    ? AppTokens.statusWarning
                    : AppTokens.textSecondaryLight,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _moneyTile(String label, String value, Color valueColor) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppTokens.textMutedLight,
                  letterSpacing: 0.4)),
          const SizedBox(height: 2),
          Text(value,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: valueColor)),
        ],
      ),
    );
  }
}

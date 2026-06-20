import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../../../core/widgets/premium_ui.dart';
import '../../leads/domain/lead_options.dart';
import '../data/finance_providers.dart';
import '../data/finance_repository.dart';
import '../domain/finance_models.dart';

enum _ProfileTab { overview, payments, agreement, expenses }

/// Finance customer profile — pushed route (/finance/customer/:leadId).
/// Tabbed: Overview / Payments (+ verify) / Agreement (view PDF, upload signed)
/// / Expenses. Mirrors the web FinanceCustomerProfilePage's read + action
/// surface, scoped to a phone-friendly single column.
class FinanceCustomerProfileScreen extends ConsumerStatefulWidget {
  final String leadId;
  const FinanceCustomerProfileScreen({super.key, required this.leadId});

  @override
  ConsumerState<FinanceCustomerProfileScreen> createState() =>
      _FinanceCustomerProfileScreenState();
}

class _FinanceCustomerProfileScreenState
    extends ConsumerState<FinanceCustomerProfileScreen> {
  _ProfileTab _tab = _ProfileTab.overview;
  String? _busy; // a token identifying the in-flight action

  String get _leadId => widget.leadId;

  void _reload() => ref.invalidate(financeCustomerProfileProvider(_leadId));

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? AppTokens.statusDanger : null,
    ));
  }

  // ── Open a signed URL in the device browser (never an in-app PDF viewer) ──
  Future<void> _openUrl(Future<String> Function() fetch, String token) async {
    setState(() => _busy = token);
    try {
      final url = await fetch();
      if (url.isEmpty) {
        _snack('No file available.', error: true);
        return;
      }
      final ok = await openExternalUrl(url);
      if (!ok) _snack('Could not open the file.', error: true);
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  // ── Verify a payment (maker-checker enforced server-side) ─────────────────
  Future<void> _verify(FinanceHandoverRow h, String? note) async {
    setState(() => _busy = 'verify:${h.id}');
    final repo = ref.read(financeRepositoryProvider);
    try {
      // Record the payment first if it hasn't been (one tap does both), then
      // verify → converts the client, issues the receipt, updates the ledger.
      String? paymentId;
      if (h.status == 'SUBMITTED' || h.status == 'IN_REVIEW') {
        final updated =
            await repo.reviewHandover(h.id, 'RECORD_PAYMENT', financeNotes: note);
        paymentId = updated.paymentId;
      }
      // For an already-recorded handover we don't have the paymentId on this
      // row; re-fetch the dashboard handover to read it back.
      paymentId ??= await _resolvePaymentId(h.id);
      if (paymentId == null || paymentId.isEmpty) {
        _snack('No payment row to verify — reopen the case.', error: true);
        return;
      }
      await repo.verifyPayment(paymentId, note: note);
      _snack('Payment verified — client, receipt and ledger updated.');
      _reload();
    } catch (e) {
      _snack(_verifyErrorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  /// Read back the payment id for an already-recorded handover via the
  /// finance handovers list (the profile rows don't carry it).
  Future<String?> _resolvePaymentId(String handoverId) async {
    final list = await ref.read(financeRepositoryProvider).handovers();
    for (final h in list) {
      if (h.id == handoverId) return h.paymentId;
    }
    return null;
  }

  /// Maker-checker surfaces as 403 (no verify permission) or 409 (same officer
  /// recorded + must be a different verifier). Give a clear, specific message
  /// rather than the generic AppError text.
  String _verifyErrorMessage(Object e) {
    if (e is ForbiddenError) {
      return 'You can\'t verify this payment. Large payments must be verified by a different officer (maker-checker).';
    }
    if (e is ConflictError) {
      return e.message.isNotEmpty
          ? e.message
          : 'This payment must be verified by a different officer than the one who recorded it (maker-checker).';
    }
    return messageForError(e);
  }

  Future<void> _reject(FinanceHandoverRow h, String? note) async {
    setState(() => _busy = 'reject:${h.id}');
    try {
      await ref
          .read(financeRepositoryProvider)
          .reviewHandover(h.id, 'REJECT', financeNotes: note);
      _snack('Payment proof rejected.');
      _reload();
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  // ── Upload the signed agreement PDF via file_picker → multipart ──────────
  Future<void> _uploadSigned(FinanceProfileAgreement agreement) async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    final path = picked?.files.single.path;
    if (path == null) return;
    setState(() => _busy = 'upload');
    try {
      await ref.read(financeRepositoryProvider).uploadSignedAgreement(
            agreement.id,
            filePath: path,
            fileName: picked!.files.single.name,
          );
      _snack('Signed agreement uploaded — ledger materialised.');
      _reload();
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  // ── Record a payment (creates a handover → enters the verification queue) ──
  Future<void> _recordPayment(FinanceCustomerProfile p) async {
    final input = await showModalBottomSheet<_NewPaymentInput>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _RecordPaymentSheet(defaultCurrency: p.totals.currency),
    );
    if (input == null) return;
    setState(() => _busy = 'record-payment');
    try {
      await ref.read(financeRepositoryProvider).createHandover(
            leadId: _leadId,
            submittedAmount: input.amount,
            currency: input.currency,
            paymentMethod: input.method,
            transactionRef: input.transactionRef,
            notes: input.notes,
            receiptFileName: input.receiptFileName,
            receiptContentBase64: input.receiptBase64,
            receiptMimeType: input.receiptMimeType,
          );
      _snack('Payment recorded — now in the verification queue.');
      _reload();
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  // ── Record an expense (a disbursement spent on the client's behalf) ───────
  Future<void> _addExpense(FinanceCustomerProfile p) async {
    final input = await showModalBottomSheet<_NewExpenseInput>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AddExpenseSheet(defaultCurrency: p.totals.currency),
    );
    if (input == null) return;
    setState(() => _busy = 'add-expense');
    try {
      await ref.read(financeRepositoryProvider).createExpense(
            leadId: _leadId,
            description: input.description,
            amount: input.amount,
            category: input.category,
            currency: input.currency,
            billable: input.billable,
          );
      _snack('Expense recorded.');
      _reload();
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(financeCustomerProfileProvider(_leadId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        title: const Text('Customer'),
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
      ),
      body: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: _reload,
        ),
        data: (p) => Column(
          children: [
            _MoneyStrip(profile: p),
            _TabBar(
              tab: _tab,
              onSelect: (t) => setState(() => _tab = t),
            ),
            Expanded(
              child: RefreshIndicator(
                color: AppTokens.brandNavy,
                onRefresh: () => ref
                    .refresh(financeCustomerProfileProvider(_leadId).future),
                child: _tabBody(p),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tabBody(FinanceCustomerProfile p) {
    return switch (_tab) {
      _ProfileTab.overview => _OverviewTab(profile: p),
      _ProfileTab.payments => _PaymentsTab(
          profile: p,
          busy: _busy,
          onRecordPayment: () => _recordPayment(p),
          onVerify: _verify,
          onReject: _reject,
        ),
      _ProfileTab.agreement => _AgreementTab(
          profile: p,
          busy: _busy,
          onOpenAgreementPdf: (a) => _openUrl(
              () => ref
                  .read(financeRepositoryProvider)
                  .agreementPdfUrl(a.id),
              'pdf'),
          onOpenSigned: (c) => _openUrl(
              () => ref
                  .read(financeRepositoryProvider)
                  .contractAgreementUrl(c.id),
              'signed'),
          onUploadSigned: _uploadSigned,
        ),
      _ProfileTab.expenses => _ExpensesTab(
          profile: p,
          busy: _busy,
          onAddExpense: () => _addExpense(p),
          onOpenReceipt: (id) => _openUrl(
              () => ref
                  .read(financeRepositoryProvider)
                  .expenseReceiptUrl(id),
              'exp:$id'),
        ),
    };
  }
}

// ─── Money strip ────────────────────────────────────────────────────────────

class _MoneyStrip extends StatelessWidget {
  final FinanceCustomerProfile profile;
  const _MoneyStrip({required this.profile});

  String _money(double n, String ccy) =>
      '$ccy ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  @override
  Widget build(BuildContext context) {
    final t = profile.totals;
    final lead = profile.lead;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(AppTokens.space4, AppTokens.space3,
          AppTokens.space4, AppTokens.space3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(lead.fullName.isEmpty ? '—' : lead.fullName,
              style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppTokens.textPrimaryLight)),
          const SizedBox(height: 2),
          Text(
            '${lead.referenceCode} · ${serviceTypeLabel(lead.serviceInterest)}${lead.targetCountry != null ? ' · ${lead.targetCountry}' : ''}',
            style: const TextStyle(
                fontSize: 12, color: AppTokens.textMutedLight),
          ),
          const SizedBox(height: AppTokens.space3),
          Row(
            children: [
              _tile('Fee', _money(t.fee, t.currency),
                  AppTokens.textPrimaryLight),
              _tile('Paid', _money(t.paid, t.currency),
                  AppTokens.statusSuccess),
              _tile(
                'Outstanding',
                _money(t.outstanding, t.currency),
                t.outstanding > 0
                    ? AppTokens.statusWarning
                    : AppTokens.textSecondaryLight,
              ),
              _tile(
                'Margin',
                _money(t.margin, t.currency),
                t.margin >= 0
                    ? AppTokens.statusSuccess
                    : AppTokens.statusDanger,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tile(String label, String value, Color color) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppTokens.textMutedLight)),
          const SizedBox(height: 2),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: color)),
        ],
      ),
    );
  }
}

// ─── Tab bar ────────────────────────────────────────────────────────────────

class _TabBar extends StatelessWidget {
  final _ProfileTab tab;
  final ValueChanged<_ProfileTab> onSelect;
  const _TabBar({required this.tab, required this.onSelect});

  static const _labels = {
    _ProfileTab.overview: 'Overview',
    _ProfileTab.payments: 'Payments',
    _ProfileTab.agreement: 'Agreement',
    _ProfileTab.expenses: 'Expenses',
  };

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(
          AppTokens.space4, 0, AppTokens.space4, AppTokens.space2),
      child: Row(
        children: [
          for (final entry in _labels.entries)
            Expanded(
              child: GestureDetector(
                onTap: () => onSelect(entry.key),
                behavior: HitTestBehavior.opaque,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    children: [
                      Text(
                        entry.value,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: tab == entry.key
                              ? FontWeight.w700
                              : FontWeight.w500,
                          color: tab == entry.key
                              ? AppTokens.brandNavy
                              : AppTokens.textMutedLight,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        height: 2,
                        color: tab == entry.key
                            ? AppTokens.brandNavy
                            : Colors.transparent,
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ─── Overview tab ───────────────────────────────────────────────────────────

class _OverviewTab extends StatelessWidget {
  final FinanceCustomerProfile profile;
  const _OverviewTab({required this.profile});

  @override
  Widget build(BuildContext context) {
    final lead = profile.lead;
    final rows = <MapEntry<String, String?>>[
      MapEntry('Reference', lead.referenceCode),
      MapEntry('Phone', lead.phone),
      MapEntry('Email', lead.email),
      MapEntry('Nationality', lead.nationality),
      MapEntry('Target country', lead.targetCountry),
      MapEntry('Service', serviceTypeLabel(lead.serviceInterest)),
      MapEntry('Source', lead.sourceChannel),
      MapEntry('Assigned agent', lead.assignedEmployeeName),
      MapEntry('Lead since',
          lead.createdAt != null ? formatDate(lead.createdAt!) : null),
      MapEntry('Stage', lead.status.replaceAll('_', ' ').toLowerCase()),
    ].where((e) => e.value != null && e.value!.trim().isNotEmpty).toList();

    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        if (profile.processingCase != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTokens.space3),
            child: PremiumCard(
              padding: const EdgeInsets.all(AppTokens.space3),
              child: Row(
                children: [
                  const Icon(Icons.local_shipping_outlined,
                      size: 18, color: AppTokens.primary600),
                  const SizedBox(width: AppTokens.space2),
                  Expanded(
                    child: Text(
                      'In processing · ${profile.processingCase!.stage.replaceAll('_', ' ').toLowerCase()}',
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppTokens.textSecondaryLight),
                    ),
                  ),
                ],
              ),
            ),
          ),
        PremiumCard(
          padding: const EdgeInsets.all(AppTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionLabel('Bio'),
              const SizedBox(height: AppTokens.space2),
              for (final e in rows) _kv(e.key, e.value!),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Payments tab ───────────────────────────────────────────────────────────

class _PaymentsTab extends StatelessWidget {
  final FinanceCustomerProfile profile;
  final String? busy;
  final VoidCallback onRecordPayment;
  final void Function(FinanceHandoverRow, String? note) onVerify;
  final void Function(FinanceHandoverRow, String? note) onReject;
  const _PaymentsTab({
    required this.profile,
    required this.busy,
    required this.onRecordPayment,
    required this.onVerify,
    required this.onReject,
  });

  String _money(double n, String ccy) =>
      '$ccy ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  Color _statusColor(String status) {
    final s = status.toUpperCase();
    if (['PAID', 'PAYMENT_VERIFIED', 'SENT_TO_PROCESSING', 'COMPLETED']
        .contains(s)) {
      return AppTokens.statusSuccess;
    }
    if (['SUBMITTED', 'IN_REVIEW', 'PARTIAL', 'PARTIALLY_PAID', 'PAYMENT_RECORDED']
        .contains(s)) {
      return AppTokens.statusInfo;
    }
    if (['PENDING'].contains(s)) return AppTokens.statusWarning;
    if (['REJECTED', 'CANCELLED', 'REFUNDED', 'DISPUTED'].contains(s)) {
      return AppTokens.statusDanger;
    }
    return AppTokens.statusNeutral;
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        SizedBox(
          width: double.infinity,
          height: 46,
          child: FilledButton.icon(
            style:
                FilledButton.styleFrom(backgroundColor: AppTokens.primary600),
            onPressed: busy != null ? null : onRecordPayment,
            icon: const Icon(Icons.add_card_outlined, size: 20),
            label: Text(
                busy == 'record-payment' ? 'Saving…' : 'Record a payment'),
          ),
        ),
        const SizedBox(height: AppTokens.space4),
        const SectionLabel('Payment submissions'),
        const SizedBox(height: AppTokens.space2),
        if (profile.handovers.isEmpty)
          const _EmptyNote('No payments recorded yet.')
        else
          ...profile.handovers.map((h) {
            final done = ['PAYMENT_VERIFIED', 'SENT_TO_PROCESSING']
                .contains(h.status);
            final isBusy =
                busy == 'verify:${h.id}' || busy == 'reject:${h.id}';
            return Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space2),
              child: PremiumCard(
                padding: const EdgeInsets.all(AppTokens.space3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(_money(h.amount, h.currency),
                              style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: AppTokens.textPrimaryLight)),
                        ),
                        StatusBadge(
                          label:
                              h.status.replaceAll('_', ' ').toLowerCase(),
                          color: _statusColor(h.status),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${h.receiptFileName ?? 'No receipt'}${h.submittedAt != null ? ' · ${formatDate(h.submittedAt!)}' : ''}',
                      style: const TextStyle(
                          fontSize: 12,
                          color: AppTokens.textMutedLight),
                    ),
                    if (!done &&
                        h.status != 'REJECTED' &&
                        h.status != 'CANCELLED') ...[
                      const SizedBox(height: AppTokens.space2),
                      Row(
                        children: [
                          CrmActionButton(
                            label: isBusy ? 'Working…' : 'Review & verify',
                            icon: Icons.verified_outlined,
                            filled: true,
                            onPressed: isBusy
                                ? null
                                : () => _openVerifySheet(context, h),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            );
          }),
        const SizedBox(height: AppTokens.space4),
        const SectionLabel('Verified payments'),
        const SizedBox(height: AppTokens.space2),
        if (profile.payments.isEmpty)
          const _EmptyNote('No verified payments yet.')
        else
          ...profile.payments.map((p) => Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.space2),
                child: PremiumCard(
                  padding: const EdgeInsets.all(AppTokens.space3),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_money(p.amount, p.currency),
                                style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                    color: AppTokens.textPrimaryLight)),
                            Text(
                              '${p.paymentMethod ?? '—'}${p.verifiedAt != null ? ' · verified ${formatDate(p.verifiedAt!)}' : ''}',
                              style: const TextStyle(
                                  fontSize: 12,
                                  color: AppTokens.textMutedLight),
                            ),
                          ],
                        ),
                      ),
                      StatusBadge(
                        label: p.status.replaceAll('_', ' ').toLowerCase(),
                        color: _statusColor(p.status),
                      ),
                    ],
                  ),
                ),
              )),
      ],
    );
  }

  void _openVerifySheet(BuildContext context, FinanceHandoverRow h) {
    final noteCtrl = TextEditingController();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: AppTokens.radiusCardLg),
      ),
      builder: (sheetCtx) {
        return Padding(
          padding: EdgeInsets.only(
            left: AppTokens.space4,
            right: AppTokens.space4,
            top: AppTokens.space4,
            bottom: MediaQuery.of(sheetCtx).viewInsets.bottom +
                AppTokens.space4,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Verify payment',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppTokens.textPrimaryLight)),
              const SizedBox(height: 4),
              Text(
                '${_money(h.amount, h.currency)} · ${h.receiptFileName ?? 'no receipt'}',
                style: const TextStyle(
                    fontSize: 13, color: AppTokens.textMutedLight),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: noteCtrl,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Finance note (optional)',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: AppTokens.space2),
              const Text(
                '⚖︎ Large payments must be verified by a different officer than the one who recorded them.',
                style: TextStyle(
                    fontSize: 11.5, color: AppTokens.textMutedLight),
              ),
              const SizedBox(height: AppTokens.space3),
              Row(
                children: [
                  Expanded(
                    child: CrmActionButton(
                      label: 'Verify',
                      icon: Icons.verified_outlined,
                      filled: true,
                      onPressed: () {
                        Navigator.of(sheetCtx).pop();
                        onVerify(h, noteCtrl.text.trim().isEmpty
                            ? null
                            : noteCtrl.text.trim());
                      },
                    ),
                  ),
                  const SizedBox(width: AppTokens.space2),
                  Expanded(
                    child: CrmActionButton(
                      label: 'Reject',
                      color: AppTokens.statusDanger,
                      onPressed: () {
                        Navigator.of(sheetCtx).pop();
                        onReject(h, noteCtrl.text.trim().isEmpty
                            ? null
                            : noteCtrl.text.trim());
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─── Agreement tab ──────────────────────────────────────────────────────────

class _AgreementTab extends StatelessWidget {
  final FinanceCustomerProfile profile;
  final String? busy;
  final void Function(FinanceProfileAgreement) onOpenAgreementPdf;
  final void Function(FinanceProfileContract) onOpenSigned;
  final void Function(FinanceProfileAgreement) onUploadSigned;
  const _AgreementTab({
    required this.profile,
    required this.busy,
    required this.onOpenAgreementPdf,
    required this.onOpenSigned,
    required this.onUploadSigned,
  });

  String _money(double n, String ccy) =>
      '$ccy ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  Color _statusColor(String status) {
    final s = status.toUpperCase();
    if (['SIGNED', 'APPROVED'].contains(s)) return AppTokens.statusSuccess;
    if (['SENT', 'SUBMITTED', 'FINANCE_REVIEW'].contains(s)) {
      return AppTokens.statusInfo;
    }
    if (['CHANGES_REQUESTED', 'DRAFT'].contains(s)) {
      return AppTokens.statusWarning;
    }
    if (['CANCELLED', 'REJECTED'].contains(s)) return AppTokens.statusDanger;
    return AppTokens.statusNeutral;
  }

  @override
  Widget build(BuildContext context) {
    final agreement = profile.agreement;
    final contract = profile.contract;
    if (agreement == null) {
      return ListView(
        padding: const EdgeInsets.all(AppTokens.space4),
        children: const [_EmptyNote('No agreement for this customer yet.')],
      );
    }
    final canUpload = ['APPROVED', 'SENT', 'SIGNED'].contains(agreement.status);
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        PremiumCard(
          padding: const EdgeInsets.all(AppTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(agreement.agreementNumber,
                        style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            fontFamily: 'monospace',
                            color: AppTokens.textPrimaryLight)),
                  ),
                  StatusBadge(
                    label:
                        agreement.status.replaceAll('_', ' ').toLowerCase(),
                    color: _statusColor(agreement.status),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('${_money(agreement.totalAmount, agreement.currency)} net',
                  style: const TextStyle(
                      fontSize: 13, color: AppTokens.textMutedLight)),
              if (agreement.hasPdf) ...[
                const SizedBox(height: AppTokens.space3),
                CrmActionButton(
                  label: busy == 'pdf' ? 'Opening…' : 'View agreement PDF',
                  icon: Icons.picture_as_pdf_outlined,
                  onPressed: busy != null
                      ? null
                      : () => onOpenAgreementPdf(agreement),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        PremiumCard(
          padding: const EdgeInsets.all(AppTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionLabel('Signed agreement'),
              const SizedBox(height: AppTokens.space2),
              if (contract?.hasSignedAgreement == true) ...[
                Row(
                  children: [
                    const Icon(Icons.check_circle,
                        size: 16, color: AppTokens.statusSuccess),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        contract!.agreementFileName ?? 'Signed copy on file',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 13,
                            color: AppTokens.textSecondaryLight),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppTokens.space2),
                Row(
                  children: [
                    Expanded(
                      child: CrmActionButton(
                        label: busy == 'signed' ? 'Opening…' : 'Download',
                        icon: Icons.download_outlined,
                        onPressed: busy != null
                            ? null
                            : () => onOpenSigned(contract),
                      ),
                    ),
                    const SizedBox(width: AppTokens.space2),
                    Expanded(
                      child: CrmActionButton(
                        label: busy == 'upload' ? 'Uploading…' : 'Replace',
                        icon: Icons.upload_file_outlined,
                        filled: true,
                        onPressed: busy != null
                            ? null
                            : () => onUploadSigned(agreement),
                      ),
                    ),
                  ],
                ),
              ] else if (canUpload) ...[
                const Text(
                  'No signed copy yet. Uploading it creates the ledger and marks the agreement signed.',
                  style: TextStyle(
                      fontSize: 13, color: AppTokens.textMutedLight),
                ),
                const SizedBox(height: AppTokens.space2),
                CrmActionButton(
                  label: busy == 'upload'
                      ? 'Uploading…'
                      : 'Upload signed agreement',
                  icon: Icons.upload_file_outlined,
                  filled: true,
                  onPressed:
                      busy != null ? null : () => onUploadSigned(agreement),
                ),
              ] else
                const Text('Available once Finance approves the agreement.',
                    style: TextStyle(
                        fontSize: 13, color: AppTokens.textMutedLight)),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Expenses tab ───────────────────────────────────────────────────────────

class _ExpensesTab extends StatelessWidget {
  final FinanceCustomerProfile profile;
  final String? busy;
  final VoidCallback onAddExpense;
  final void Function(String expenseId) onOpenReceipt;
  const _ExpensesTab({
    required this.profile,
    required this.busy,
    required this.onAddExpense,
    required this.onOpenReceipt,
  });

  String _money(double n, String ccy) =>
      '$ccy ${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2)}';

  String _catLabel(String c) => switch (c) {
        'GOVERNMENT_FEE' => 'Government fee',
        'EMBASSY' => 'Embassy / consulate',
        'MEDICAL' => 'Medical / biometrics',
        'TRANSLATION' => 'Translation / attestation',
        'COURIER' => 'Courier / shipping',
        'THIRD_PARTY' => 'Third-party vendor',
        'OTHER' => 'Other',
        _ => c.replaceAll('_', ' ').toLowerCase(),
      };

  @override
  Widget build(BuildContext context) {
    final t = profile.totals;
    final adding = busy == 'add-expense';
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        SizedBox(
          width: double.infinity,
          height: 46,
          child: FilledButton.icon(
            style:
                FilledButton.styleFrom(backgroundColor: AppTokens.primary600),
            onPressed: busy != null ? null : onAddExpense,
            icon: const Icon(Icons.add, size: 20),
            label: Text(adding ? 'Saving…' : 'Add expense'),
          ),
        ),
        const SizedBox(height: AppTokens.space4),
        if (profile.expenses.isEmpty)
          const _EmptyNote('No expenses recorded for this client yet.')
        else ...[
          SectionLabel(
              'Expense ledger · ${_money(t.expenses, t.currency)} total'),
          const SizedBox(height: AppTokens.space2),
          ...profile.expenses.map((e) => Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space2),
              child: PremiumCard(
                padding: const EdgeInsets.all(AppTokens.space3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(e.description,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: AppTokens.textPrimaryLight)),
                        ),
                        Text(_money(e.amount, e.currency),
                            style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: AppTokens.textPrimaryLight)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        StatusBadge(
                            label: _catLabel(e.category),
                            color: AppTokens.statusNeutral),
                        if (e.billable)
                          const StatusBadge(
                              label: 'billable',
                              color: AppTokens.statusInfo),
                        if (e.incurredAt != null)
                          Text(formatDate(e.incurredAt!),
                              style: const TextStyle(
                                  fontSize: 11,
                                  color: AppTokens.textMutedLight)),
                      ],
                    ),
                    if (e.hasReceipt) ...[
                      const SizedBox(height: AppTokens.space2),
                      CrmActionButton(
                        label: busy == 'exp:${e.id}'
                            ? 'Opening…'
                            : 'View receipt',
                        icon: Icons.receipt_long_outlined,
                        onPressed:
                            busy != null ? null : () => onOpenReceipt(e.id),
                      ),
                    ],
                  ],
                ),
              ),
            )),
        ],
      ],
    );
  }
}

// ─── Add-expense sheet ────────────────────────────────────────────────────

/// What [_AddExpenseSheet] returns to the profile screen, which performs the
/// POST /finance/expenses.
class _NewExpenseInput {
  final String amount;
  final String currency;
  final String category;
  final String description;
  final bool billable;
  const _NewExpenseInput({
    required this.amount,
    required this.currency,
    required this.category,
    required this.description,
    required this.billable,
  });
}

class _AddExpenseSheet extends StatefulWidget {
  final String defaultCurrency;
  const _AddExpenseSheet({required this.defaultCurrency});

  @override
  State<_AddExpenseSheet> createState() => _AddExpenseSheetState();
}

class _AddExpenseSheetState extends State<_AddExpenseSheet> {
  static const _categories = <(String, String)>[
    ('GOVERNMENT_FEE', 'Government fee'),
    ('EMBASSY', 'Embassy / consulate'),
    ('MEDICAL', 'Medical / biometrics'),
    ('TRANSLATION', 'Translation / attestation'),
    ('COURIER', 'Courier / shipping'),
    ('THIRD_PARTY', 'Third-party vendor'),
    ('OTHER', 'Other'),
  ];

  late final TextEditingController _amount;
  late final TextEditingController _currency;
  late final TextEditingController _description;
  String _category = 'OTHER';
  bool _billable = false;

  @override
  void initState() {
    super.initState();
    _amount = TextEditingController();
    _currency = TextEditingController(text: widget.defaultCurrency);
    _description = TextEditingController();
  }

  @override
  void dispose() {
    _amount.dispose();
    _currency.dispose();
    _description.dispose();
    super.dispose();
  }

  bool get _canSave {
    final amt = double.tryParse(_amount.text.trim());
    return amt != null && amt > 0 && _description.text.trim().isNotEmpty;
  }

  void _submit() {
    Navigator.of(context).pop(_NewExpenseInput(
      amount: _amount.text.trim(),
      currency: _currency.text.trim(),
      category: _category,
      description: _description.text.trim(),
      billable: _billable,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppTokens.surfaceLight,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(AppTokens.space5),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTokens.borderStrongLight,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: AppTokens.space4),
              Text('Record an expense',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              const Text(
                'A cost paid on the client’s behalf (government fee, medical, '
                'courier, etc.).',
                style:
                    TextStyle(fontSize: 13, color: AppTokens.textMutedLight),
              ),
              const SizedBox(height: AppTokens.space4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _amount,
                      keyboardType: const TextInputType.numberWithOptions(
                          decimal: true),
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Amount',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTokens.space3),
                  Expanded(
                    child: TextField(
                      controller: _currency,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(
                        labelText: 'Currency',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTokens.space3),
              DropdownButtonFormField<String>(
                initialValue: _category,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Category',
                  border: OutlineInputBorder(),
                ),
                items: _categories
                    .map((c) =>
                        DropdownMenuItem(value: c.$1, child: Text(c.$2)))
                    .toList(),
                onChanged: (v) => setState(() => _category = v ?? 'OTHER'),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _description,
                maxLines: 2,
                onChanged: (_) => setState(() {}),
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTokens.space2),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Rebillable to the client',
                    style: TextStyle(fontSize: 14)),
                subtitle: const Text('Off = absorbed firm cost',
                    style: TextStyle(
                        fontSize: 12, color: AppTokens.textMutedLight)),
                value: _billable,
                activeThumbColor: AppTokens.primary600,
                onChanged: (v) => setState(() => _billable = v),
              ),
              const SizedBox(height: AppTokens.space3),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTokens.primary600,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: _canSave ? _submit : null,
                  child: const Text('Save expense'),
                ),
              ),
              const SizedBox(height: AppTokens.space2),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Record-payment sheet ──────────────────────────────────────────────────

/// What [_RecordPaymentSheet] returns to the profile screen, which performs
/// the POST /finance/handovers.
class _NewPaymentInput {
  final String amount;
  final String currency;
  final String method;
  final String transactionRef;
  final String notes;
  final String receiptFileName;
  final String receiptBase64;
  final String? receiptMimeType;
  const _NewPaymentInput({
    required this.amount,
    required this.currency,
    required this.method,
    required this.transactionRef,
    required this.notes,
    required this.receiptFileName,
    required this.receiptBase64,
    this.receiptMimeType,
  });
}

class _RecordPaymentSheet extends StatefulWidget {
  final String defaultCurrency;
  const _RecordPaymentSheet({required this.defaultCurrency});

  @override
  State<_RecordPaymentSheet> createState() => _RecordPaymentSheetState();
}

class _RecordPaymentSheetState extends State<_RecordPaymentSheet> {
  static const _methods = <String>[
    'Bank transfer',
    'Cash',
    'Card',
    'Cheque',
    'Online',
    'Other',
  ];

  late final TextEditingController _amount;
  late final TextEditingController _currency;
  late final TextEditingController _ref;
  late final TextEditingController _notes;
  String _method = 'Bank transfer';

  String? _receiptName;
  String? _receiptBase64;
  String? _receiptMime;
  bool _picking = false;

  @override
  void initState() {
    super.initState();
    _amount = TextEditingController();
    _currency = TextEditingController(text: widget.defaultCurrency);
    _ref = TextEditingController();
    _notes = TextEditingController();
  }

  @override
  void dispose() {
    _amount.dispose();
    _currency.dispose();
    _ref.dispose();
    _notes.dispose();
    super.dispose();
  }

  String? _mimeFor(String? ext) {
    switch ((ext ?? '').toLowerCase()) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      default:
        return null;
    }
  }

  Future<void> _pickReceipt() async {
    setState(() => _picking = true);
    try {
      final picked = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
        withData: true,
      );
      final file = picked?.files.single;
      final bytes = file?.bytes;
      if (file == null || bytes == null) return;
      setState(() {
        _receiptName = file.name;
        _receiptBase64 = base64Encode(bytes);
        _receiptMime = _mimeFor(file.extension);
      });
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  bool get _canSave {
    final amt = double.tryParse(_amount.text.trim());
    return amt != null && amt > 0 && _receiptBase64 != null;
  }

  void _submit() {
    Navigator.of(context).pop(_NewPaymentInput(
      amount: _amount.text.trim(),
      currency: _currency.text.trim(),
      method: _method,
      transactionRef: _ref.text.trim(),
      notes: _notes.text.trim(),
      receiptFileName: _receiptName ?? 'receipt',
      receiptBase64: _receiptBase64!,
      receiptMimeType: _receiptMime,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppTokens.surfaceLight,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(AppTokens.space5),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTokens.borderStrongLight,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: AppTokens.space4),
              Text('Record a payment',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              const Text(
                'Logs a payment with its proof. It enters the verification '
                'queue — a different officer verifies large payments.',
                style:
                    TextStyle(fontSize: 13, color: AppTokens.textMutedLight),
              ),
              const SizedBox(height: AppTokens.space4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _amount,
                      keyboardType: const TextInputType.numberWithOptions(
                          decimal: true),
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Amount',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTokens.space3),
                  Expanded(
                    child: TextField(
                      controller: _currency,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(
                        labelText: 'Currency',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTokens.space3),
              DropdownButtonFormField<String>(
                initialValue: _method,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Method',
                  border: OutlineInputBorder(),
                ),
                items: _methods
                    .map((m) => DropdownMenuItem(value: m, child: Text(m)))
                    .toList(),
                onChanged: (v) =>
                    setState(() => _method = v ?? 'Bank transfer'),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _ref,
                decoration: const InputDecoration(
                  labelText: 'Transaction reference (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _notes,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Notes (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              OutlinedButton.icon(
                onPressed: _picking ? null : _pickReceipt,
                icon: const Icon(Icons.attach_file, size: 18),
                label: Text(
                  _picking
                      ? 'Selecting…'
                      : (_receiptName ?? 'Attach payment proof (required)'),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(height: AppTokens.space4),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTokens.primary600,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: _canSave ? _submit : null,
                  child: const Text('Save payment'),
                ),
              ),
              const SizedBox(height: AppTokens.space2),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Small helpers ──────────────────────────────────────────────────────────

class _EmptyNote extends StatelessWidget {
  final String text;
  const _EmptyNote(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: AppTokens.space6),
        child: Center(
          child: Text(text,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 13, color: AppTokens.textMutedLight)),
        ),
      );
}

Widget _kv(String label, String value) {
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(label,
              style: const TextStyle(
                  fontSize: 12, color: AppTokens.textMutedLight)),
        ),
        Expanded(
          child: Text(value,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppTokens.textSecondaryLight)),
        ),
      ],
    ),
  );
}

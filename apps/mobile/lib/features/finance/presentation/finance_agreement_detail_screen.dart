import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../../../core/widgets/premium_ui.dart';
import '../../agreements/domain/agreement.dart';
import '../data/finance_providers.dart';
import '../data/finance_repository.dart';

const _actionable = {'SUBMITTED', 'FINANCE_REVIEW'};
const _hasPdf = {'APPROVED', 'SENT', 'SIGNED'};
const _canUploadSigned = {'APPROVED', 'SENT', 'SIGNED'};

/// Finance agreement review — pushed route (/finance/agreements/:id). Read
/// surface (bio + plan + notes + history) plus the finance decision actions:
/// Approve, Request changes, View PDF, Upload signed. Mirrors the web
/// FinanceAgreementReviewPage.
class FinanceAgreementDetailScreen extends ConsumerStatefulWidget {
  final String agreementId;
  const FinanceAgreementDetailScreen({super.key, required this.agreementId});

  @override
  ConsumerState<FinanceAgreementDetailScreen> createState() =>
      _FinanceAgreementDetailScreenState();
}

class _FinanceAgreementDetailScreenState
    extends ConsumerState<FinanceAgreementDetailScreen> {
  String? _busy;

  String get _id => widget.agreementId;

  void _reload() => ref.invalidate(financeAgreementDetailProvider(_id));

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? AppTokens.statusDanger : null,
    ));
  }

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

  String _money(double? n, String? ccy) {
    if (n == null) return '—';
    final c = (ccy ?? '').trim();
    final v = n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2);
    return c.isEmpty ? v : '$c $v';
  }

  Future<void> _approve() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Approve agreement?'),
        content: const Text(
            'This locks the payment plan and creates the service contract + installment ledger.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Approve')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = 'approve');
    try {
      await ref.read(financeRepositoryProvider).approveAgreement(_id);
      _snack('Approved — contract + ledger created.');
      _reload();
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _requestChanges() async {
    final noteCtrl = TextEditingController();
    final note = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Request changes'),
        content: TextField(
          controller: noteCtrl,
          maxLines: 3,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'What needs to change?',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(ctx).pop(noteCtrl.text.trim()),
              child: const Text('Send back')),
        ],
      ),
    );
    if (note == null || note.isEmpty) return;
    setState(() => _busy = 'changes');
    try {
      await ref
          .read(financeRepositoryProvider)
          .requestAgreementChanges(_id, note);
      _snack('Sent back to Sales.');
      _reload();
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _openPdf() async {
    setState(() => _busy = 'pdf');
    try {
      final url = await ref.read(financeRepositoryProvider).agreementPdfUrl(_id);
      if (url.isEmpty) {
        _snack('No PDF available.', error: true);
        return;
      }
      final ok = await openExternalUrl(url);
      if (!ok) _snack('Could not open the PDF.', error: true);
    } catch (e) {
      _snack(messageForError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _uploadSigned() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    );
    final path = picked?.files.single.path;
    if (path == null) return;
    setState(() => _busy = 'upload');
    try {
      await ref.read(financeRepositoryProvider).uploadSignedAgreement(
            _id,
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

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(financeAgreementDetailProvider(_id));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        title: const Text('Agreement review'),
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
      ),
      body: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(error: e, onRetry: _reload),
        data: (a) {
          final actionable = _actionable.contains(a.status);
          final showPdf = _hasPdf.contains(a.status);
          final canUpload = _canUploadSigned.contains(a.status);
          final busy = _busy != null;
          return RefreshIndicator(
            color: AppTokens.brandNavy,
            onRefresh: () =>
                ref.refresh(financeAgreementDetailProvider(_id).future),
            child: ListView(
              padding: const EdgeInsets.all(AppTokens.space4),
              children: [
                // Header + actions
                PremiumCard(
                  padding: const EdgeInsets.all(AppTokens.space4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(a.title,
                                style: const TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    color: AppTokens.textPrimaryLight)),
                          ),
                          StatusBadge(
                              label: a.statusLabel,
                              color: _statusColor(a.status)),
                        ],
                      ),
                      if (a.amountDisplay != null) ...[
                        const SizedBox(height: 4),
                        Text(a.amountDisplay!,
                            style: const TextStyle(
                                fontSize: 13,
                                color: AppTokens.textMutedLight)),
                      ],
                      const SizedBox(height: AppTokens.space3),
                      Wrap(
                        spacing: AppTokens.space2,
                        runSpacing: AppTokens.space2,
                        children: [
                          if (showPdf)
                            CrmActionButton(
                              label: _busy == 'pdf' ? 'Opening…' : 'View PDF',
                              icon: Icons.picture_as_pdf_outlined,
                              onPressed: busy ? null : _openPdf,
                            ),
                          if (canUpload)
                            CrmActionButton(
                              label: _busy == 'upload'
                                  ? 'Uploading…'
                                  : 'Upload signed',
                              icon: Icons.upload_file_outlined,
                              onPressed: busy ? null : _uploadSigned,
                            ),
                          if (actionable) ...[
                            CrmActionButton(
                              label: 'Request changes',
                              icon: Icons.undo,
                              onPressed: busy ? null : _requestChanges,
                            ),
                            CrmActionButton(
                              label:
                                  _busy == 'approve' ? 'Approving…' : 'Approve',
                              icon: Icons.thumb_up_alt_outlined,
                              filled: true,
                              onPressed: busy ? null : _approve,
                            ),
                          ],
                        ],
                      ),
                      if (a.financeNotes?.isNotEmpty ?? false) ...[
                        const SizedBox(height: AppTokens.space2),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(AppTokens.space2),
                          decoration: const BoxDecoration(
                            color: AppTokens.statusWarningBg,
                            borderRadius:
                                BorderRadius.all(AppTokens.radiusMd),
                          ),
                          child: Text('Finance note: ${a.financeNotes}',
                              style: const TextStyle(
                                  fontSize: 12,
                                  color: AppTokens.statusWarning)),
                        ),
                      ],
                    ],
                  ),
                ),
                if (a.bio != null) ...[
                  const SizedBox(height: AppTokens.space3),
                  _bioCard(a.bio!),
                ],
                const SizedBox(height: AppTokens.space3),
                _planCard(a.paymentPlan),
                if (a.salesNotes?.isNotEmpty ?? false) ...[
                  const SizedBox(height: AppTokens.space3),
                  PremiumCard(
                    padding: const EdgeInsets.all(AppTokens.space4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Sales notes'),
                        const SizedBox(height: AppTokens.space2),
                        Text(a.salesNotes!,
                            style: const TextStyle(
                                fontSize: 13,
                                color: AppTokens.textSecondaryLight)),
                      ],
                    ),
                  ),
                ],
                if (a.events.isNotEmpty) ...[
                  const SizedBox(height: AppTokens.space3),
                  _historyCard(a.events),
                ],
                const SizedBox(height: AppTokens.space8),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _bioCard(AgreementBio bio) {
    final rows = <MapEntry<String, String?>>[
      MapEntry('Applicant', bio.applicantName),
      MapEntry('Father / guardian', bio.fatherName),
      MapEntry('CNIC', bio.cnic),
      MapEntry('Passport', bio.passport),
      MapEntry('Nationality', bio.nationality),
      MapEntry('Destination', bio.country),
      MapEntry('Phone', bio.phone),
      MapEntry('Email', bio.email),
      MapEntry('File #', bio.fileNumber),
    ].where((e) => e.value != null && e.value!.trim().isNotEmpty).toList();
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionLabel('Applicant'),
          const SizedBox(height: AppTokens.space2),
          for (final e in rows) _kv(e.key, e.value!),
        ],
      ),
    );
  }

  Widget _planCard(AgreementPaymentPlan? plan) {
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionLabel('Payment plan'),
          const SizedBox(height: AppTokens.space2),
          if (plan == null)
            const Text('No payment plan set yet.',
                style: TextStyle(
                    fontSize: 13, color: AppTokens.textMutedLight))
          else ...[
            _kv('Type', plan.planType ?? '—'),
            if (plan.grossAmount != null)
              _kv('Gross', _money(plan.grossAmount, plan.currency)),
            if ((plan.discountAmount ?? 0) > 0)
              _kv('Discount', '− ${_money(plan.discountAmount, plan.currency)}'),
            _kv('Net payable', _money(plan.netPayable, plan.currency)),
            if (plan.installments.isNotEmpty) ...[
              const SizedBox(height: AppTokens.space2),
              const Text('Installments',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppTokens.textSecondaryLight)),
              const SizedBox(height: 4),
              for (final i in plan.installments)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                          width: 22,
                          child: Text('${i.sequence ?? '·'}.',
                              style: const TextStyle(
                                  fontSize: 13,
                                  color: AppTokens.textMutedLight))),
                      Expanded(
                        child: Text(i.stage ?? 'Installment',
                            style: const TextStyle(
                                fontSize: 13,
                                color: AppTokens.textSecondaryLight)),
                      ),
                      Text(_money(i.amount, plan.currency),
                          style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppTokens.textPrimaryLight)),
                    ],
                  ),
                ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _historyCard(List<AgreementEvent> events) {
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionLabel('History'),
          const SizedBox(height: AppTokens.space2),
          for (final e in events)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 5, right: 8),
                    child: Icon(Icons.circle,
                        size: 7, color: AppTokens.statusNeutral),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(e.summary ?? e.type ?? 'Update',
                            style: const TextStyle(
                                fontSize: 13,
                                color: AppTokens.textSecondaryLight)),
                        if (e.createdAt != null)
                          Text(formatDateTime(e.createdAt!),
                              style: const TextStyle(
                                  fontSize: 11,
                                  color: AppTokens.textMutedLight)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
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
}

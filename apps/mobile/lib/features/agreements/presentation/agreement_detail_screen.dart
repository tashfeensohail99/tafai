import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../data/agreements_providers.dart';
import '../data/agreements_repository.dart';
import '../domain/agreement.dart';
import 'pdf_viewer_screen.dart';

Color _statusColor(String status) => switch (status) {
      'DRAFT' => AppTokens.statusNeutral,
      'SUBMITTED' || 'FINANCE_REVIEW' => AppTokens.statusWarning,
      'APPROVED' || 'SENT' => AppTokens.statusInfo,
      'SIGNED' => AppTokens.statusSuccess,
      'REJECTED' ||
      'CHANGES_REQUESTED' ||
      'EDITED_PENDING_SALES' =>
        AppTokens.statusDanger,
      _ => AppTokens.statusNeutral,
    };

String _planTypeLabel(String? t) => switch (t) {
      'FULL' => 'Full payment',
      'INSTALLMENT' => 'Installments',
      'MILESTONE' => 'Milestone-based',
      _ => t ?? '—',
    };

String _money(double? amount, String? currency) {
  if (amount == null) return '—';
  final cur = (currency ?? '').trim();
  final n = amount.toStringAsFixed(amount == amount.roundToDouble() ? 0 : 2);
  return cur.isEmpty ? n : '$cur $n';
}

/// Read-only agreement detail — bio, payment plan, notes + history, with an
/// in-app PDF view. Mirrors the web AgreementEditorPage's read surface;
/// editing is a later phase.
class AgreementDetailScreen extends ConsumerStatefulWidget {
  /// The list summary, used for an instant header while the full detail loads.
  final Agreement summary;
  const AgreementDetailScreen({super.key, required this.summary});

  @override
  ConsumerState<AgreementDetailScreen> createState() =>
      _AgreementDetailScreenState();
}

class _AgreementDetailScreenState extends ConsumerState<AgreementDetailScreen> {
  bool _loadingPdf = false;

  Future<void> _openPdf() async {
    setState(() => _loadingPdf = true);
    try {
      final url =
          await ref.read(agreementsRepositoryProvider).pdfUrl(widget.summary.id);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) =>
              PdfViewerScreen(url: url, title: widget.summary.title),
        ),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not load the PDF.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingPdf = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final id = widget.summary.id;
    final detail = ref.watch(agreementDetailProvider(id));
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.summary.agreementNumber != null
            ? 'Agreement #${widget.summary.agreementNumber}'
            : 'Agreement'),
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
      ),
      body: detail.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(agreementDetailProvider(id)),
        ),
        data: (a) => RefreshIndicator(
          onRefresh: () => ref.refresh(agreementDetailProvider(id).future),
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.space4),
            children: [
              _Header(agreement: a),
              const SizedBox(height: AppTokens.space3),
              SizedBox(
                width: double.infinity,
                child: _loadingPdf
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(AppTokens.space2),
                          child: SizedBox(
                              height: 22,
                              width: 22,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2)),
                        ),
                      )
                    : FilledButton.icon(
                        onPressed: _openPdf,
                        icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                        label: const Text('Open PDF'),
                      ),
              ),
              if (a.bio != null) ...[
                const SizedBox(height: AppTokens.space4),
                _BioSection(bio: a.bio!),
              ],
              const SizedBox(height: AppTokens.space4),
              _PaymentPlanSection(plan: a.paymentPlan, lockedAt: a.paymentPlanLockedAt),
              if ((a.salesNotes?.isNotEmpty ?? false) ||
                  (a.financeNotes?.isNotEmpty ?? false)) ...[
                const SizedBox(height: AppTokens.space4),
                _NotesSection(salesNotes: a.salesNotes, financeNotes: a.financeNotes),
              ],
              if (a.events.isNotEmpty) ...[
                const SizedBox(height: AppTokens.space4),
                _HistorySection(events: a.events),
              ],
              const SizedBox(height: AppTokens.space6),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final Agreement agreement;
  const _Header({required this.agreement});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final a = agreement;
    final leadName = [a.leadFirstName, a.leadLastName]
        .where((s) => s != null && s.isNotEmpty)
        .join(' ');
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(a.title, style: t.titleMedium)),
                StatusBadge(label: a.statusLabel, color: _statusColor(a.status)),
              ],
            ),
            if (leadName.isNotEmpty || a.leadReferenceCode != null) ...[
              const SizedBox(height: AppTokens.space2),
              Text(
                [
                  if (leadName.isNotEmpty) leadName,
                  if (a.leadReferenceCode != null) '· ${a.leadReferenceCode}',
                ].join(' '),
                style: t.bodyMedium?.copyWith(color: AppTokens.textMutedLight),
              ),
            ],
            if (a.amountDisplay != null) ...[
              const SizedBox(height: AppTokens.space2),
              Text(a.amountDisplay!,
                  style: t.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            ],
            const SizedBox(height: AppTokens.space2),
            Text('Created ${formatDateTime(a.createdAt)}',
                style: t.bodySmall?.copyWith(color: AppTokens.textMutedLight)),
          ],
        ),
      ),
    );
  }
}

class _BioSection extends StatelessWidget {
  final AgreementBio bio;
  const _BioSection({required this.bio});

  @override
  Widget build(BuildContext context) {
    final rows = <MapEntry<String, String?>>[
      MapEntry('Applicant', bio.applicantName),
      MapEntry('Father / guardian', bio.fatherName),
      MapEntry('CNIC', bio.cnic),
      MapEntry('Passport', bio.passport),
      MapEntry('Date of birth', bio.dob),
      MapEntry('Nationality', bio.nationality),
      MapEntry('Destination', bio.country),
      MapEntry('Phone', bio.phone),
      MapEntry('Email', bio.email),
      MapEntry('Address', bio.address),
      MapEntry('File #', bio.fileNumber),
      MapEntry('Agreement date', bio.agreementDate),
    ].where((e) => e.value != null && e.value!.trim().isNotEmpty).toList();
    if (rows.isEmpty) return const SizedBox.shrink();
    return _Section(
      title: 'Applicant',
      child: Column(children: [for (final e in rows) _kv(e.key, e.value!)]),
    );
  }
}

class _PaymentPlanSection extends StatelessWidget {
  final AgreementPaymentPlan? plan;
  final DateTime? lockedAt;
  const _PaymentPlanSection({required this.plan, this.lockedAt});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    if (plan == null) {
      return _Section(
        title: 'Payment plan',
        child: Text('No payment plan set yet.',
            style: t.bodyMedium?.copyWith(color: AppTokens.textMutedLight)),
      );
    }
    final p = plan!;
    return _Section(
      title: 'Payment plan',
      trailing: lockedAt != null
          ? const Icon(Icons.lock_outline,
              size: 15, color: AppTokens.textMutedLight)
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _kv('Type', _planTypeLabel(p.planType)),
          if (p.grossAmount != null) _kv('Gross', _money(p.grossAmount, p.currency)),
          if ((p.discountAmount ?? 0) > 0)
            _kv('Discount', '− ${_money(p.discountAmount, p.currency)}'),
          if ((p.taxAmount ?? 0) > 0) _kv('Tax', _money(p.taxAmount, p.currency)),
          _kv('Net payable', _money(p.netPayable, p.currency)),
          if (p.installments.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space3),
            Text('Installments',
                style: t.labelLarge?.copyWith(color: AppTokens.textSecondaryLight)),
            const SizedBox(height: AppTokens.space1),
            for (final i in p.installments)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 22,
                      child: Text('${i.sequence ?? '·'}.',
                          style: t.bodyMedium
                              ?.copyWith(color: AppTokens.textMutedLight)),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(i.stage ?? 'Installment',
                              style: t.bodyMedium),
                          if ((i.trigger?.isNotEmpty ?? false) ||
                              (i.dueDate?.isNotEmpty ?? false))
                            Text(
                              [
                                if (i.trigger?.isNotEmpty ?? false) i.trigger!,
                                if (i.dueDate?.isNotEmpty ?? false)
                                  'due ${i.dueDate}',
                              ].join(' · '),
                              style: t.bodySmall?.copyWith(
                                  color: AppTokens.textMutedLight),
                            ),
                        ],
                      ),
                    ),
                    Text(_money(i.amount, p.currency),
                        style: t.bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
          ],
          if (p.governmentFees.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space3),
            Text('Government / third-party fees',
                style: t.labelLarge?.copyWith(color: AppTokens.textSecondaryLight)),
            const SizedBox(height: AppTokens.space1),
            for (final f in p.governmentFees)
              _kv(f.label ?? 'Fee', _money(f.amount, f.currency ?? p.currency)),
          ],
          if (p.refundPolicyText?.isNotEmpty ?? false) ...[
            const SizedBox(height: AppTokens.space3),
            Text('Refund policy',
                style: t.labelLarge?.copyWith(color: AppTokens.textSecondaryLight)),
            const SizedBox(height: AppTokens.space1),
            Text(p.refundPolicyText!, style: t.bodySmall),
          ],
        ],
      ),
    );
  }
}

class _NotesSection extends StatelessWidget {
  final String? salesNotes;
  final String? financeNotes;
  const _NotesSection({this.salesNotes, this.financeNotes});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return _Section(
      title: 'Notes',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (salesNotes?.isNotEmpty ?? false) ...[
            Text('Sales',
                style: t.labelLarge?.copyWith(color: AppTokens.textSecondaryLight)),
            Text(salesNotes!, style: t.bodyMedium),
          ],
          if ((salesNotes?.isNotEmpty ?? false) &&
              (financeNotes?.isNotEmpty ?? false))
            const SizedBox(height: AppTokens.space2),
          if (financeNotes?.isNotEmpty ?? false) ...[
            Text('Finance',
                style: t.labelLarge?.copyWith(color: AppTokens.textSecondaryLight)),
            Text(financeNotes!, style: t.bodyMedium),
          ],
        ],
      ),
    );
  }
}

class _HistorySection extends StatelessWidget {
  final List<AgreementEvent> events;
  const _HistorySection({required this.events});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return _Section(
      title: 'History',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final e in events)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 5, right: 8),
                    child: Icon(Icons.circle, size: 7, color: AppTokens.statusNeutral),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(e.summary ?? e.type ?? 'Update',
                            style: t.bodyMedium),
                        if (e.createdAt != null)
                          Text(formatDateTime(e.createdAt!),
                              style: t.bodySmall?.copyWith(
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
}

class _Section extends StatelessWidget {
  final String title;
  final Widget child;
  final Widget? trailing;
  const _Section({required this.title, required this.child, this.trailing});

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
            Row(
              children: [
                Expanded(
                  child: Text(title,
                      style: t.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w700)),
                ),
                if (trailing != null) trailing!,
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            child,
          ],
        ),
      ),
    );
  }
}

Widget _kv(String label, String value) {
  return Builder(builder: (context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label,
                style:
                    t.bodySmall?.copyWith(color: AppTokens.textMutedLight)),
          ),
          Expanded(
            child: Text(value,
                style: t.bodyMedium?.copyWith(fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  });
}

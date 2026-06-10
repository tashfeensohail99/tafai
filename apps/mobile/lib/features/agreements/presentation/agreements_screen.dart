import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../data/agreements_providers.dart';
import '../data/agreements_repository.dart';
import '../domain/agreement.dart';

/// Read-only list of agreements for a lead, with tap-to-view-detail.
class AgreementsScreen extends ConsumerWidget {
  final String leadId;
  const AgreementsScreen({super.key, required this.leadId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(leadAgreementsProvider(leadId));
    return Scaffold(
      appBar: AppBar(title: const Text('Agreements')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(leadAgreementsProvider(leadId)),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const EmptyView(
              icon: Icons.description_outlined,
              title: 'No agreements',
              message: 'Agreements created for this lead will appear here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(leadAgreementsProvider(leadId).future),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppTokens.space4),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) => _AgreementCard(agreement: items[i]),
            ),
          );
        },
      ),
    );
  }
}

Color _statusColor(String status) => switch (status) {
      'DRAFT' => AppTokens.statusNeutral,
      'SUBMITTED' => AppTokens.statusWarning,
      'APPROVED' => AppTokens.statusInfo,
      'SENT' => AppTokens.statusInfo,
      'SIGNED' => AppTokens.statusSuccess,
      'REJECTED' => AppTokens.statusDanger,
      _ => AppTokens.statusNeutral,
    };

class _AgreementCard extends ConsumerStatefulWidget {
  final Agreement agreement;
  const _AgreementCard({required this.agreement});

  @override
  ConsumerState<_AgreementCard> createState() => _AgreementCardState();
}

class _AgreementCardState extends ConsumerState<_AgreementCard> {
  bool _loadingPdf = false;

  Future<void> _openPdf() async {
    setState(() => _loadingPdf = true);
    try {
      final url = await ref
          .read(agreementsRepositoryProvider)
          .pdfUrl(widget.agreement.id);
      final ok = await openExternalUrl(url);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No browser app available.')),
        );
      }
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
    final t = Theme.of(context).textTheme;
    final a = widget.agreement;
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
                  child: Text(a.title,
                      style: t.titleMedium, overflow: TextOverflow.ellipsis),
                ),
                StatusBadge(
                  label: a.statusLabel,
                  color: _statusColor(a.status),
                ),
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            if (a.amountDisplay != null)
              Row(
                children: [
                  const Icon(Icons.payments_outlined,
                      size: 15, color: AppTokens.statusNeutral),
                  const SizedBox(width: 6),
                  Text(a.amountDisplay!,
                      style: t.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                ],
              ),
            const SizedBox(height: AppTokens.space2),
            Row(
              children: [
                const Icon(Icons.schedule,
                    size: 14, color: AppTokens.textMutedLight),
                const SizedBox(width: 4),
                Text(formatDateTime(a.createdAt),
                    style: t.bodySmall
                        ?.copyWith(color: AppTokens.textMutedLight)),
                if (a.submittedAt != null) ...[
                  const SizedBox(width: AppTokens.space3),
                  const Icon(Icons.send_outlined,
                      size: 14, color: AppTokens.textMutedLight),
                  const SizedBox(width: 4),
                  Text(formatDate(a.submittedAt!),
                      style: t.bodySmall
                          ?.copyWith(color: AppTokens.textMutedLight)),
                ],
              ],
            ),
            if (a.financeNotes != null && a.financeNotes!.isNotEmpty) ...[
              const SizedBox(height: AppTokens.space2),
              Text('Finance: ${a.financeNotes!}',
                  style: t.bodySmall
                      ?.copyWith(color: AppTokens.textSecondaryLight),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: AppTokens.space3),
            Align(
              alignment: Alignment.centerRight,
              child: _loadingPdf
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : OutlinedButton.icon(
                      onPressed: _openPdf,
                      icon: const Icon(Icons.picture_as_pdf_outlined, size: 16),
                      label: const Text('Open PDF'),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

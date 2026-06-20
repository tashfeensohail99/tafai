import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/processing_providers.dart';
import '../data/processing_repository.dart';
import '../domain/processing_models.dart';
import 'case_workspace_screen.dart';
import 'processing_ui.dart';

/// Refund / escalation lane — REJECTED cases needing refund or appeal handling.
/// Pushed from the Manager dashboard. Per row: open the case, record a refund
/// (out-of-band, the case stays REJECTED), or escalate to an appeal (reuses the
/// stage-change to APPEAL_IN_PROGRESS). Manager-appropriate (server-gated).
class RefundLaneScreen extends ConsumerWidget {
  const RefundLaneScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(refundsQueueProvider);
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: const Text('Refund / Escalation',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(refundsQueueProvider.future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () => ref.invalidate(refundsQueueProvider),
              ),
            ),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: EmptyView(
                    icon: Icons.verified_outlined,
                    title: 'No rejected cases',
                    message:
                        'Cases the authority rejects land here for refund or '
                        'appeal handling.',
                  ),
                ),
              ]);
            }
            return ListView.separated(
              padding: const EdgeInsets.all(AppTokens.space4),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) => _RefundCard(item: items[i]),
            );
          },
        ),
      ),
    );
  }
}

class _RefundCard extends ConsumerStatefulWidget {
  final RefundCaseItem item;
  const _RefundCard({required this.item});

  @override
  ConsumerState<_RefundCard> createState() => _RefundCardState();
}

class _RefundCardState extends ConsumerState<_RefundCard> {
  bool _busy = false;

  Future<void> _recordRefund() async {
    final reason = await _showRefundSheet(context);
    if (reason == null || reason.isEmpty) return;
    await _run(
      () => ref
          .read(processingRepositoryProvider)
          .recordRefund(widget.item.base.id, reason: reason),
      success: 'Refund recorded.',
    );
  }

  Future<void> _escalate() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Escalate to appeal?'),
        content: const Text(
            'This moves the case to “Appeal Filed”. The authority decision '
            'stands until the appeal concludes.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: AppTokens.primary600),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Escalate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _run(
      () => ref.read(processingRepositoryProvider).changeStage(
            widget.item.base.id,
            toStage: 'APPEAL_IN_PROGRESS',
            reason: 'Escalated to appeal from refund lane',
          ),
      success: 'Case escalated to appeal.',
    );
  }

  Future<void> _run(Future<void> Function() action,
      {required String success}) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(refundsQueueProvider);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(success)));
      }
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.item.base;
    return InkWell(
      borderRadius: const BorderRadius.all(AppTokens.radiusCard),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => CaseWorkspaceScreen(caseId: c.id)),
      ),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(c.personName,
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w600)),
                ),
                if (widget.item.refundInitiated)
                  const StatusPill(
                    label: 'Refund initiated',
                    tone: ToneColors(
                        AppTokens.statusSuccess, AppTokens.statusSuccessBg),
                  ),
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                stagePill(c.stage),
                StatusPill(
                  label: 'Authority: ${c.authorityDecision}',
                  tone: const ToneColors(
                      AppTokens.statusDanger, AppTokens.statusDangerBg),
                ),
                Text(
                  '${labelForServiceCode(c.service)} · ${c.targetCountry}',
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.textMutedLight),
                ),
              ],
            ),
            if (widget.item.refundInitiatedAt != null) ...[
              const SizedBox(height: AppTokens.space2),
              Text('Refund recorded ${relativeTime(widget.item.refundInitiatedAt!)}',
                  style: const TextStyle(
                      fontSize: 11.5, color: AppTokens.textMutedLight)),
            ],
            const SizedBox(height: AppTokens.space3),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _busy ? null : _recordRefund,
                  icon: const Icon(Icons.receipt_long_outlined, size: 15),
                  label: Text(widget.item.refundInitiated
                      ? 'Re-record refund'
                      : 'Record refund'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTokens.statusDanger,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
                const SizedBox(width: AppTokens.space2),
                if (c.stage == 'REJECTED')
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _escalate,
                    icon: const Icon(Icons.gavel_outlined, size: 15),
                    label: const Text('Escalate'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTokens.primary600,
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Refund-reason collection sheet — destructive confirm built into the gate
/// (a non-empty reason is required before the POST fires from the caller).
Future<String?> _showRefundSheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _RefundSheet(),
  );
}

class _RefundSheet extends StatefulWidget {
  const _RefundSheet();

  @override
  State<_RefundSheet> createState() => _RefundSheetState();
}

class _RefundSheetState extends State<_RefundSheet> {
  final _reason = TextEditingController();
  bool _confirmed = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  bool get _canSubmit => _reason.text.trim().isNotEmpty && _confirmed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppTokens.surfaceLight,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(AppTokens.space5),
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
            Text('Record refund',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AppTokens.space3),
            Container(
              padding: const EdgeInsets.all(AppTokens.space3),
              decoration: BoxDecoration(
                color: AppTokens.statusWarningBg,
                borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                border: Border.all(
                    color: AppTokens.statusWarning.withValues(alpha: 0.35)),
              ),
              child: const Text(
                'This flags the case as refunded for Finance to process '
                'out-of-band. The case stays REJECTED.',
                style: TextStyle(fontSize: 12.5, color: AppTokens.textPrimaryLight),
              ),
            ),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: _reason,
              maxLines: 3,
              maxLength: 1000,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Refund reason *',
                border: OutlineInputBorder(),
              ),
            ),
            CheckboxListTile(
              value: _confirmed,
              dense: true,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              activeColor: AppTokens.statusDanger,
              title: const Text(
                'I confirm a refund should be initiated for this case.',
                style: TextStyle(fontSize: 12.5),
              ),
              onChanged: (v) => setState(() => _confirmed = v ?? false),
            ),
            const SizedBox(height: AppTokens.space3),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppTokens.statusDanger,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: _canSubmit
                    ? () => Navigator.of(context).pop(_reason.text.trim())
                    : null,
                child: const Text('Record refund'),
              ),
            ),
            const SizedBox(height: AppTokens.space2),
          ],
        ),
      ),
    );
  }
}

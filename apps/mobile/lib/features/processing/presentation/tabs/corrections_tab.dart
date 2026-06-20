import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../data/processing_repository.dart';
import '../../domain/processing_models.dart';
import '../case_correction_sheets.dart';
import '../processing_ui.dart';

/// Corrections tab — list correction requests, raise new ones, and resolve /
/// escalate open ones. Wired to /processing/cases/:id/corrections. The server
/// enforces the matching permission (processing.document.request).
class CaseCorrectionsTab extends ConsumerWidget {
  final String caseId;
  final Future<void> Function() onMutated;
  const CaseCorrectionsTab({
    super.key,
    required this.caseId,
    required this.onMutated,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseCorrectionsProvider(caseId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTokens.primary600,
        onPressed: () => _request(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Request correction'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(caseCorrectionsProvider(caseId).future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () => ref.invalidate(caseCorrectionsProvider(caseId)),
              ),
            ),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: EmptyView(
                    icon: Icons.edit_note_outlined,
                    title: 'No correction requests',
                    message:
                        'Raise a correction when a document or detail needs '
                        'fixing. The client sees the message + required action '
                        'in their portal.',
                  ),
                ),
              ]);
            }
            final open = items.where((c) => c.isOpen || c.status == 'ESCALATED').toList();
            final done = items.where((c) => c.status == 'RESOLVED').toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space4, AppTokens.space4, AppTokens.space4, 88),
              children: [
                if (open.isNotEmpty) ...[
                  SectionLabel('Open (${open.length})'),
                  const SizedBox(height: AppTokens.space2),
                  ...open.map((c) => Padding(
                        padding:
                            const EdgeInsets.only(bottom: AppTokens.space3),
                        child: _CorrectionCard(
                          caseId: caseId,
                          correction: c,
                          onMutated: onMutated,
                        ),
                      )),
                ],
                if (done.isNotEmpty) ...[
                  const SizedBox(height: AppTokens.space2),
                  SectionLabel('Resolved (${done.length})'),
                  const SizedBox(height: AppTokens.space2),
                  ...done.map((c) => Padding(
                        padding:
                            const EdgeInsets.only(bottom: AppTokens.space3),
                        child: _CorrectionCard(
                          caseId: caseId,
                          correction: c,
                          onMutated: onMutated,
                        ),
                      )),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _request(BuildContext context, WidgetRef ref) async {
    final input = await showRequestCorrectionSheet(context);
    if (input == null) return;
    try {
      await ref.read(processingRepositoryProvider).createCorrection(
            caseId,
            correctionType: input.correctionType,
            subject: input.subject,
            reasonCodes: input.reasonCodes,
            officerNote: input.officerNote,
            clientMessage: input.clientMessage,
            requiredAction: input.requiredAction,
            slaHours: input.slaHours,
          );
      ref.invalidate(caseCorrectionsProvider(caseId));
      await onMutated();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Correction request sent.')),
        );
      }
    } on AppError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }
}

ToneColors _statusTone(String status) {
  switch (status) {
    case 'RESOLVED':
      return const ToneColors(AppTokens.statusSuccess, AppTokens.statusSuccessBg);
    case 'ESCALATED':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'IN_PROGRESS':
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    case 'SENT':
    default:
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
  }
}

class _CorrectionCard extends ConsumerStatefulWidget {
  final String caseId;
  final CaseCorrection correction;
  final Future<void> Function() onMutated;
  const _CorrectionCard({
    required this.caseId,
    required this.correction,
    required this.onMutated,
  });

  @override
  ConsumerState<_CorrectionCard> createState() => _CorrectionCardState();
}

class _CorrectionCardState extends ConsumerState<_CorrectionCard> {
  bool _busy = false;

  Future<void> _resolve() async {
    final note = await showCorrectionNoteSheet(
      context,
      title: 'Resolve correction',
      hint: 'Resolution note (optional)',
      confirmLabel: 'Mark resolved',
      noteRequired: false,
    );
    if (note == null) return;
    await _run(() => ref.read(processingRepositoryProvider).resolveCorrection(
          widget.caseId,
          widget.correction.id,
          note: note.isEmpty ? null : note,
        ));
  }

  Future<void> _escalate() async {
    final reason = await showCorrectionNoteSheet(
      context,
      title: 'Escalate correction',
      hint: 'Why does this need a manager? (required)',
      confirmLabel: 'Escalate',
      noteRequired: true,
      danger: true,
    );
    if (reason == null || reason.isEmpty) return;
    await _run(() => ref.read(processingRepositoryProvider).escalateCorrection(
          widget.caseId,
          widget.correction.id,
          escalationReason: reason,
        ));
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(caseCorrectionsProvider(widget.caseId));
      await widget.onMutated();
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
    final c = widget.correction;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(c.subject,
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w600)),
              ),
              const SizedBox(width: AppTokens.space2),
              Text(relativeTime(c.createdAt),
                  style: const TextStyle(
                      fontSize: 11, color: AppTokens.textMutedLight)),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              StatusPill(
                label: kCorrectionStatusLabel[c.status] ?? c.status,
                tone: _statusTone(c.status),
              ),
              StatusPill(
                label: c.correctionType == 'DOCUMENT' ? 'Document' : 'Information',
                tone: docStatusTone('NOT_SUBMITTED'),
              ),
              StatusPill(
                label: correctionRequiredActionLabel(c.requiredAction),
                tone: const ToneColors(
                    AppTokens.statusWarning, AppTokens.statusWarningBg),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          Text(c.clientMessage,
              style: const TextStyle(fontSize: 13, height: 1.5)),
          if (c.reasonCodes.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: c.reasonCodes
                  .map((r) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTokens.surfaceSubtleLight,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(r,
                            style: const TextStyle(
                                fontSize: 10.5,
                                color: AppTokens.textMutedLight)),
                      ))
                  .toList(),
            ),
          ],
          if (c.officerNote != null && c.officerNote!.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            _NoteBox(
              label: 'Officer note',
              text: c.officerNote!,
              bg: AppTokens.surfaceSubtleLight,
            ),
          ],
          if (c.resolutionNote != null && c.resolutionNote!.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            _NoteBox(
              label: 'Resolved',
              text: c.resolutionNote!,
              bg: AppTokens.statusSuccessBg,
            ),
          ],
          if (c.escalationReason != null && c.escalationReason!.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            _NoteBox(
              label: 'Escalated',
              text: c.escalationReason!,
              bg: AppTokens.statusDangerBg,
            ),
          ],
          if (c.isOpen || c.canEscalate) ...[
            const SizedBox(height: AppTokens.space3),
            Row(
              children: [
                if (c.isOpen)
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _resolve,
                    icon: const Icon(Icons.check_circle_outline, size: 15),
                    label: const Text('Resolve'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTokens.statusSuccess,
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                if (c.isOpen) const SizedBox(width: AppTokens.space2),
                if (c.canEscalate)
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _escalate,
                    icon: const Icon(Icons.arrow_upward, size: 15),
                    label: const Text('Escalate'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTokens.statusDanger,
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _NoteBox extends StatelessWidget {
  final String label;
  final String text;
  final Color bg;
  const _NoteBox({required this.label, required this.text, required this.bg});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTokens.space2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(AppTokens.radiusMd),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(),
              style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                  color: AppTokens.textMutedLight)),
          const SizedBox(height: 2),
          Text(text, style: const TextStyle(fontSize: 12.5, height: 1.4)),
        ],
      ),
    );
  }
}

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/util/launchers.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../data/processing_repository.dart';
import '../../domain/processing_models.dart';
import '../processing_ui.dart';
import 'identity_panel.dart';

/// Documents tab — the review queue for a single case. ACCEPT / REJECT with
/// reason codes, upload-on-behalf, waive, request-from-client. Files open via a
/// backend SIGNED URL in the external browser (never an in-app PDF viewer).
class CaseDocumentsTab extends ConsumerWidget {
  final String caseId;

  /// Optional header rendered above the checklist inside the scroll view (the
  /// case workspace passes the submission-package panel here so it scrolls with
  /// the list instead of eating fixed vertical space).
  final Widget? header;
  const CaseDocumentsTab({super.key, required this.caseId, this.header});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseDocumentsProvider(caseId));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(caseDocumentsProvider(caseId).future),
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(
              error: e,
              onRetry: () => ref.invalidate(caseDocumentsProvider(caseId)),
            ),
          ),
        ]),
        data: (items) {
          final core = items
              .where((i) =>
                  i.criticality == 'CRITICAL' || i.criticality == 'REQUIRED')
              .toList();
          final settled = core
              .where((i) =>
                  i.status == 'ACCEPTED' ||
                  i.status == 'WAIVED' ||
                  i.status == 'NOT_APPLICABLE')
              .length;
          final pct = core.isEmpty ? 0 : ((settled / core.length) * 100).round();

          return ListView(
            padding: const EdgeInsets.all(AppTokens.space4),
            children: [
              if (header != null) ...[
                header!,
                const SizedBox(height: AppTokens.space3),
              ],
              // Identity reconciliation read panel.
              IdentityPanel(caseId: caseId),
              const SizedBox(height: AppTokens.space3),
              // Progress strip.
              SectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text('Core documents progress',
                            style: TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w600)),
                        const Spacer(),
                        Text('$settled/${core.length} ($pct%)',
                            style: const TextStyle(
                                fontSize: 12,
                                color: AppTokens.textMutedLight)),
                      ],
                    ),
                    const SizedBox(height: AppTokens.space2),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        value: core.isEmpty ? 0 : settled / core.length,
                        minHeight: 7,
                        backgroundColor: AppTokens.surfaceSubtleLight,
                        valueColor: AlwaysStoppedAnimation(
                          pct == 100
                              ? AppTokens.statusSuccess
                              : AppTokens.primary600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              if (items.isEmpty)
                const SectionCard(
                  child: EmptyView(
                    icon: Icons.description_outlined,
                    title: 'No documents on the checklist yet',
                    message:
                        'Documents auto-populate from the service-type template when the case is acknowledged.',
                  ),
                )
              else
                ...items.map((d) => Padding(
                      padding: const EdgeInsets.only(bottom: AppTokens.space3),
                      child: _DocCard(
                        caseId: caseId,
                        doc: d,
                        onChanged: () =>
                            ref.invalidate(caseDocumentsProvider(caseId)),
                      ),
                    )),
            ],
          );
        },
      ),
    );
  }
}

class _DocCard extends ConsumerStatefulWidget {
  final String caseId;
  final CaseDocumentItem doc;
  final VoidCallback onChanged;
  const _DocCard({
    required this.caseId,
    required this.doc,
    required this.onChanged,
  });

  @override
  ConsumerState<_DocCard> createState() => _DocCardState();
}

class _DocCardState extends ConsumerState<_DocCard> {
  bool _busy = false;

  CaseDocumentItem get d => widget.doc;
  ProcessingRepository get _repo => ref.read(processingRepositoryProvider);

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  Future<void> _viewFile() async {
    setState(() => _busy = true);
    try {
      final url = await _repo.documentSignedUrl(widget.caseId, d.id);
      await openExternalUrl(url);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _request() async {
    setState(() => _busy = true);
    try {
      await _repo.requestDocument(widget.caseId, d.id);
      _toast('Requested from client');
      widget.onChanged();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final picked = result.files.first;
    final path = picked.path;
    if (path == null) {
      _toast('Could not access file.');
      return;
    }
    setState(() => _busy = true);
    try {
      await _repo.uploadDocument(widget.caseId, d.id,
          filePath: path, fileName: picked.name);
      _toast('Uploaded for client');
      widget.onChanged();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _waive() async {
    final reason = await _promptText(
      title: 'Waive document',
      hint: 'Why is this doc waived? (min 5 chars)',
      minLength: 5,
    );
    if (reason == null) return;
    setState(() => _busy = true);
    try {
      await _repo.waiveDocument(widget.caseId, d.id, waiveReason: reason);
      _toast('Document waived');
      widget.onChanged();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review() async {
    final outcome = await showModalBottomSheet<_ReviewOutcome>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ReviewSheet(documentName: d.documentName),
    );
    if (outcome == null) return;
    setState(() => _busy = true);
    try {
      await _repo.reviewDocument(
        widget.caseId,
        d.id,
        decision: outcome.decision,
        rejectionReasonCodes: outcome.reasonCodes,
        rejectionNote: outcome.note,
      );
      _toast(outcome.decision == 'ACCEPT' ? 'Document accepted' : 'Document rejected');
      widget.onChanged();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _promptText({
    required String title,
    required String hint,
    int minLength = 1,
  }) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          maxLines: 3,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final t = ctrl.text.trim();
              if (t.length >= minLength) Navigator.of(ctx).pop(t);
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    ).whenComplete(ctrl.dispose);
  }

  @override
  Widget build(BuildContext context) {
    final tone = docStatusTone(d.status);
    final ai = d.aiAssessments.isNotEmpty ? d.aiAssessments.first : null;
    final accent = _accent();
    return Container(
      decoration: BoxDecoration(
        color: AppTokens.surfaceLight,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadowSm,
        // Uniform border ONLY. A borderRadius alongside a NON-uniform Border
        // (the old 3px accent-left edge) is illegal in Flutter: it throws at
        // paint time in debug — blanking the ENTIRE card — and silently drops
        // the rounded corners in release. The status accent is now a clipped,
        // full-height left rail (below) instead of a border side.
        border: Border.all(color: AppTokens.borderLight),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          // Full-height status accent rail. Positioned top+bottom gives it a
          // BOUNDED height (the Stack sizes to the padded content), so it never
          // trips the "unbounded height" error that CrossAxisAlignment.stretch
          // hits for a fixed-width child inside a vertical list.
          Positioned(
            top: 0,
            bottom: 0,
            left: 0,
            width: 3,
            child: ColoredBox(color: accent),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4 + 3,
                AppTokens.space4, AppTokens.space4, AppTokens.space4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(_statusIcon(), size: 18, color: tone.fg),
                      const SizedBox(width: AppTokens.space2),
                      Expanded(
                        child: Text(
                          d.documentName,
                          style: const TextStyle(
                              fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTokens.space2),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      StatusPill(
                          label: d.criticality,
                          tone: criticalityTone(d.criticality)),
                      StatusPill(label: docStatusLabel(d.status), tone: tone),
                      ..._expiryBadge(),
                    ],
                  ),
                  if (d.description != null && d.description!.isNotEmpty) ...[
                    const SizedBox(height: AppTokens.space2),
                    Text(d.description!,
                        style: const TextStyle(
                            fontSize: 12.5,
                            color: AppTokens.textSecondaryLight)),
                  ],
                  if (ai != null) ...[
                    const SizedBox(height: AppTokens.space2),
                    _aiRow(ai),
                  ],
                  const SizedBox(height: AppTokens.space2),
                  Text(
                    '${d.latestVersion != null ? 'v${d.latestVersion!.versionNumber} · ' : ''}Updated ${relativeTime(d.updatedAt)}',
                    style: const TextStyle(
                        fontSize: 11, color: AppTokens.textMutedLight),
                  ),
                  const SizedBox(height: AppTokens.space3),
                  if (_busy)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppTokens.space2),
                      child: SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  else
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (d.hasFile)
                          _action(Icons.open_in_new, 'View', _viewFile),
                        if (d.canReview)
                          _action(Icons.fact_check_outlined, 'Review', _review,
                              primary: true),
                        if (d.canUpload)
                          _action(Icons.upload_file_outlined,
                              d.hasFile ? 'Replace' : 'Upload', _upload),
                        if (d.canRequest)
                          _action(Icons.mark_email_unread_outlined, 'Request',
                              _request),
                        if (d.canWaive)
                          _action(Icons.shield_outlined, 'Waive', _waive),
                      ],
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _expiryBadge() {
    final ex = d.validityExpiryDate;
    if (ex == null) return const [];
    final days = ex.difference(DateTime.now()).inDays;
    if (days < 0 && d.status != 'EXPIRED') {
      return [StatusPill(label: 'Expired', tone: docStatusTone('EXPIRED'))];
    }
    if (days >= 0 && days <= 30) {
      return [
        StatusPill(label: 'Expires in ${days}d', tone: docStatusTone('EXPIRING_SOON'))
      ];
    }
    return const [];
  }

  Widget _aiRow(AiAssessmentLite ai) {
    final (label, color) = switch (ai.suggestedDecision) {
      'APPROVE' => ('AI suggests approve', AppTokens.statusSuccess),
      'REJECT' => ('AI suggests reject', AppTokens.statusDanger),
      _ => ('AI: needs review', AppTokens.statusWarning),
    };
    final conf = ai.confidence != null
        ? ' · ${(ai.confidence! * 100).round()}%'
        : '';
    return Row(
      children: [
        Icon(Icons.auto_awesome, size: 12, color: color),
        const SizedBox(width: 4),
        Flexible(
          child: Text('$label$conf',
              style: TextStyle(
                  fontSize: 11.5, fontWeight: FontWeight.w600, color: color)),
        ),
        if (ai.detectedLanguage != null) ...[
          const SizedBox(width: 6),
          const Text('⚠ translation',
              style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: AppTokens.statusWarning)),
        ],
      ],
    );
  }

  IconData _statusIcon() {
    if (d.status == 'ACCEPTED') return Icons.check_circle;
    if (d.status == 'REJECTED' || d.status == 'EXPIRED') return Icons.cancel;
    if (d.status == 'WAIVED') return Icons.shield_outlined;
    return Icons.insert_drive_file_outlined;
  }

  Color _accent() {
    if (d.status == 'REJECTED' || d.status == 'EXPIRED') {
      return AppTokens.statusDanger;
    }
    if (d.canReview) return AppTokens.primary600;
    if (d.status == 'ACCEPTED') return AppTokens.statusSuccess;
    if (d.canRequest || d.status == 'REQUESTED') return AppTokens.statusWarning;
    return AppTokens.borderLight;
  }

  Widget _action(IconData icon, String label, VoidCallback onTap,
      {bool primary = false}) {
    if (primary) {
      return FilledButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 16),
        label: Text(label),
        style: FilledButton.styleFrom(
          backgroundColor: AppTokens.primary600,
          padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space3, vertical: 8),
          textStyle: const TextStyle(fontSize: 13),
        ),
      );
    }
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 16),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppTokens.textSecondaryLight,
        side: const BorderSide(color: AppTokens.borderStrongLight),
        padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space3, vertical: 8),
        textStyle: const TextStyle(fontSize: 13),
      ),
    );
  }
}

class _ReviewOutcome {
  final String decision; // ACCEPT | REJECT
  final List<String>? reasonCodes;
  final String? note;
  const _ReviewOutcome(this.decision, {this.reasonCodes, this.note});
}

/// Bottom sheet for ACCEPT / REJECT. Reject requires at least one reason code or
/// a note; reason codes mirror the web kRejectionReasonLabel map.
class _ReviewSheet extends StatefulWidget {
  final String documentName;
  const _ReviewSheet({required this.documentName});

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  final _note = TextEditingController();
  final Set<String> _codes = {};
  bool _rejecting = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        decoration: const BoxDecoration(
          color: AppTokens.surfaceLight,
          borderRadius:
              BorderRadius.vertical(top: Radius.circular(20)),
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
              Text('Review document',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(widget.documentName,
                  style: const TextStyle(
                      fontSize: 13, color: AppTokens.textMutedLight)),
              const SizedBox(height: AppTokens.space4),
              if (!_rejecting) ...[
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => setState(() => _rejecting = true),
                        icon: const Icon(Icons.cancel_outlined, size: 18),
                        label: const Text('Reject'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTokens.statusDanger,
                          side: const BorderSide(color: AppTokens.statusDanger),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppTokens.space3),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () => Navigator.of(context)
                            .pop(const _ReviewOutcome('ACCEPT')),
                        icon: const Icon(Icons.check, size: 18),
                        label: const Text('Accept'),
                        style: FilledButton.styleFrom(
                          backgroundColor: AppTokens.statusSuccess,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ),
                  ],
                ),
              ] else ...[
                const SectionLabel('Rejection reasons'),
                const SizedBox(height: AppTokens.space2),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: kRejectionReasonLabel.entries.map((e) {
                    final on = _codes.contains(e.key);
                    return FilterChip(
                      label: Text(e.value, style: const TextStyle(fontSize: 12)),
                      selected: on,
                      onSelected: (_) => setState(() {
                        on ? _codes.remove(e.key) : _codes.add(e.key);
                      }),
                      selectedColor: AppTokens.statusDangerBg,
                      checkmarkColor: AppTokens.statusDanger,
                    );
                  }).toList(),
                ),
                const SizedBox(height: AppTokens.space3),
                TextField(
                  controller: _note,
                  maxLines: 3,
                  onChanged: (_) => setState(() {}),
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Note to client (optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: AppTokens.space4),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => setState(() => _rejecting = false),
                        child: const Text('Back'),
                      ),
                    ),
                    const SizedBox(width: AppTokens.space3),
                    Expanded(
                      child: FilledButton(
                        onPressed: (_codes.isEmpty && _note.text.trim().isEmpty)
                            ? null
                            : () => Navigator.of(context).pop(_ReviewOutcome(
                                  'REJECT',
                                  reasonCodes:
                                      _codes.isEmpty ? null : _codes.toList(),
                                  note: _note.text.trim().isEmpty
                                      ? null
                                      : _note.text.trim(),
                                )),
                        style: FilledButton.styleFrom(
                          backgroundColor: AppTokens.statusDanger,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        child: const Text('Confirm reject'),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: AppTokens.space2),
            ],
          ),
        ),
      ),
    );
  }
}

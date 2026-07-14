import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../data/processing_providers.dart';
import '../data/processing_repository.dart';
import '../domain/processing_models.dart';
import 'processing_ui.dart';

/// Bottom sheets for the case workspace actions: Stage change (with the
/// server-side submission-readiness gate), Reassign (manager), Cancel (manager).
/// Each returns true on success so the caller can refresh the case detail.

/// Stage-specific extra fields (mirrors the web STAGE_FIELDS).
const Map<String, List<({String key, String label, bool required})>>
    _stageFields = {
  'SUBMITTED': [
    (key: 'submissionReference', label: 'Submission reference', required: true),
  ],
  'UNDER_AUTHORITY_REVIEW': [
    (
      key: 'authorityTrackingRef',
      label: 'Authority tracking reference',
      required: true
    ),
  ],
  'CANCELLED': [
    (key: 'cancellationReason', label: 'Cancellation reason', required: true),
  ],
  'COMPLETED': [
    (key: 'completionNotes', label: 'Completion notes', required: true),
  ],
  'REJECTED': [
    (key: 'notes', label: 'Rejection notes', required: true),
  ],
};

Future<bool?> showStageChangeSheet(
  BuildContext context,
  WidgetRef ref, {
  required ProcessingCaseDetail caseRecord,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _StageChangeSheet(caseRecord: caseRecord),
  );
}

class _StageChangeSheet extends ConsumerStatefulWidget {
  final ProcessingCaseDetail caseRecord;
  const _StageChangeSheet({required this.caseRecord});

  @override
  ConsumerState<_StageChangeSheet> createState() => _StageChangeSheetState();
}

class _StageChangeSheetState extends ConsumerState<_StageChangeSheet> {
  String? _toStage;
  final Map<String, TextEditingController> _fields = {};
  final _reason = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final allowed = kAllowedTransitions[widget.caseRecord.stage] ?? const [];
    _toStage = allowed.isNotEmpty ? allowed.first : null;
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  TextEditingController _ctrl(String key) =>
      _fields.putIfAbsent(key, () => TextEditingController());

  bool get _needsGate =>
      _toStage != null && kSubmissionGateStages.contains(_toStage);

  Future<void> _submit() async {
    final to = _toStage;
    if (to == null) return;
    final fields = _stageFields[to] ?? const [];
    for (final f in fields) {
      if (f.required && _ctrl(f.key).text.trim().isEmpty) {
        setState(() => _error = '${f.label} is required.');
        return;
      }
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(processingRepositoryProvider).changeStage(
            widget.caseRecord.id,
            toStage: to,
            reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
            notes: _fields['notes']?.text.trim(),
            submissionReference: _fields['submissionReference']?.text.trim(),
            authorityTrackingRef: _fields['authorityTrackingRef']?.text.trim(),
            cancellationReason: _fields['cancellationReason']?.text.trim(),
            completionNotes: _fields['completionNotes']?.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on AppError catch (e) {
      setState(() {
        _error = messageForError(e);
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final allowed = kAllowedTransitions[widget.caseRecord.stage] ?? const [];
    if (allowed.isEmpty) {
      return _SheetShell(
        title: 'No transitions available',
        children: [
          Text(
            'This case is in a terminal stage: ${stageLabel(widget.caseRecord.stage)}.',
            style: const TextStyle(
                fontSize: 13, color: AppTokens.textMutedLight),
          ),
        ],
      );
    }
    final fields = _toStage != null ? (_stageFields[_toStage] ?? const []) : const [];
    return _SheetShell(
      title: 'Change stage',
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            stagePill(widget.caseRecord.stage),
            const Icon(Icons.arrow_forward, size: 16),
            if (_toStage != null) stagePill(_toStage!),
          ],
        ),
        const SizedBox(height: AppTokens.space4),
        const SectionLabel('Target stage'),
        const SizedBox(height: AppTokens.space2),
        ...allowed.map((s) => _RadioRow(
              selected: _toStage == s,
              title: Text(stageLabel(s),
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w600)),
              onTap: () => setState(() {
                _toStage = s;
                _error = null;
              }),
            )),
        if (_needsGate) ...[
          const SizedBox(height: AppTokens.space2),
          _ReadinessGate(caseId: widget.caseRecord.id),
        ],
        if (fields.isNotEmpty) ...[
          const SizedBox(height: AppTokens.space3),
          ...fields.map((f) => Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.space3),
                child: TextField(
                  controller: _ctrl(f.key),
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    labelText: f.required ? '${f.label} *' : f.label,
                    border: const OutlineInputBorder(),
                  ),
                ),
              )),
        ],
        const SizedBox(height: AppTokens.space3),
        TextField(
          controller: _reason,
          maxLines: 2,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Reason / note (optional)',
            border: OutlineInputBorder(),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTokens.space3),
          ErrorBanner(_error!),
        ],
        const SizedBox(height: AppTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: _saving || _toStage == null ? null : _submit,
            child: _saving
                ? const ButtonSpinner()
                : const Text('Confirm stage change'),
          ),
        ),
      ],
    );
  }
}

/// Server-side submission-readiness preview (doc status + expiry + attestation).
class _ReadinessGate extends ConsumerWidget {
  final String caseId;
  const _ReadinessGate({required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(submissionReadinessProvider(caseId));
    return async.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: AppTokens.space2),
        child: Row(children: [
          SizedBox(
              height: 14,
              width: 14,
              child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: AppTokens.space2),
          Text('Checking submission readiness…',
              style: TextStyle(fontSize: 12.5, color: AppTokens.textMutedLight)),
        ]),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (r) {
        if (r.ready) {
          return Container(
            padding: const EdgeInsets.all(AppTokens.space3),
            decoration: BoxDecoration(
              color: AppTokens.statusSuccessBg,
              borderRadius: const BorderRadius.all(AppTokens.radiusMd),
              border: Border.all(
                  color: AppTokens.statusSuccess.withValues(alpha: 0.35)),
            ),
            child: const Row(children: [
              Icon(Icons.verified_outlined,
                  size: 16, color: AppTokens.statusSuccess),
              SizedBox(width: AppTokens.space2),
              Expanded(
                child: Text('Quality gate passed — clear to submit.',
                    style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppTokens.statusSuccess)),
              ),
            ]),
          );
        }
        return Container(
          padding: const EdgeInsets.all(AppTokens.space3),
          decoration: BoxDecoration(
            color: AppTokens.statusDangerBg,
            borderRadius: const BorderRadius.all(AppTokens.radiusMd),
            border: Border.all(
                color: AppTokens.statusDanger.withValues(alpha: 0.35)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Icon(Icons.warning_amber_rounded,
                    size: 16, color: AppTokens.statusDanger),
                const SizedBox(width: AppTokens.space2),
                Expanded(
                  child: Text(
                    'Quality gate blocked — ${r.blockers.length} issue${r.blockers.length != 1 ? 's' : ''}',
                    style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppTokens.statusDanger),
                  ),
                ),
              ]),
              const SizedBox(height: AppTokens.space2),
              ...r.blockers.map((b) => Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text('• $b',
                        style: const TextStyle(
                            fontSize: 12, color: AppTokens.textPrimaryLight)),
                  )),
            ],
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Reassign (manager)
// ---------------------------------------------------------------------------

Future<bool?> showReassignSheet(
  BuildContext context,
  WidgetRef ref, {
  required ProcessingCaseDetail caseRecord,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ReassignSheet(caseRecord: caseRecord),
  );
}

class _ReassignSheet extends ConsumerStatefulWidget {
  final ProcessingCaseDetail caseRecord;
  const _ReassignSheet({required this.caseRecord});

  @override
  ConsumerState<_ReassignSheet> createState() => _ReassignSheetState();
}

class _ReassignSheetState extends ConsumerState<_ReassignSheet> {
  String? _selectedId;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selectedId = widget.caseRecord.assignedOfficerId;
  }

  Future<void> _submit() async {
    final id = _selectedId;
    if (id == null || id == widget.caseRecord.assignedOfficerId) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(processingRepositoryProvider)
          .assignCase(widget.caseRecord.id, id);
      if (mounted) Navigator.of(context).pop(true);
    } on AppError catch (e) {
      setState(() {
        _error = messageForError(e);
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final officersAsync = ref.watch(processingOfficersProvider);
    return _SheetShell(
      title: widget.caseRecord.assignedOfficerId == null
          ? 'Assign case'
          : 'Reassign case',
      children: [
        officersAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: AppTokens.space6),
            child: LoadingView(),
          ),
          error: (e, _) => ErrorBanner(messageForError(e)),
          data: (officers) {
            if (officers.isEmpty) {
              return const Text('No processing officers configured.',
                  style: TextStyle(color: AppTokens.textMutedLight));
            }
            return Column(
              children: officers.map((o) {
                final isCurrent = o.id == widget.caseRecord.assignedOfficerId;
                return _RadioRow(
                  selected: _selectedId == o.id,
                  onTap: () => setState(() => _selectedId = o.id),
                  title: Row(
                    children: [
                      Expanded(
                        child: Text(o.name,
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w600)),
                      ),
                      if (isCurrent)
                        const StatusPill(
                          label: 'Current',
                          tone:
                              ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg),
                        ),
                    ],
                  ),
                  subtitle: Text(
                    o.primaryRole == 'processing_manager'
                        ? 'Manager · ${o.email}'
                        : o.primaryRole == 'processing'
                            ? 'Associate · ${o.email}'
                            : '${o.primaryRole} · ${o.email}',
                    style: const TextStyle(fontSize: 11.5),
                  ),
                );
              }).toList(),
            );
          },
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTokens.space3),
          ErrorBanner(_error!),
        ],
        const SizedBox(height: AppTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: _saving ||
                    _selectedId == null ||
                    _selectedId == widget.caseRecord.assignedOfficerId
                ? null
                : _submit,
            child: _saving
                ? const ButtonSpinner()
                : Text(widget.caseRecord.assignedOfficerId == null
                    ? 'Assign'
                    : 'Reassign'),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Cancel (manager)
// ---------------------------------------------------------------------------

Future<bool?> showCancelSheet(
  BuildContext context,
  WidgetRef ref, {
  required ProcessingCaseDetail caseRecord,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CancelSheet(caseRecord: caseRecord),
  );
}

/// Manager "Mark as junk" — same sheet as cancel, different copy. JUNK reuses
/// the cancellationReason field, so only the wording differs.
Future<bool?> showJunkSheet(
  BuildContext context,
  WidgetRef ref, {
  required ProcessingCaseDetail caseRecord,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CancelSheet(caseRecord: caseRecord, isJunk: true),
  );
}

class _CancelSheet extends ConsumerStatefulWidget {
  final ProcessingCaseDetail caseRecord;
  final bool isJunk;
  const _CancelSheet({required this.caseRecord, this.isJunk = false});

  @override
  ConsumerState<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends ConsumerState<_CancelSheet> {
  final _reason = TextEditingController();
  bool _confirmed = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _reason.text.trim().length >= 10 && _confirmed && !_saving;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(processingRepositoryProvider).changeStage(
            widget.caseRecord.id,
            toStage: widget.isJunk ? 'JUNK' : 'CANCELLED',
            cancellationReason: _reason.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on AppError catch (e) {
      setState(() {
        _error = messageForError(e);
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isJunk = widget.isJunk;
    return _SheetShell(
      title: isJunk ? 'Mark as junk' : 'Cancel case',
      children: [
        Container(
          padding: const EdgeInsets.all(AppTokens.space3),
          decoration: BoxDecoration(
            color: AppTokens.statusDangerBg,
            borderRadius: const BorderRadius.all(AppTokens.radiusMd),
            border: Border.all(
                color: AppTokens.statusDanger.withValues(alpha: 0.35)),
          ),
          child: Row(children: [
            const Icon(Icons.warning_amber_rounded,
                size: 18, color: AppTokens.statusDanger),
            const SizedBox(width: AppTokens.space2),
            Expanded(
              child: Text(
                isJunk
                    ? 'Removes the case from active queues and reports. Use for spam, duplicates, or dead leads.'
                    : 'This is irreversible. Cancelling locks the case permanently.',
                style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppTokens.statusDanger),
              ),
            ),
          ]),
        ),
        const SizedBox(height: AppTokens.space3),
        TextField(
          controller: _reason,
          maxLines: 3,
          onChanged: (_) => setState(() {}),
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: isJunk
                ? 'Reason for junking * (min 10 chars)'
                : 'Cancellation reason * (min 10 chars)',
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: AppTokens.space2),
        CheckboxListTile(
          value: _confirmed,
          dense: true,
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          activeColor: AppTokens.statusDanger,
          title: Text(
            isJunk
                ? 'I confirm this case is not real work and should be removed from active queues.'
                : 'I confirm this cancellation has been reviewed and cannot be undone.',
            style: const TextStyle(fontSize: 12.5),
          ),
          onChanged: (v) => setState(() => _confirmed = v ?? false),
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTokens.space2),
          ErrorBanner(_error!),
        ],
        const SizedBox(height: AppTokens.space4),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _saving ? null : () => Navigator.of(context).pop(),
                child: const Text('Keep case'),
              ),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppTokens.statusDanger,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: _canSubmit ? _submit : null,
                child: _saving
                    ? const ButtonSpinner()
                    : Text(isJunk ? 'Mark as junk' : 'Cancel case'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared sheet shell
// ---------------------------------------------------------------------------

/// A tappable radio-style row (custom, so we avoid the deprecated
/// RadioListTile groupValue/onChanged API in newer Flutter).
class _RadioRow extends StatelessWidget {
  final bool selected;
  final Widget title;
  final Widget? subtitle;
  final VoidCallback onTap;
  const _RadioRow({
    required this.selected,
    required this.title,
    this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: const BorderRadius.all(AppTokens.radiusMd),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              size: 20,
              color: selected
                  ? AppTokens.primary600
                  : AppTokens.textMutedLight,
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  title,
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    DefaultTextStyle.merge(
                      style: const TextStyle(color: AppTokens.textMutedLight),
                      child: subtitle!,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetShell extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _SheetShell({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
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
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AppTokens.space3),
              ...children,
              const SizedBox(height: AppTokens.space2),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../data/processing_repository.dart';
import '../../domain/processing_models.dart';
import '../processing_ui.dart';

/// Submissions tab — the authority-submissions LOG (separate from the merged
/// submission *package* on the Documents tab). Lists each filing with the
/// authority, a "Record submission" action, and a per-item status update.
class CaseSubmissionsTab extends ConsumerWidget {
  final String caseId;
  final Future<void> Function() onMutated;
  const CaseSubmissionsTab({
    super.key,
    required this.caseId,
    required this.onMutated,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseSubmissionsProvider(caseId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTokens.primary600,
        onPressed: () => _record(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Record submission'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(caseSubmissionsProvider(caseId).future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () => ref.invalidate(caseSubmissionsProvider(caseId)),
              ),
            ),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: EmptyView(
                    icon: Icons.send_outlined,
                    title: 'No submissions logged',
                    message:
                        'Record each filing made with an authority here to '
                        'track references, tracking numbers and decisions.',
                  ),
                ),
              ]);
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space4, AppTokens.space4, AppTokens.space4, 88),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) => _SubmissionCard(
                caseId: caseId,
                submission: items[i],
                onMutated: onMutated,
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _record(BuildContext context, WidgetRef ref) async {
    final input = await showModalBottomSheet<_RecordSubmissionInput>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _RecordSubmissionSheet(),
    );
    if (input == null) return;
    try {
      await ref.read(processingRepositoryProvider).createSubmission(
            caseId,
            authority: input.authority,
            submissionDate: input.submissionDate,
            submissionReference: input.submissionReference,
            trackingNumber: input.trackingNumber,
          );
      ref.invalidate(caseSubmissionsProvider(caseId));
      await onMutated();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Submission recorded.')),
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

ToneColors _submissionStatusTone(String status) {
  switch (status) {
    case 'APPROVED':
      return const ToneColors(AppTokens.statusSuccess, AppTokens.statusSuccessBg);
    case 'REJECTED':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'INFO_REQUESTED':
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
    default:
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
  }
}

class _SubmissionCard extends ConsumerStatefulWidget {
  final String caseId;
  final CaseSubmission submission;
  final Future<void> Function() onMutated;
  const _SubmissionCard({
    required this.caseId,
    required this.submission,
    required this.onMutated,
  });

  @override
  ConsumerState<_SubmissionCard> createState() => _SubmissionCardState();
}

class _SubmissionCardState extends ConsumerState<_SubmissionCard> {
  bool _busy = false;

  Future<void> _updateStatus() async {
    final result = await showModalBottomSheet<_UpdateSubmissionInput>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _UpdateSubmissionSheet(submission: widget.submission),
    );
    if (result == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(processingRepositoryProvider).updateSubmission(
            widget.caseId,
            widget.submission.id,
            status: result.status,
            trackingNumber: result.trackingNumber,
            responseNotes: result.responseNotes,
            nextAction: result.nextAction,
          );
      ref.invalidate(caseSubmissionsProvider(widget.caseId));
      await widget.onMutated();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Submission updated.')),
        );
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
    final s = widget.submission;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('#${s.submissionNumber} · ${s.authority}',
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w600)),
              ),
              StatusPill(
                label: kSubmissionStatusLabel[s.status] ?? s.status,
                tone: _submissionStatusTone(s.status),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          if (s.submissionDate != null)
            _kv('Submitted', formatDate(s.submissionDate!)),
          if (s.submissionReference != null)
            _kv('Reference', s.submissionReference!),
          if (s.trackingNumber != null) _kv('Tracking', s.trackingNumber!),
          if (s.nextAction != null) _kv('Next action', s.nextAction!),
          if (s.responseNotes != null) _kv('Response', s.responseNotes!),
          const SizedBox(height: AppTokens.space2),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : _updateStatus,
              icon: const Icon(Icons.edit_outlined, size: 15),
              label: const Text('Update status'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTokens.primary600,
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 92,
              child: Text(k,
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.textMutedLight)),
            ),
            Expanded(
              child: Text(v, style: const TextStyle(fontSize: 12.5)),
            ),
          ],
        ),
      );
}

// ---------------------------------------------------------------------------
// Record-submission sheet
// ---------------------------------------------------------------------------

class _RecordSubmissionInput {
  final String authority;
  final String submissionDate; // ISO yyyy-mm-dd
  final String? submissionReference;
  final String? trackingNumber;
  const _RecordSubmissionInput({
    required this.authority,
    required this.submissionDate,
    this.submissionReference,
    this.trackingNumber,
  });
}

class _RecordSubmissionSheet extends StatefulWidget {
  const _RecordSubmissionSheet();

  @override
  State<_RecordSubmissionSheet> createState() => _RecordSubmissionSheetState();
}

class _RecordSubmissionSheetState extends State<_RecordSubmissionSheet> {
  final _authority = TextEditingController();
  final _reference = TextEditingController();
  final _tracking = TextEditingController();
  DateTime _date = DateTime.now();

  @override
  void dispose() {
    _authority.dispose();
    _reference.dispose();
    _tracking.dispose();
    super.dispose();
  }

  bool get _canSubmit => _authority.text.trim().isNotEmpty;

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  void _submit() {
    if (!_canSubmit) return;
    final iso =
        '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    Navigator.of(context).pop(_RecordSubmissionInput(
      authority: _authority.text.trim(),
      submissionDate: iso,
      submissionReference:
          _reference.text.trim().isEmpty ? null : _reference.text.trim(),
      trackingNumber:
          _tracking.text.trim().isEmpty ? null : _tracking.text.trim(),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      title: 'Record submission',
      children: [
        const SectionLabel('Authority'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _authority,
          maxLength: 200,
          textCapitalization: TextCapitalization.words,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            hintText: 'e.g. IRCC, embassy, ministry',
            border: OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Submission date'),
        const SizedBox(height: AppTokens.space2),
        InkWell(
          onTap: _pickDate,
          borderRadius: const BorderRadius.all(AppTokens.radiusMd),
          child: InputDecorator(
            decoration: const InputDecoration(border: OutlineInputBorder()),
            child: Row(
              children: [
                const Icon(Icons.calendar_today_outlined,
                    size: 16, color: AppTokens.textMutedLight),
                const SizedBox(width: AppTokens.space2),
                Text(formatDate(_date),
                    style: const TextStyle(fontSize: 14)),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Reference (optional)'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _reference,
          maxLength: 200,
          decoration: const InputDecoration(
            hintText: 'Submission reference / file no.',
            border: OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Tracking number (optional)'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _tracking,
          maxLength: 200,
          decoration: const InputDecoration(
            hintText: 'Authority tracking number',
            border: OutlineInputBorder(),
            counterText: '',
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
            onPressed: _canSubmit ? _submit : null,
            child: const Text('Record submission'),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Update-submission sheet
// ---------------------------------------------------------------------------

class _UpdateSubmissionInput {
  final String status;
  final String? trackingNumber;
  final String? responseNotes;
  final String? nextAction;
  const _UpdateSubmissionInput({
    required this.status,
    this.trackingNumber,
    this.responseNotes,
    this.nextAction,
  });
}

class _UpdateSubmissionSheet extends StatefulWidget {
  final CaseSubmission submission;
  const _UpdateSubmissionSheet({required this.submission});

  @override
  State<_UpdateSubmissionSheet> createState() => _UpdateSubmissionSheetState();
}

class _UpdateSubmissionSheetState extends State<_UpdateSubmissionSheet> {
  late String _status;
  late final TextEditingController _tracking;
  final _responseNotes = TextEditingController();
  final _nextAction = TextEditingController();

  @override
  void initState() {
    super.initState();
    _status = widget.submission.status;
    _tracking =
        TextEditingController(text: widget.submission.trackingNumber ?? '');
    _responseNotes.text = widget.submission.responseNotes ?? '';
    _nextAction.text = widget.submission.nextAction ?? '';
  }

  @override
  void dispose() {
    _tracking.dispose();
    _responseNotes.dispose();
    _nextAction.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(_UpdateSubmissionInput(
      status: _status,
      trackingNumber:
          _tracking.text.trim().isEmpty ? null : _tracking.text.trim(),
      responseNotes: _responseNotes.text.trim().isEmpty
          ? null
          : _responseNotes.text.trim(),
      nextAction:
          _nextAction.text.trim().isEmpty ? null : _nextAction.text.trim(),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      title: 'Update submission #${widget.submission.submissionNumber}',
      children: [
        const SectionLabel('Status'),
        const SizedBox(height: AppTokens.space2),
        DropdownButtonFormField<String>(
          initialValue: _status,
          decoration: const InputDecoration(border: OutlineInputBorder()),
          items: kSubmissionStatuses
              .map((s) => DropdownMenuItem(
                  value: s,
                  child: Text(kSubmissionStatusLabel[s] ?? s)))
              .toList(),
          onChanged: (v) => setState(() => _status = v ?? _status),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Tracking number (optional)'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _tracking,
          maxLength: 200,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Response notes (optional)'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _responseNotes,
          maxLines: 2,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(border: OutlineInputBorder()),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Next action (optional)'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _nextAction,
          maxLength: 500,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            counterText: '',
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
            onPressed: _submit,
            child: const Text('Save changes'),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared sheet shell
// ---------------------------------------------------------------------------

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

import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';
import '../domain/processing_models.dart';
import 'processing_ui.dart';

/// Bottom sheets for the case Corrections tab. Mirrors the finance/notes sheet
/// pattern: each sheet COLLECTS input and `Navigator.pop`s a small result; the
/// caller (the tab, with ref) performs the POST + snackbar + invalidate.

/// Result of the "Request correction" sheet — maps onto CreateCorrectionRequestDto.
class CorrectionRequestInput {
  final String correctionType; // INFORMATION (mobile raises info corrections)
  final String subject;
  final List<String> reasonCodes;
  final String clientMessage;
  final String? officerNote;
  final String requiredAction;
  final int slaHours;

  const CorrectionRequestInput({
    required this.correctionType,
    required this.subject,
    required this.reasonCodes,
    required this.clientMessage,
    this.officerNote,
    required this.requiredAction,
    required this.slaHours,
  });
}

/// SLA options (mirrors web SLA_OPTIONS).
const List<({int hours, String label})> _slaOptions = [
  (hours: 24, label: '24 hours'),
  (hours: 48, label: '48 hours'),
  (hours: 72, label: '3 days'),
  (hours: 120, label: '5 days (default)'),
  (hours: 168, label: '1 week'),
  (hours: 336, label: '2 weeks'),
];

Future<CorrectionRequestInput?> showRequestCorrectionSheet(
  BuildContext context,
) {
  return showModalBottomSheet<CorrectionRequestInput>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _RequestCorrectionSheet(),
  );
}

class _RequestCorrectionSheet extends StatefulWidget {
  const _RequestCorrectionSheet();

  @override
  State<_RequestCorrectionSheet> createState() =>
      _RequestCorrectionSheetState();
}

class _RequestCorrectionSheetState extends State<_RequestCorrectionSheet> {
  final _subject = TextEditingController();
  final _clientMessage = TextEditingController();
  final _officerNote = TextEditingController();
  final Set<String> _reasonCodes = {};
  String _requiredAction = 'REUPLOAD';
  int _slaHours = 120;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _clientMessage.dispose();
    _officerNote.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _subject.text.trim().isNotEmpty &&
      _reasonCodes.isNotEmpty &&
      _clientMessage.text.trim().isNotEmpty;

  void _submit() {
    if (!_canSubmit) {
      setState(() => _error =
          'Subject, at least one reason, and a client message are required.');
      return;
    }
    Navigator.of(context).pop(CorrectionRequestInput(
      correctionType: 'INFORMATION',
      subject: _subject.text.trim(),
      reasonCodes: _reasonCodes.toList(),
      clientMessage: _clientMessage.text.trim(),
      officerNote: _officerNote.text.trim().isEmpty
          ? null
          : _officerNote.text.trim(),
      requiredAction: _requiredAction,
      slaHours: _slaHours,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      title: 'Request correction',
      children: [
        const SectionLabel('Subject'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _subject,
          maxLength: 200,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => setState(() => _error = null),
          decoration: const InputDecoration(
            hintText: 'e.g. Passport scan unreadable',
            border: OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: AppTokens.space4),
        const SectionLabel('Reason codes'),
        const SizedBox(height: AppTokens.space2),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: kCorrectionReasonCodes.map((e) {
            final on = _reasonCodes.contains(e.key);
            return FilterChip(
              label: Text(e.value, style: const TextStyle(fontSize: 11.5)),
              selected: on,
              showCheckmark: false,
              selectedColor: AppTokens.primary100,
              onSelected: (_) => setState(() {
                _error = null;
                if (on) {
                  _reasonCodes.remove(e.key);
                } else {
                  _reasonCodes.add(e.key);
                }
              }),
            );
          }).toList(),
        ),
        const SizedBox(height: AppTokens.space4),
        const SectionLabel('Message to client'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _clientMessage,
          maxLines: 3,
          maxLength: 4000,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => setState(() => _error = null),
          decoration: const InputDecoration(
            hintText: 'What the client must do — shown in their portal.',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Private officer note (optional)'),
        const SizedBox(height: AppTokens.space2),
        TextField(
          controller: _officerNote,
          maxLines: 2,
          maxLength: 2000,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            hintText: 'Internal — never sent to the client.',
            border: OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Required action'),
        const SizedBox(height: AppTokens.space2),
        DropdownButtonFormField<String>(
          initialValue: _requiredAction,
          decoration: const InputDecoration(border: OutlineInputBorder()),
          items: kCorrectionRequiredActions
              .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
              .toList(),
          onChanged: (v) =>
              setState(() => _requiredAction = v ?? _requiredAction),
        ),
        const SizedBox(height: AppTokens.space3),
        const SectionLabel('Client response SLA'),
        const SizedBox(height: AppTokens.space2),
        DropdownButtonFormField<int>(
          initialValue: _slaHours,
          decoration: const InputDecoration(border: OutlineInputBorder()),
          items: _slaOptions
              .map((o) =>
                  DropdownMenuItem(value: o.hours, child: Text(o.label)))
              .toList(),
          onChanged: (v) => setState(() => _slaHours = v ?? _slaHours),
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTokens.space3),
          ErrorBannerText(_error!),
        ],
        const SizedBox(height: AppTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: _canSubmit ? _submit : null,
            child: const Text('Send correction request'),
          ),
        ),
      ],
    );
  }
}

/// Small note sheet shared by Resolve (note optional) and Escalate (required).
Future<String?> showCorrectionNoteSheet(
  BuildContext context, {
  required String title,
  required String hint,
  required String confirmLabel,
  required bool noteRequired,
  bool danger = false,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CorrectionNoteSheet(
      title: title,
      hint: hint,
      confirmLabel: confirmLabel,
      noteRequired: noteRequired,
      danger: danger,
    ),
  );
}

class _CorrectionNoteSheet extends StatefulWidget {
  final String title;
  final String hint;
  final String confirmLabel;
  final bool noteRequired;
  final bool danger;
  const _CorrectionNoteSheet({
    required this.title,
    required this.hint,
    required this.confirmLabel,
    required this.noteRequired,
    required this.danger,
  });

  @override
  State<_CorrectionNoteSheet> createState() => _CorrectionNoteSheetState();
}

class _CorrectionNoteSheetState extends State<_CorrectionNoteSheet> {
  final _ctrl = TextEditingController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      !widget.noteRequired || _ctrl.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      title: widget.title,
      children: [
        TextField(
          controller: _ctrl,
          maxLines: 3,
          maxLength: 2000,
          autofocus: true,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: widget.hint,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: AppTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor:
                  widget.danger ? AppTokens.statusDanger : AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            // Resolve allows an empty note → pop a non-null empty string so the
            // caller can distinguish "confirmed" from "dismissed" (null).
            onPressed: _canSubmit
                ? () => Navigator.of(context).pop(_ctrl.text.trim())
                : null,
            child: Text(widget.confirmLabel),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared sheet shell (local copy — mirrors case_action_sheets _SheetShell so
// the corrections sheets stay self-contained).
// ---------------------------------------------------------------------------

/// Inline red form-error text (the ErrorBanner widget needs an import we keep
/// local to avoid cross-file coupling churn).
class ErrorBannerText extends StatelessWidget {
  final String message;
  const ErrorBannerText(this.message, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTokens.space3),
      decoration: BoxDecoration(
        color: AppTokens.statusDangerBg,
        borderRadius: const BorderRadius.all(AppTokens.radiusMd),
        border:
            Border.all(color: AppTokens.statusDanger.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline,
              color: AppTokens.statusDanger, size: 18),
          const SizedBox(width: AppTokens.space2),
          Expanded(
            child: Text(message,
                style: const TextStyle(
                    color: AppTokens.statusDanger, fontSize: 13)),
          ),
        ],
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

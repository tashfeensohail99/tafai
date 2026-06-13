import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/country_picker.dart';
import '../data/leads_repository.dart';
import '../domain/lead.dart';
import '../domain/lead_options.dart';

/// Opens the create/edit lead form. Pass [existing] to edit; omit to create.
/// Returns the saved [Lead] (the new lead on create, or the original object on
/// a successful edit) or null if the user dismissed it.
Future<Lead?> showLeadForm(BuildContext context, {Lead? existing}) {
  return showModalBottomSheet<Lead>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _LeadFormSheet(existing: existing),
  );
}

class _LeadFormSheet extends ConsumerStatefulWidget {
  final Lead? existing;
  const _LeadFormSheet({this.existing});

  @override
  ConsumerState<_LeadFormSheet> createState() => _LeadFormSheetState();
}

class _LeadFormSheetState extends ConsumerState<_LeadFormSheet> {
  late final TextEditingController _first;
  late final TextEditingController _last;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _source;
  late final TextEditingController _notes;
  String? _serviceCode; // canonical service-type code (or null)
  String? _country; // target-country name (or null)
  String? _priority;
  bool _busy = false;
  bool _verifying = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _first = TextEditingController(text: e?.firstName ?? '');
    _last = TextEditingController(text: e?.lastName ?? '');
    _phone = TextEditingController(text: e?.phone ?? '');
    _email = TextEditingController(text: e?.email ?? '');
    _source = TextEditingController(text: e?.sourceChannel ?? '');
    _notes = TextEditingController(text: e?.notes ?? '');
    // Service is stored as a canonical code; preselect only when the existing
    // value is one (legacy free-text leads start blank, classified on save).
    _serviceCode =
        isCanonicalServiceCode(e?.serviceInterest) ? e?.serviceInterest : null;
    _country = (e?.targetCountry?.trim().isNotEmpty ?? false)
        ? e!.targetCountry
        : null;
    _priority = e?.priority;
  }

  @override
  void dispose() {
    for (final c in [
      _first,
      _last,
      _phone,
      _email,
      _source,
      _notes,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final first = _first.text.trim();
    final last = _last.text.trim();
    final phone = _phone.text.trim();
    if (first.isEmpty || last.isEmpty || phone.isEmpty) {
      setState(() => _error = 'First name, last name and phone are required.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(leadsRepositoryProvider);
    try {
      if (_isEdit) {
        await repo.update(
          widget.existing!.id,
          firstName: first,
          lastName: last,
          phone: phone,
          email: _email.text.trim(),
          serviceInterest: _serviceCode,
          targetCountry: _country,
          priority: _priority,
          notes: _notes.text.trim(),
        );
        if (mounted) Navigator.of(context).pop(widget.existing);
      } else {
        final created = await repo.create(
          firstName: first,
          lastName: last,
          phone: phone,
          email: _email.text.trim(),
          targetCountry: _country,
          serviceInterest: _serviceCode,
          sourceChannel: _source.text.trim(),
          priority: _priority,
          notes: _notes.text.trim(),
        );
        if (mounted) Navigator.of(context).pop(created);
      }
    } on AppError catch (e) {
      if (mounted) setState(() => _error = messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Send the email-verification link to the lead (edit mode only — needs a
  /// saved lead id). The backend sends to the lead's saved email, so if the
  /// field was edited but not saved we ask the user to save first.
  Future<void> _verifyEmail() async {
    final e = widget.existing;
    if (e == null) return;
    if (_email.text.trim() != (e.email ?? '')) {
      setState(() => _error = 'Save your email change first, then tap Verify.');
      return;
    }
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      final sent =
          await ref.read(leadsRepositoryProvider).sendEmailVerification(e.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(sent
                ? 'Verification email sent to ${e.email}. Ask them to tap the link.'
                : 'Could not send — check the email address.'),
          ),
        );
      }
    } on AppError catch (err) {
      if (mounted) setState(() => _error = messageForError(err));
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.9,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(
                AppTokens.space4, 0, AppTokens.space4, AppTokens.space5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_isEdit ? 'Edit lead' : 'New lead', style: t.titleMedium),
                const SizedBox(height: AppTokens.space4),
                Row(
                  children: [
                    Expanded(
                      child: _field(_first, 'First name *',
                          cap: TextCapitalization.words),
                    ),
                    const SizedBox(width: AppTokens.space3),
                    Expanded(
                      child: _field(_last, 'Last name *',
                          cap: TextCapitalization.words),
                    ),
                  ],
                ),
                const SizedBox(height: AppTokens.space3),
                _field(_phone, 'Phone *', keyboard: TextInputType.phone),
                const SizedBox(height: AppTokens.space3),
                _field(_email, 'Email', keyboard: TextInputType.emailAddress),
                if (_isEdit && (widget.existing!.email?.isNotEmpty ?? false)) ...[
                  const SizedBox(height: AppTokens.space2),
                  widget.existing!.emailVerified
                      ? const Row(
                          children: [
                            Icon(Icons.verified_outlined,
                                size: 16, color: AppTokens.statusSuccess),
                            SizedBox(width: 6),
                            Text('Email verified',
                                style: TextStyle(
                                    color: AppTokens.statusSuccess,
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600)),
                          ],
                        )
                      : Align(
                          alignment: Alignment.centerLeft,
                          child: OutlinedButton.icon(
                            onPressed: _verifying ? null : _verifyEmail,
                            icon: _verifying
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2))
                                : const Icon(Icons.mark_email_read_outlined,
                                    size: 16),
                            label: Text(_verifying ? 'Sending…' : 'Verify email'),
                          ),
                        ),
                ],
                const SizedBox(height: AppTokens.space3),
                DropdownButtonFormField<String>(
                  value: _serviceCode,
                  isExpanded: true,
                  decoration: const InputDecoration(
                      labelText: 'Service interest', isDense: true),
                  items: [
                    for (final s in kServiceTypes)
                      DropdownMenuItem(value: s.code, child: Text(s.label)),
                  ],
                  onChanged: (v) => setState(() => _serviceCode = v),
                ),
                const SizedBox(height: AppTokens.space3),
                InkWell(
                  onTap: () async {
                    final picked =
                        await showCountryPicker(context, current: _country);
                    if (picked != null) setState(() => _country = picked);
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                        labelText: 'Target country', isDense: true),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            (_country?.isNotEmpty ?? false)
                                ? _country!
                                : 'Select country',
                            style: (_country?.isNotEmpty ?? false)
                                ? null
                                : TextStyle(color: Theme.of(context).hintColor),
                          ),
                        ),
                        const Icon(Icons.arrow_drop_down),
                      ],
                    ),
                  ),
                ),
                if (!_isEdit) ...[
                  const SizedBox(height: AppTokens.space3),
                  _field(_source, 'Source channel'),
                ],
                const SizedBox(height: AppTokens.space4),
                Text('Priority', style: t.labelLarge),
                const SizedBox(height: AppTokens.space2),
                Wrap(
                  spacing: AppTokens.space2,
                  children: [
                    for (final p in kLeadPriorities)
                      ChoiceChip(
                        label: Text(leadPriorityLabel(p)),
                        selected: _priority == p,
                        onSelected: (sel) =>
                            setState(() => _priority = sel ? p : null),
                      ),
                  ],
                ),
                const SizedBox(height: AppTokens.space3),
                _field(_notes, 'Notes', maxLines: 3,
                    cap: TextCapitalization.sentences),
                if (_error != null) ...[
                  const SizedBox(height: AppTokens.space3),
                  ErrorBanner(_error!),
                ],
                const SizedBox(height: AppTokens.space4),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _busy ? null : _save,
                    child: _busy
                        ? const ButtonSpinner()
                        : Text(_isEdit ? 'Save changes' : 'Create lead'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController c,
    String label, {
    TextInputType? keyboard,
    int maxLines = 1,
    TextCapitalization cap = TextCapitalization.none,
  }) {
    return TextField(
      controller: c,
      keyboardType: keyboard,
      maxLines: maxLines,
      textCapitalization: cap,
      decoration: InputDecoration(labelText: label, isDense: true),
    );
  }
}

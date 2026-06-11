import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../../leads/data/leads_providers.dart';
import '../../leads/domain/lead.dart';
import '../data/followups_providers.dart';
import '../data/followups_repository.dart';

const _kContactMethods = <String, String>{
  'CALL': 'Call',
  'WHATSAPP': 'WhatsApp',
  'EMAIL': 'Email',
  'MEETING': 'Meeting',
};

/// Bottom sheet to create a follow-up for [leadId]. Returns true on success.
Future<bool?> showFollowUpForm(
  BuildContext context, {
  required String leadId,
  required String leadName,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _FollowUpFormSheet(leadId: leadId, leadName: leadName),
  );
}

/// Lead picker → follow-up form. Entry point for the Follow-ups tab FAB,
/// where no lead is in context yet. Returns true if a follow-up was created.
Future<bool?> showFollowUpFormWithLeadPicker(BuildContext context) async {
  final lead = await showModalBottomSheet<Lead>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => const _LeadPickerSheet(),
  );
  if (lead == null || !context.mounted) return null;
  return showFollowUpForm(
    context,
    leadId: lead.id,
    leadName: lead.fullName,
  );
}

class _FollowUpFormSheet extends ConsumerStatefulWidget {
  final String leadId;
  final String leadName;
  const _FollowUpFormSheet({required this.leadId, required this.leadName});

  @override
  ConsumerState<_FollowUpFormSheet> createState() => _FollowUpFormSheetState();
}

class _FollowUpFormSheetState extends ConsumerState<_FollowUpFormSheet> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  String? _contactMethod = 'CALL';
  late DateTime _dueAt;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    // Default: tomorrow 10:00 — the most common "call them back" slot.
    final now = DateTime.now();
    _dueAt = DateTime(now.year, now.month, now.day + 1, 10, 0);
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _dueAt,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_dueAt),
    );
    if (t == null) return;
    setState(() => _dueAt = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    if (title.isEmpty) return;
    setState(() => _saving = true);
    try {
      await ref.read(followUpsRepositoryProvider).create(
            leadId: widget.leadId,
            title: title,
            description: _description.text.trim().isEmpty
                ? null
                : _description.text.trim(),
            contactMethod: _contactMethod,
            dueAt: _dueAt,
          );
      ref.invalidate(followUpsListProvider);
      if (mounted) Navigator.of(context).pop(true);
    } on AppError catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }

  String get _dueLabel {
    final d = _dueAt;
    final hh = d.hour.toString().padLeft(2, '0');
    final mm = d.minute.toString().padLeft(2, '0');
    return '${d.day}/${d.month}/${d.year} · $hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(
          AppTokens.space4, AppTokens.space4, AppTokens.space4,
          AppTokens.space4 + viewInsets),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('New follow-up',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text('For ${widget.leadName}',
              style: const TextStyle(
                  fontSize: 13, color: AppTokens.textMutedLight)),
          const SizedBox(height: AppTokens.space4),
          TextField(
            controller: _title,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'What needs to happen?',
              hintText: 'e.g. Call back about documents',
            ),
          ),
          const SizedBox(height: AppTokens.space3),
          TextField(
            controller: _description,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Details (optional)',
            ),
          ),
          const SizedBox(height: AppTokens.space3),
          Wrap(
            spacing: AppTokens.space2,
            children: [
              for (final e in _kContactMethods.entries)
                ChoiceChip(
                  label: Text(e.value),
                  selected: _contactMethod == e.key,
                  onSelected: (_) => setState(() => _contactMethod = e.key),
                ),
            ],
          ),
          const SizedBox(height: AppTokens.space3),
          OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.schedule, size: 18),
            label: Text('Due: $_dueLabel'),
          ),
          const SizedBox(height: AppTokens.space4),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Text('Create follow-up'),
            ),
          ),
        ],
      ),
    );
  }
}

class _LeadPickerSheet extends ConsumerStatefulWidget {
  const _LeadPickerSheet();

  @override
  ConsumerState<_LeadPickerSheet> createState() => _LeadPickerSheetState();
}

class _LeadPickerSheetState extends ConsumerState<_LeadPickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(leadsListProvider);
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      builder: (ctx, scrollCtrl) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space4),
            child: TextField(
              autofocus: true,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search lead by name or phone',
              ),
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
            ),
          ),
          Expanded(
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('Could not load leads')),
              data: (leads) {
                final filtered = _query.isEmpty
                    ? leads
                    : leads
                        .where((l) =>
                            l.fullName.toLowerCase().contains(_query) ||
                            l.phone.contains(_query))
                        .toList();
                if (filtered.isEmpty) {
                  return const Center(child: Text('No matching leads'));
                }
                return ListView.builder(
                  controller: scrollCtrl,
                  itemCount: filtered.length,
                  itemBuilder: (_, i) {
                    final l = filtered[i];
                    return ListTile(
                      title: Text(l.fullName),
                      subtitle: Text(l.phone),
                      onTap: () => Navigator.of(context).pop(l),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

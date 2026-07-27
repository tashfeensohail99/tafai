import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../leads/data/leads_repository.dart';

/// Shared sales-disposition UI for the WhatsApp surfaces.
///
/// Extracted from the chat screen so the INBOX can set + display dispositions
/// with the exact same picker and labels — a rep tags a chat from the list
/// (long-press) and it opens this same sheet the chat's ⋮ menu uses.

/// The 10 sales dispositions + labels (mirrors the backend LeadDisposition enum
/// and the web DISPOSITION_LABEL map). Order = the picker order.
const Map<String, String> kDispositions = {
  'NO_RESPONSE': 'No Response',
  'FOLLOW_UP': 'Follow Up',
  'REQUESTED_DISCOUNT': 'Requested Discount',
  'PRICE_CONCERN': 'Price Concern',
  'NOT_ELIGIBLE': 'Not Eligible',
  'QUALIFIED': 'Qualified',
  'CONVERTED_TO_DEAL': 'Converted to Deal',
  'CONTACT_LATER': 'Contact Later',
  'JUNK': 'Junk',
  'DEAD': 'Dead',
};

/// Dispositions that offer a reminder date/time (create a follow-up).
const Set<String> kReminderDispositions = {'FOLLOW_UP', 'CONTACT_LATER'};

/// Chip colour per disposition — positive outcomes green, at-risk amber/red,
/// dead-end muted. Used by the inbox row chip so a rep reads the pipeline at a
/// glance. Unknown / null falls back to neutral.
Color dispositionColor(String? key) {
  switch (key) {
    case 'QUALIFIED':
    case 'CONVERTED_TO_DEAL':
      return const Color(0xFF1B873F); // green
    case 'FOLLOW_UP':
    case 'CONTACT_LATER':
    case 'REQUESTED_DISCOUNT':
      return const Color(0xFFB88217); // amber
    case 'PRICE_CONCERN':
    case 'NOT_ELIGIBLE':
    case 'NO_RESPONSE':
      return const Color(0xFFB4462A); // red-ish
    case 'JUNK':
    case 'DEAD':
      return const Color(0xFF6B7280); // muted grey
    default:
      return AppTokens.textMutedLight;
  }
}

/// A compact disposition pill for a chat row. When [disposition] is null it
/// renders a faint "＋ Tag" affordance so the feature is discoverable and the
/// rep knows they can set one. Non-interactive itself — the row handles taps.
class DispositionChip extends StatelessWidget {
  const DispositionChip({super.key, required this.disposition});
  final String? disposition;

  @override
  Widget build(BuildContext context) {
    final key = disposition;
    final label = key == null ? '＋ Tag' : (kDispositions[key] ?? key);
    final color = key == null ? AppTokens.textMutedLight : dispositionColor(key);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: key == null ? 0.06 : 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: key == null ? 0.25 : 0.45)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: color,
          letterSpacing: 0.1,
        ),
      ),
    );
  }
}

/// Open the disposition picker for a lead and return the chosen key (or null if
/// dismissed). The single entry point used by both the chat screen and the
/// inbox row long-press.
Future<String?> showDispositionSheet(
  BuildContext context, {
  required String leadId,
  required String? current,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (_) => DispositionSheet(leadId: leadId, current: current),
  );
}

String _fmtWhen(DateTime d) => formatDateTime(d);

class DispositionSheet extends ConsumerStatefulWidget {
  const DispositionSheet({super.key, required this.leadId, required this.current});
  final String leadId;
  final String? current;
  @override
  ConsumerState<DispositionSheet> createState() => _DispositionSheetState();
}

class _DispositionSheetState extends ConsumerState<DispositionSheet> {
  String? _sel;
  final _noteCtrl = TextEditingController();
  DateTime? _reminderAt;
  bool _busy = false;
  String? _err;
  List<DispositionHistoryEntry>? _history;

  @override
  void initState() {
    super.initState();
    _sel = widget.current;
    _loadHistory();
  }

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  bool get _needsReminder => _sel != null && kReminderDispositions.contains(_sel);

  Future<void> _loadHistory() async {
    try {
      final h = await ref.read(leadsRepositoryProvider).dispositionHistory(widget.leadId);
      if (mounted) setState(() => _history = h);
    } catch (_) {
      if (mounted) setState(() => _history = const []);
    }
  }

  Future<void> _pickReminder() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _reminderAt ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(
          _reminderAt ?? DateTime(now.year, now.month, now.day, 10)),
    );
    if (!mounted) return;
    setState(() => _reminderAt = t == null
        ? DateTime(d.year, d.month, d.day, 10)
        : DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  Future<void> _save() async {
    final sel = _sel;
    if (sel == null) return;
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await ref.read(leadsRepositoryProvider).setDisposition(
            widget.leadId,
            disposition: sel,
            note: _noteCtrl.text,
            reminderAt: _needsReminder ? _reminderAt : null,
          );
      if (mounted) Navigator.pop(context, sel);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _err = e is AppError ? e.userMessage : 'Could not save disposition';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 12,
            bottom: MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Disposition',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: kDispositions.entries.map((e) {
                  return ChoiceChip(
                    label: Text(e.value),
                    selected: _sel == e.key,
                    onSelected: (_) => setState(() => _sel = e.key),
                  );
                }).toList(),
              ),
              if (_needsReminder) ...[
                const SizedBox(height: 14),
                InkWell(
                  onTap: _pickReminder,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        const Icon(Icons.alarm, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _reminderAt == null
                                ? 'Set a reminder (optional)'
                                : 'Remind me: ${_fmtWhen(_reminderAt!)}',
                            style: const TextStyle(fontSize: 13),
                          ),
                        ),
                        if (_reminderAt != null)
                          GestureDetector(
                            onTap: () => setState(() => _reminderAt = null),
                            child: const Icon(Icons.close, size: 16),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              TextField(
                controller: _noteCtrl,
                maxLength: 500,
                minLines: 1,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Note (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              if (_err != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(_err!,
                      style: const TextStyle(
                          color: AppTokens.statusDanger, fontSize: 12.5)),
                ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: (_busy || _sel == null) ? null : _save,
                  child: Text(_busy ? 'Saving…' : 'Save'),
                ),
              ),
              const SizedBox(height: 16),
              const Text('HISTORY',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                      color: AppTokens.textMutedLight)),
              const SizedBox(height: 6),
              if (_history == null)
                const Text('Loading…',
                    style: TextStyle(fontSize: 12.5, color: AppTokens.textMutedLight))
              else if (_history!.isEmpty)
                const Text('No disposition set yet.',
                    style: TextStyle(fontSize: 12.5, color: AppTokens.textMutedLight))
              else
                ..._history!.map((h) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${kDispositions[h.disposition] ?? h.disposition} · ${h.byName ?? 'Someone'} · ${_fmtWhen(h.at)}',
                            style: const TextStyle(
                                fontSize: 12.5, fontWeight: FontWeight.w600),
                          ),
                          if (h.note != null && h.note!.isNotEmpty)
                            Text(h.note!,
                                style: const TextStyle(
                                    fontSize: 12.5, color: AppTokens.textMutedLight)),
                        ],
                      ),
                    )),
            ],
          ),
        ),
      ),
    );
  }
}

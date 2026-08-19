import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../whatsapp/data/whatsapp_repository.dart';
import '../../whatsapp/domain/wa_thread.dart';
import '../../whatsapp/presentation/thread_screen.dart';
import '../application/call_controller.dart';
import '../domain/call_history.dart';

/// The rep's "Calls" tab — a WhatsApp-style call log of the calls they own
/// (assigned or answered), missed ones highlighted. Built off the audit finding
/// that ~86% of inbound calls are missed and invisible to reps. Tapping a row
/// opens the chat; the green button calls back (or, if the customer hasn't
/// granted call permission, drops into the chat to request it / message).
class CallsScreen extends ConsumerStatefulWidget {
  const CallsScreen({super.key});

  @override
  ConsumerState<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends ConsumerState<CallsScreen> {
  String _filter = 'all'; // all | missed | incoming | outgoing

  Future<WhatsappThread?> _resolve(CallHistoryItem it) async {
    final repo = ref.read(whatsappRepositoryProvider);
    try {
      if (it.threadId != null && it.threadId!.isNotEmpty) {
        return await repo.getThread(it.threadId!);
      }
      if (it.leadId != null && it.leadId!.isNotEmpty) {
        return await repo.byLead(it.leadId!);
      }
    } catch (_) {}
    return null;
  }

  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _openThread(CallHistoryItem it) async {
    final t = await _resolve(it);
    if (!mounted) return;
    if (t == null) return _toast('Could not open this chat.');
    Navigator.of(context, rootNavigator: true)
        .push(MaterialPageRoute(builder: (_) => ThreadScreen(thread: t)));
  }

  Future<void> _callBack(CallHistoryItem it) async {
    final t = await _resolve(it);
    if (!mounted) return;
    if (t == null) return _toast('Could not reach this contact.');
    if (t.canCall) {
      ref.read(callControllerProvider.notifier).startOutbound(
            threadId: t.id,
            name: t.displayName,
            phone: t.phone,
          );
    } else {
      // Meta hasn't been granted call permission yet — drop into the chat where
      // the rep can request it (or just message the caller back).
      Navigator.of(context, rootNavigator: true)
          .push(MaterialPageRoute(builder: (_) => ThreadScreen(thread: t)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final missed = ref.watch(myMissedCallCountProvider).valueOrNull ?? 0;
    final async = ref.watch(callsHistoryProvider(_filter));

    return Column(
      children: [
        if (missed > 0)
          Container(
            width: double.infinity,
            color: AppTokens.statusDanger.withValues(alpha: 0.10),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Icon(Icons.call_missed,
                    color: AppTokens.statusDanger, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '$missed missed ${missed == 1 ? 'call' : 'calls'} in the last 24h — call them back',
                    style: TextStyle(
                        color: AppTokens.statusDanger,
                        fontSize: 13,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
        _FilterBar(
          value: _filter,
          onChanged: (f) => setState(() => _filter = f),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(callsHistoryProvider(_filter));
              ref.invalidate(myMissedCallCountProvider);
              await ref.read(callsHistoryProvider(_filter).future);
            },
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => _ErrorState(
                onRetry: () => ref.invalidate(callsHistoryProvider(_filter)),
              ),
              data: (page) => page.items.isEmpty
                  ? _EmptyState(filter: _filter)
                  : _CallList(
                      items: page.items,
                      onTap: _openThread,
                      onCallBack: _callBack,
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

class _FilterBar extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const _FilterBar({required this.value, required this.onChanged});

  static const _opts = [
    ('all', 'All'),
    ('missed', 'Missed'),
    ('incoming', 'Incoming'),
    ('outgoing', 'Outgoing'),
  ];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          for (final (key, label) in _opts)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(label),
                selected: value == key,
                onSelected: (_) => onChanged(key),
                visualDensity: VisualDensity.compact,
              ),
            ),
        ],
      ),
    );
  }
}

class _CallList extends StatelessWidget {
  final List<CallHistoryItem> items;
  final void Function(CallHistoryItem) onTap;
  final void Function(CallHistoryItem) onCallBack;
  const _CallList(
      {required this.items, required this.onTap, required this.onCallBack});

  String _dayLabel(DateTime d) {
    final now = DateTime.now();
    final day = DateTime(d.year, d.month, d.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(day).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return '${d.day} ${months[d.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    // Build a flat list of day-headers + rows.
    final children = <Widget>[];
    String? lastDay;
    for (final it in items) {
      final label = _dayLabel(it.createdAt);
      if (label != lastDay) {
        lastDay = label;
        children.add(Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
          child: Text(
            label.toUpperCase(),
            style: TextStyle(
                fontSize: 11,
                letterSpacing: 0.4,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).hintColor),
          ),
        ));
      }
      children.add(_CallRow(item: it, onTap: onTap, onCallBack: onCallBack));
    }
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: children,
    );
  }
}

class _CallRow extends StatelessWidget {
  final CallHistoryItem item;
  final void Function(CallHistoryItem) onTap;
  final void Function(CallHistoryItem) onCallBack;
  const _CallRow(
      {required this.item, required this.onTap, required this.onCallBack});

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '#';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  String _dur(int? s) {
    if (s == null || s <= 0) return '';
    final m = s ~/ 60, r = s % 60;
    return ' · $m:${r.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final missed = item.isMissed;
    IconData dirIcon;
    Color dirColor;
    String dirLabel;
    if (missed) {
      dirIcon = Icons.call_missed;
      dirColor = AppTokens.statusDanger;
      dirLabel = 'Missed';
    } else if (item.isInbound) {
      dirIcon = Icons.call_received;
      dirColor = AppTokens.statusSuccess;
      dirLabel = 'Incoming';
    } else {
      dirIcon = Icons.call_made;
      dirColor = Theme.of(context).hintColor;
      dirLabel = 'Outgoing';
    }
    final time = TimeOfDay.fromDateTime(item.createdAt).format(context);
    final sub = '$dirLabel${item.isConnected ? _dur(item.durationSeconds) : ''} · $time';

    return InkWell(
      onTap: () => onTap(item),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        child: Row(
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: AppTokens.brandNavy.withValues(alpha: 0.10),
              child: Text(
                _initials(item.displayName),
                style: TextStyle(
                    color: AppTokens.brandNavy,
                    fontWeight: FontWeight.w600,
                    fontSize: 14),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: missed ? AppTokens.statusDanger : null,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(dirIcon, size: 15, color: dirColor),
                      const SizedBox(width: 5),
                      Flexible(
                        child: Text(
                          sub,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 12,
                              color: Theme.of(context).hintColor),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Call back',
              icon: Icon(Icons.phone, color: AppTokens.statusSuccess),
              onPressed: () => onCallBack(item),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String filter;
  const _EmptyState({required this.filter});
  @override
  Widget build(BuildContext context) {
    final msg = filter == 'missed'
        ? 'No missed calls — nice.'
        : 'No calls here yet.';
    return ListView(
      children: [
        const SizedBox(height: 90),
        Icon(Icons.phone_disabled,
            size: 46, color: Theme.of(context).hintColor),
        const SizedBox(height: 12),
        Center(
          child: Text(msg,
              style: TextStyle(color: Theme.of(context).hintColor)),
        ),
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  final VoidCallback onRetry;
  const _ErrorState({required this.onRetry});
  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 90),
        Icon(Icons.error_outline,
            size: 40, color: Theme.of(context).hintColor),
        const SizedBox(height: 12),
        Center(
          child: Text('Could not load your calls.',
              style: TextStyle(color: Theme.of(context).hintColor)),
        ),
        const SizedBox(height: 12),
        Center(
          child: OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ),
      ],
    );
  }
}

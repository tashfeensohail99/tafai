import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../data/followups_providers.dart';
import '../data/followups_repository.dart';
import '../domain/follow_up.dart';

class FollowUpsScreen extends ConsumerStatefulWidget {
  const FollowUpsScreen({super.key});

  @override
  ConsumerState<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsScreenState extends ConsumerState<FollowUpsScreen> {
  String _bucket = 'today';
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(followUpsListProvider(_bucket));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
          child: SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'overdue', label: Text('Overdue')),
                ButtonSegment(value: 'today', label: Text('Today')),
                ButtonSegment(value: 'upcoming', label: Text('Upcoming')),
              ],
              selected: {_bucket},
              onSelectionChanged: (s) => setState(() => _bucket = s.first),
              showSelectedIcon: false,
            ),
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        Expanded(
          child: async.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(followUpsListProvider(_bucket)),
            ),
            data: (items) => items.isEmpty
                ? EmptyView(
                    icon: Icons.task_alt_outlined,
                    title: 'All clear',
                    message:
                        'No ${followUpBucketLabel(_bucket).toLowerCase()} follow-ups.',
                  )
                : RefreshIndicator(
                    onRefresh: () =>
                        ref.refresh(followUpsListProvider(_bucket).future),
                    child: ListView.separated(
                      padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                          AppTokens.space1, AppTokens.space4, AppTokens.space8),
                      itemCount: items.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: AppTokens.space3),
                      itemBuilder: (_, i) => _FollowUpCard(
                        followUp: items[i],
                        busy: _busy,
                        onOpenLead: () =>
                            context.push(AppRoutes.leadDetail(items[i].leadId)),
                        onComplete: () => _complete(items[i]),
                        onReschedule: () => _reschedule(items[i]),
                      ),
                    ),
                  ),
          ),
        ),
      ],
    );
  }

  Future<void> _complete(FollowUp f) async {
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Complete follow-up'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(f.leadName, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: controller,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Outcome (optional)',
                hintText: 'What happened?',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Complete')),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(followUpsRepositoryProvider)
          .complete(f.id, outcomeNotes: controller.text.trim());
      ref.invalidate(followUpsListProvider(_bucket));
      _toast('Follow-up completed');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reschedule(FollowUp f) async {
    final now = DateTime.now();
    final initial = f.dueAt.isAfter(now) ? f.dueAt : now;
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (time == null || !mounted) return;
    final dueAt =
        DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() => _busy = true);
    try {
      await ref.read(followUpsRepositoryProvider).reschedule(f.id, dueAt);
      ref.invalidate(followUpsListProvider(_bucket));
      _toast('Rescheduled to ${formatDateTime(dueAt)}');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }
}

Color _dueColor(DateTime due) {
  final now = DateTime.now();
  if (due.isBefore(now)) return AppTokens.statusDanger;
  if (due.year == now.year && due.month == now.month && due.day == now.day) {
    return AppTokens.statusWarning;
  }
  return AppTokens.statusInfo;
}

IconData _contactIcon(String? m) => switch ((m ?? '').toUpperCase()) {
      'WHATSAPP' => Icons.chat_bubble_outline,
      'EMAIL' => Icons.email_outlined,
      'IN_PERSON' || 'OFFICE' => Icons.person_pin_circle_outlined,
      _ => Icons.phone_outlined,
    };

Color _priorityColor(String? p) => switch (p) {
      'URGENT' => AppTokens.statusDanger,
      'HIGH' => AppTokens.statusWarning,
      'MEDIUM' => AppTokens.statusInfo,
      _ => AppTokens.statusNeutral,
    };

class _FollowUpCard extends StatelessWidget {
  final FollowUp followUp;
  final bool busy;
  final VoidCallback onOpenLead;
  final VoidCallback onComplete;
  final VoidCallback onReschedule;

  const _FollowUpCard({
    required this.followUp,
    required this.busy,
    required this.onOpenLead,
    required this.onComplete,
    required this.onReschedule,
  });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final f = followUp;
    final dueColor = _dueColor(f.dueAt);
    final highPriority = f.priority == 'URGENT' || f.priority == 'HIGH';
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: onOpenLead,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          f.leadName,
                          style: t.titleMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (highPriority) ...[
                        const SizedBox(width: AppTokens.space2),
                        StatusBadge(
                            label: followUpPriorityLabel(f.priority),
                            color: _priorityColor(f.priority)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(f.title,
                      style: t.bodyMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.space3),
            Row(
              children: [
                Icon(_contactIcon(f.contactMethod),
                    size: 15, color: AppTokens.statusNeutral),
                const SizedBox(width: AppTokens.space2),
                Icon(Icons.schedule, size: 14, color: dueColor),
                const SizedBox(width: 4),
                Text(relativeTime(f.dueAt),
                    style: t.bodySmall
                        ?.copyWith(color: dueColor, fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: AppTokens.space2),
            Row(
              children: [
                const Spacer(),
                TextButton(
                  onPressed: busy ? null : onReschedule,
                  child: const Text('Reschedule'),
                ),
                const SizedBox(width: AppTokens.space2),
                FilledButton.tonalIcon(
                  onPressed: busy ? null : onComplete,
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Done'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

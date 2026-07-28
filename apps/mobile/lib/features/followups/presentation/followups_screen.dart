import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/followups_providers.dart';
import '../data/followups_repository.dart';
import '../domain/follow_up.dart';
import 'followup_form_sheet.dart';

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
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-new-followup',
        onPressed: () async {
          final created = await showFollowUpFormWithLeadPicker(context);
          if (created == true && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Follow-up created')));
          }
        },
        icon: const Icon(Icons.add_task),
        label: const Text('Follow-up'),
      ),
      body: Column(
      children: [
        // ── bucket tab bar ────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
          child: BucketTabBar(
            selected: _bucket,
            buckets: const ['overdue', 'today', 'upcoming'],
            labels: const ['Overdue', 'Today', 'Upcoming'],
            onSelect: (b) => setState(() => _bucket = b),
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        Expanded(
          child: async.when(
            loading: () => const SkeletonList(),
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
                    color: AppTokens.brandNavy,
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
      ),
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
                labelText: 'Outcome note (optional)',
                hintText: 'A note on this follow-up — not the disposition',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Premium follow-up card ────────────────────────────────────────────────────

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
    final f = followUp;
    final dueColor = _dueColor(f.dueAt);
    final highPriority = f.priority == 'URGENT' || f.priority == 'HIGH';

    return Container(
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.white,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // left accent
              Container(width: 4, color: dueColor),

              // body
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                      AppTokens.space4, AppTokens.space4,
                      AppTokens.space4, AppTokens.space3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // ── header row ──────────────────────────────────────
                      GestureDetector(
                        onTap: onOpenLead,
                        behavior: HitTestBehavior.opaque,
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                f.leadName,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: AppTokens.textPrimaryLight,
                                  letterSpacing: -0.2,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (highPriority) ...[
                              const SizedBox(width: AppTokens.space2),
                              PremiumStatusBadge(
                                label: followUpPriorityLabel(f.priority),
                                color: _priorityColor(f.priority),
                                compact: true,
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        f.title,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppTokens.textSecondaryLight,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),

                      const SizedBox(height: AppTokens.space3),

                      // ── due time row ────────────────────────────────────
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: dueColor.withValues(alpha: 0.10),
                              borderRadius: const BorderRadius.all(
                                  AppTokens.radiusFull),
                              border: Border.all(
                                  color: dueColor.withValues(alpha: 0.25),
                                  width: 0.5),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.schedule,
                                    size: 12, color: dueColor),
                                const SizedBox(width: 4),
                                Text(
                                  relativeTime(f.dueAt),
                                  style: TextStyle(
                                    color: dueColor,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: AppTokens.space3),
                          Icon(_contactIcon(f.contactMethod),
                              size: 15, color: AppTokens.textMutedLight),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              _contactLabel(f.contactMethod),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppTokens.textMutedLight,
                              ),
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: AppTokens.space3),

                      // ── action buttons ──────────────────────────────────
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          CrmActionButton(
                            label: 'Reschedule',
                            icon: Icons.schedule,
                            filled: false,
                            onPressed: busy ? null : onReschedule,
                          ),
                          const SizedBox(width: AppTokens.space2),
                          CrmActionButton(
                            label: 'Done',
                            icon: Icons.check_rounded,
                            filled: true,
                            color: AppTokens.statusSuccess,
                            onPressed: busy ? null : onComplete,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _contactLabel(String? m) => switch ((m ?? '').toUpperCase()) {
        'WHATSAPP' => 'WhatsApp',
        'EMAIL' => 'Email',
        'IN_PERSON' || 'OFFICE' => 'In person',
        'PHONE' => 'Phone',
        _ => 'Call',
      };
}

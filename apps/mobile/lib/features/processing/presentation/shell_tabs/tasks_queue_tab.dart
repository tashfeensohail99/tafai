import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../data/processing_repository.dart';
import '../../domain/processing_models.dart';
import '../case_workspace_screen.dart';
import '../processing_ui.dart';

/// Cross-case task queue — all open / in-progress / blocked tasks across the
/// user's cases. Quick "Done" inline; tap the body to open the owning case.
class TasksQueueTab extends ConsumerWidget {
  const TasksQueueTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(aggregatedTasksProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(aggregatedTasksProvider.future),
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(
              error: e,
              onRetry: () => ref.invalidate(aggregatedTasksProvider),
            ),
          ),
        ]),
        data: (tasks) {
          if (tasks.isEmpty) {
            return ListView(children: const [
              Padding(
                padding: EdgeInsets.only(top: 80),
                child: EmptyView(
                  icon: Icons.checklist_outlined,
                  title: 'All tasks complete',
                  message: 'No open tasks across your cases right now.',
                ),
              ),
            ]);
          }
          final now = DateTime.now();
          final overdue = tasks
              .where((t) =>
                  t.task.dueDate != null && t.task.dueDate!.isBefore(now))
              .toList();
          final onTime = tasks
              .where((t) =>
                  t.task.dueDate == null || !t.task.dueDate!.isBefore(now))
              .toList();
          return ListView(
            padding: const EdgeInsets.all(AppTokens.space4),
            children: [
              if (overdue.isNotEmpty) ...[
                const Row(children: [
                  Icon(Icons.warning_amber_rounded,
                      size: 14, color: AppTokens.statusDanger),
                  SizedBox(width: 6),
                  Text('OVERDUE',
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.5,
                          color: AppTokens.statusDanger)),
                ]),
                const SizedBox(height: AppTokens.space2),
                ...overdue.map((t) => _TaskQueueCard(row: t)),
                const SizedBox(height: AppTokens.space4),
              ],
              if (onTime.isNotEmpty) ...[
                if (overdue.isNotEmpty) const SectionLabel('Upcoming'),
                if (overdue.isNotEmpty) const SizedBox(height: AppTokens.space2),
                ...onTime.map((t) => _TaskQueueCard(row: t)),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _TaskQueueCard extends ConsumerStatefulWidget {
  final AggregatedTask row;
  const _TaskQueueCard({required this.row});

  @override
  ConsumerState<_TaskQueueCard> createState() => _TaskQueueCardState();
}

class _TaskQueueCardState extends ConsumerState<_TaskQueueCard> {
  bool _busy = false;

  Future<void> _markDone() async {
    setState(() => _busy = true);
    try {
      await ref.read(processingRepositoryProvider).updateTaskStatus(
            widget.row.task.caseId,
            widget.row.task.id,
            status: 'DONE',
          );
      ref.invalidate(aggregatedTasksProvider);
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
    final t = widget.row.task;
    final c = widget.row.caseRef;
    final overdue =
        t.dueDate != null && t.dueDate!.isBefore(DateTime.now());
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space3),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CaseWorkspaceScreen(caseId: c.id),
                      ),
                    ),
                    child: Text(t.title,
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w600)),
                  ),
                ),
                _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : OutlinedButton.icon(
                        onPressed: _markDone,
                        icon: const Icon(Icons.check, size: 14),
                        label: const Text('Done'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTokens.statusSuccess,
                          side: const BorderSide(
                              color: AppTokens.borderStrongLight),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 6),
                          textStyle: const TextStyle(fontSize: 12),
                          minimumSize: const Size(0, 32),
                        ),
                      ),
              ],
            ),
            if (t.description != null && t.description!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(t.description!,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppTokens.textMutedLight)),
            ],
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusPill(label: t.priority, tone: taskPriorityTone(t.priority)),
                if (t.dueDate != null)
                  Text(
                    '${overdue ? 'Overdue · ' : 'Due '}${formatDate(t.dueDate!)}',
                    style: TextStyle(
                      fontSize: 11.5,
                      color: overdue
                          ? AppTokens.statusDanger
                          : AppTokens.textMutedLight,
                      fontWeight:
                          overdue ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                Text(
                  '${c.personName} · ${labelForServiceCode(c.service)}',
                  style: const TextStyle(
                      fontSize: 11.5, color: AppTokens.textMutedLight),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

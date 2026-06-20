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

/// Tasks tab — create tasks + advance status inline. Tapping the status icon
/// rotates OPEN → IN_PROGRESS → DONE → OPEN (matches the web TasksTab).
class CaseTasksTab extends ConsumerWidget {
  final String caseId;
  const CaseTasksTab({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseTasksProvider(caseId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTokens.primary600,
        onPressed: () => _addTask(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Add task'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(caseTasksProvider(caseId).future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () => ref.invalidate(caseTasksProvider(caseId)),
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
                    title: 'No tasks yet',
                    message:
                        "Track per-case actions like 'Call client about passport'.",
                  ),
                ),
              ]);
            }
            final open = tasks
                .where((t) => t.status == 'OPEN' || t.status == 'IN_PROGRESS')
                .toList();
            final done = tasks
                .where((t) => t.status == 'DONE' || t.status == 'CANCELLED')
                .toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space4, AppTokens.space4, AppTokens.space4, 88),
              children: [
                if (open.isNotEmpty) ...[
                  SectionLabel('Open (${open.length})'),
                  const SizedBox(height: AppTokens.space2),
                  ...open.map((t) => _TaskRow(caseId: caseId, task: t)),
                ],
                if (done.isNotEmpty) ...[
                  const SizedBox(height: AppTokens.space4),
                  SectionLabel('Done (${done.length})'),
                  const SizedBox(height: AppTokens.space2),
                  ...done.map((t) => _TaskRow(caseId: caseId, task: t)),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _addTask(BuildContext context, WidgetRef ref) async {
    final result = await showModalBottomSheet<
        ({String title, String? description, String priority})>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _AddTaskSheet(),
    );
    if (result == null) return;
    try {
      await ref.read(processingRepositoryProvider).createTask(
            caseId,
            title: result.title,
            description: result.description,
            priority: result.priority,
          );
      ref.invalidate(caseTasksProvider(caseId));
    } on AppError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }
}

class _TaskRow extends ConsumerStatefulWidget {
  final String caseId;
  final ProcessingTask task;
  const _TaskRow({required this.caseId, required this.task});

  @override
  ConsumerState<_TaskRow> createState() => _TaskRowState();
}

class _TaskRowState extends ConsumerState<_TaskRow> {
  bool _busy = false;

  String get _next {
    switch (widget.task.status) {
      case 'OPEN':
        return 'IN_PROGRESS';
      case 'IN_PROGRESS':
        return 'DONE';
      case 'DONE':
        return 'OPEN';
      default:
        return widget.task.status;
    }
  }

  Future<void> _advance() async {
    setState(() => _busy = true);
    try {
      await ref
          .read(processingRepositoryProvider)
          .updateTaskStatus(widget.caseId, widget.task.id, status: _next);
      ref.invalidate(caseTasksProvider(widget.caseId));
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
        setState(() => _busy = false);
      }
    }
  }

  IconData get _statusIcon {
    switch (widget.task.status) {
      case 'DONE':
        return Icons.check_circle;
      case 'CANCELLED':
        return Icons.cancel;
      case 'IN_PROGRESS':
        return Icons.timelapse;
      default:
        return Icons.radio_button_unchecked;
    }
  }

  Color get _statusColor {
    switch (widget.task.status) {
      case 'DONE':
        return AppTokens.statusSuccess;
      case 'IN_PROGRESS':
        return AppTokens.primary600;
      default:
        return AppTokens.textMutedLight;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.task;
    final isDone = t.status == 'DONE' || t.status == 'CANCELLED';
    final overdue = t.dueDate != null &&
        !isDone &&
        t.dueDate!.isBefore(DateTime.now());
    return Opacity(
      opacity: isDone ? 0.6 : 1,
      child: Padding(
        padding: const EdgeInsets.only(bottom: AppTokens.space3),
        child: SectionCard(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _busy
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : IconButton(
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints(minWidth: 28, minHeight: 28),
                      icon: Icon(_statusIcon, color: _statusColor, size: 22),
                      onPressed: _advance,
                    ),
              const SizedBox(width: AppTokens.space2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t.title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        decoration:
                            isDone ? TextDecoration.lineThrough : null,
                        color: isDone
                            ? AppTokens.textMutedLight
                            : AppTokens.textPrimaryLight,
                      ),
                    ),
                    if (t.description != null && t.description!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(t.description!,
                          style: const TextStyle(
                              fontSize: 12.5,
                              color: AppTokens.textMutedLight)),
                    ],
                    const SizedBox(height: AppTokens.space2),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        StatusPill(
                            label: t.priority, tone: taskPriorityTone(t.priority)),
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
                        if (t.assignedTo != null)
                          Text('· ${t.assignedTo!.display}',
                              style: const TextStyle(
                                  fontSize: 11.5,
                                  color: AppTokens.textMutedLight)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddTaskSheet extends StatefulWidget {
  const _AddTaskSheet();

  @override
  State<_AddTaskSheet> createState() => _AddTaskSheetState();
}

class _AddTaskSheetState extends State<_AddTaskSheet> {
  final _title = TextEditingController();
  final _desc = TextEditingController();
  String _priority = 'NORMAL';

  static const _priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

  @override
  void dispose() {
    _title.dispose();
    _desc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppTokens.surfaceLight,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(AppTokens.space5),
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
            Text('Add task', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: _title,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Task title',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: _desc,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: AppTokens.space3),
            const SectionLabel('Priority'),
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 6,
              children: _priorities.map((p) {
                final on = _priority == p;
                return ChoiceChip(
                  label: Text(p, style: const TextStyle(fontSize: 12)),
                  selected: on,
                  onSelected: (_) => setState(() => _priority = p),
                  selectedColor: AppTokens.primary100,
                );
              }).toList(),
            ),
            const SizedBox(height: AppTokens.space4),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppTokens.primary600,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: () {
                  final title = _title.text.trim();
                  if (title.isEmpty) return;
                  Navigator.of(context).pop((
                    title: title,
                    description:
                        _desc.text.trim().isEmpty ? null : _desc.text.trim(),
                    priority: _priority,
                  ));
                },
                child: const Text('Add task'),
              ),
            ),
            const SizedBox(height: AppTokens.space2),
          ],
        ),
      ),
    );
  }
}

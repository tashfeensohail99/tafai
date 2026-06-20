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

/// Notes tab — create + pin internal notes. Pinned notes sort first.
class CaseNotesTab extends ConsumerWidget {
  final String caseId;
  const CaseNotesTab({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseNotesProvider(caseId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTokens.primary600,
        onPressed: () => _addNote(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Add note'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(caseNotesProvider(caseId).future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () => ref.invalidate(caseNotesProvider(caseId)),
              ),
            ),
          ]),
          data: (notes) {
            if (notes.isEmpty) {
              return ListView(children: const [
                Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: EmptyView(
                    icon: Icons.sticky_note_2_outlined,
                    title: 'No notes yet',
                    message:
                        'Add internal notes visible only to processing staff.',
                  ),
                ),
              ]);
            }
            final sorted = [...notes]
              ..sort((a, b) {
                if (a.isPinned != b.isPinned) return a.isPinned ? -1 : 1;
                return b.createdAt.compareTo(a.createdAt);
              });
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space4, AppTokens.space4, AppTokens.space4, 88),
              itemCount: sorted.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) =>
                  _NoteCard(caseId: caseId, note: sorted[i]),
            );
          },
        ),
      ),
    );
  }

  Future<void> _addNote(BuildContext context, WidgetRef ref) async {
    final result = await showModalBottomSheet<({String content, String type})>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _AddNoteSheet(),
    );
    if (result == null) return;
    try {
      await ref
          .read(processingRepositoryProvider)
          .createNote(caseId, content: result.content, noteType: result.type);
      ref.invalidate(caseNotesProvider(caseId));
    } on AppError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }
}

class _NoteCard extends ConsumerStatefulWidget {
  final String caseId;
  final ProcessingNote note;
  const _NoteCard({required this.caseId, required this.note});

  @override
  ConsumerState<_NoteCard> createState() => _NoteCardState();
}

class _NoteCardState extends ConsumerState<_NoteCard> {
  bool _busy = false;

  Future<void> _togglePin() async {
    setState(() => _busy = true);
    try {
      await ref.read(processingRepositoryProvider).pinNote(
            widget.caseId,
            widget.note.id,
            isPinned: !widget.note.isPinned,
          );
      ref.invalidate(caseNotesProvider(widget.caseId));
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
    final n = widget.note;
    final author = n.createdBy?.display ?? 'Officer';
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(n.isPinned ? Icons.push_pin : Icons.sticky_note_2_outlined,
                  size: 14,
                  color: n.isPinned
                      ? AppTokens.primary600
                      : AppTokens.textMutedLight),
              const SizedBox(width: AppTokens.space2),
              StatusPill(
                label: kNoteTypeLabel[n.noteType] ?? n.noteType,
                tone: docStatusTone('NOT_SUBMITTED'),
              ),
              const Spacer(),
              Text('$author · ${relativeTime(n.createdAt)}',
                  style: const TextStyle(
                      fontSize: 11, color: AppTokens.textMutedLight)),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          Text(n.content,
              style: const TextStyle(fontSize: 13.5, height: 1.5)),
          const SizedBox(height: AppTokens.space2),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: _busy ? null : _togglePin,
              icon: Icon(
                  n.isPinned ? Icons.push_pin_outlined : Icons.push_pin,
                  size: 15),
              label: Text(n.isPinned ? 'Unpin' : 'Pin'),
              style: TextButton.styleFrom(
                foregroundColor: AppTokens.textSecondaryLight,
                padding: EdgeInsets.zero,
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AddNoteSheet extends StatefulWidget {
  const _AddNoteSheet();

  @override
  State<_AddNoteSheet> createState() => _AddNoteSheetState();
}

class _AddNoteSheetState extends State<_AddNoteSheet> {
  final _ctrl = TextEditingController();
  String _type = 'GENERAL';

  @override
  void dispose() {
    _ctrl.dispose();
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
            Text('Add note', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AppTokens.space3),
            const SectionLabel('Type'),
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: kNoteTypeLabel.entries.map((e) {
                final on = _type == e.key;
                return ChoiceChip(
                  label: Text(e.value, style: const TextStyle(fontSize: 12)),
                  selected: on,
                  onSelected: (_) => setState(() => _type = e.key),
                  selectedColor: AppTokens.primary100,
                );
              }).toList(),
            ),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: _ctrl,
              maxLines: 4,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                hintText: 'Type your note here…',
                border: OutlineInputBorder(),
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
                onPressed: () {
                  final t = _ctrl.text.trim();
                  if (t.isNotEmpty) {
                    Navigator.of(context).pop((content: t, type: _type));
                  }
                },
                child: const Text('Save note'),
              ),
            ),
            const SizedBox(height: AppTokens.space2),
          ],
        ),
      ),
    );
  }
}

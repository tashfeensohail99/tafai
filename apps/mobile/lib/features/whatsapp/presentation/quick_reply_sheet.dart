import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../data/whatsapp_repository.dart';
import '../domain/wa_quick_reply.dart';

/// Bottom sheet listing quick replies (Team + Mine). Tapping one returns its
/// body text — the caller substitutes {{name}} and inserts it into the
/// composer. Reps create/delete their own from here; template managers also
/// manage team-wide ones.
Future<String?> showQuickReplySheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => const _QuickReplySheet(),
  );
}

class _QuickReplySheet extends ConsumerStatefulWidget {
  const _QuickReplySheet();

  @override
  ConsumerState<_QuickReplySheet> createState() => _QuickReplySheetState();
}

class _QuickReplySheetState extends ConsumerState<_QuickReplySheet> {
  QuickReplyList? _data;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
    });
    try {
      final data = await ref.read(whatsappRepositoryProvider).quickReplies();
      if (mounted) setState(() => _data = data);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _createNew() async {
    final title = TextEditingController();
    final body = TextEditingController();
    bool team = false;
    final canTeam = _data?.canManageTeam ?? false;
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('New quick reply'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: title,
                autofocus: true,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                    labelText: 'Short title', hintText: 'e.g. Office address'),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: body,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Message text',
                  hintText: 'Use {{name}} for the customer’s first name',
                ),
              ),
              if (canTeam)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Share with the whole team',
                      style: TextStyle(fontSize: 13)),
                  value: team,
                  onChanged: (v) => setDialogState(() => team = v ?? false),
                ),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Save')),
          ],
        ),
      ),
    );
    if (saved != true || title.text.trim().isEmpty || body.text.trim().isEmpty) {
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(whatsappRepositoryProvider).createQuickReply(
            title: title.text.trim(),
            body: body.text.trim(),
            team: team,
          );
      await _load();
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(QuickReply qr) async {
    setState(() => _busy = true);
    try {
      await ref.read(whatsappRepositoryProvider).deleteQuickReply(qr.id);
      await _load();
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _section(String label, List<QuickReply> rows, bool deletable) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppTokens.space4, AppTokens.space3, AppTokens.space4, 4),
          child: Text(label.toUpperCase(),
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                  color: AppTokens.textMutedLight)),
        ),
        if (rows.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppTokens.space4),
            child: Text('None yet.',
                style:
                    TextStyle(fontSize: 12, color: AppTokens.textMutedLight)),
          )
        else
          for (final qr in rows)
            ListTile(
              dense: true,
              title: Text(qr.title,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(qr.body,
                  maxLines: 2, overflow: TextOverflow.ellipsis),
              trailing: deletable
                  ? IconButton(
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed: _busy ? null : () => _delete(qr),
                    )
                  : null,
              onTap: () => Navigator.of(context).pop(qr.body),
            ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      builder: (ctx, scrollCtrl) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppTokens.space4, AppTokens.space4, AppTokens.space2, 0),
            child: Row(
              children: [
                const Icon(Icons.bolt, color: AppTokens.brandNavy, size: 20),
                const SizedBox(width: AppTokens.space2),
                const Expanded(
                  child: Text('Quick replies',
                      style: TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700)),
                ),
                TextButton.icon(
                  onPressed: _busy ? null : _createNew,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('New'),
                ),
              ],
            ),
          ),
          Expanded(
            child: _error != null
                ? ErrorView(error: _error!, onRetry: _load)
                : data == null
                    ? const LoadingView()
                    : ListView(
                        controller: scrollCtrl,
                        children: [
                          _section('Team', data.team, data.canManageTeam),
                          _section('Mine', data.mine, true),
                          const SizedBox(height: AppTokens.space6),
                        ],
                      ),
          ),
        ],
      ),
    );
  }
}

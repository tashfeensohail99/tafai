import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../data/whatsapp_repository.dart';
import '../domain/wa_template.dart';

/// Public data class returned by [showTemplatePicker].
class TemplateSendParams {
  final String templateName;
  final String language;
  final List<Map<String, dynamic>> components;
  const TemplateSendParams({
    required this.templateName,
    required this.language,
    required this.components,
  });
}

/// Opens a bottom sheet that lets the user pick a WhatsApp template and fill
/// its `{{N}}` variables. Returns [TemplateSendParams] on success or null on
/// cancel.
Future<TemplateSendParams?> showTemplatePicker(
    BuildContext context, WidgetRef ref,
    {String? channelId}) {
  return showModalBottomSheet<TemplateSendParams>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _TemplatePickerSheet(channelId: channelId),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

class _TemplatePickerSheet extends ConsumerStatefulWidget {
  const _TemplatePickerSheet({this.channelId});

  /// The conversation's channel — templates are fetched for it. Falls back to
  /// the first channel only when the thread didn't carry one.
  final String? channelId;

  @override
  ConsumerState<_TemplatePickerSheet> createState() =>
      _TemplatePickerSheetState();
}

class _TemplatePickerSheetState extends ConsumerState<_TemplatePickerSheet> {
  bool _loading = true;
  String? _error;
  List<WaTemplate> _templates = [];
  String? _channelId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = ref.read(whatsappRepositoryProvider);
      // Prefer the conversation's own channel; only look up the channel list
      // when the thread didn't supply one.
      var channelId = widget.channelId;
      if (channelId == null) {
        final channels = await repo.listChannels();
        if (channels.isEmpty) {
          if (mounted) {
            setState(() {
              _loading = false;
              _error = 'No WhatsApp channel configured.';
            });
          }
          return;
        }
        channelId = channels.first.id;
      }
      _channelId = channelId;
      final templates = await repo.listTemplates(_channelId!);
      if (mounted) {
        setState(() {
          _templates = templates;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      minChildSize: 0.4,
      expand: false,
      builder: (_, ctrl) => Column(
        children: [
          const SizedBox(height: AppTokens.space2),
          Container(
            width: 40,
            height: 4,
            decoration: const BoxDecoration(
              color: AppTokens.borderLight,
              borderRadius: BorderRadius.all(Radius.circular(2)),
            ),
          ),
          const SizedBox(height: AppTokens.space3),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppTokens.space4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Send a template',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
          ),
          const Divider(height: AppTokens.space4),
          Expanded(
            child: _loading
                ? const LoadingView()
                : _error != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(AppTokens.space4),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(_error!,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                      color: AppTokens.statusDanger)),
                              const SizedBox(height: AppTokens.space3),
                              TextButton(
                                  onPressed: _load,
                                  child: const Text('Retry')),
                            ],
                          ),
                        ),
                      )
                    : _templates.isEmpty
                        ? const EmptyView(
                            icon: Icons.auto_awesome_outlined,
                            title: 'No approved templates',
                            message:
                                'Templates approved by Meta will appear here.',
                          )
                        : ListView.separated(
                            controller: ctrl,
                            padding: const EdgeInsets.symmetric(
                                horizontal: AppTokens.space4,
                                vertical: AppTokens.space2),
                            itemCount: _templates.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 1),
                            itemBuilder: (_, i) {
                              final t = _templates[i];
                              return ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                    vertical: AppTokens.space1),
                                leading: const CircleAvatar(
                                  radius: 18,
                                  backgroundColor: AppTokens.primary50,
                                  child: Icon(Icons.auto_awesome,
                                      size: 16,
                                      color: AppTokens.primary700),
                                ),
                                title: Text(t.name,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w600)),
                                subtitle: t.bodyText != null
                                    ? Text(t.bodyText!,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontSize: AppTokens.fontSizeXs))
                                    : null,
                                trailing: Text(t.language.toUpperCase(),
                                    style: const TextStyle(
                                        fontSize: AppTokens.fontSizeXs,
                                        color: AppTokens.textMutedLight)),
                                onTap: () => _onPick(t),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }

  Future<void> _onPick(WaTemplate template) async {
    final vars = template.bodyVariables;
    if (vars.isEmpty) {
      // No variables — send directly.
      if (mounted) {
        Navigator.of(context).pop(TemplateSendParams(
          templateName: template.name,
          language: template.language,
          components: const [],
        ));
      }
      return;
    }
    // Prompt user to fill variables.
    final filled = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => _VarDialog(template: template, varKeys: vars),
    );
    if (filled == null || !mounted) return;
    final parameters = vars
        .map((k) => {'type': 'text', 'text': filled[k] ?? ''})
        .toList();
    Navigator.of(context).pop(TemplateSendParams(
      templateName: template.name,
      language: template.language,
      components: [
        {
          'type': 'body',
          'parameters': parameters,
        }
      ],
    ));
  }
}

// ─── Variable fill dialog ────────────────────────────────────────────────────

class _VarDialog extends StatefulWidget {
  final WaTemplate template;
  final List<String> varKeys;
  const _VarDialog({required this.template, required this.varKeys});

  @override
  State<_VarDialog> createState() => _VarDialogState();
}

class _VarDialogState extends State<_VarDialog> {
  late final Map<String, TextEditingController> _ctrls;

  @override
  void initState() {
    super.initState();
    _ctrls = {for (final k in widget.varKeys) k: TextEditingController()};
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.template.name),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.template.bodyText != null) ...[
              Text(widget.template.bodyText!,
                  style: const TextStyle(
                      fontSize: AppTokens.fontSizeSm,
                      color: AppTokens.textSecondaryLight)),
              const SizedBox(height: AppTokens.space4),
            ],
            for (final k in widget.varKeys) ...[
              Text('{{$k}}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: AppTokens.fontSizeSm)),
              const SizedBox(height: 4),
              TextField(
                controller: _ctrls[k],
                decoration: InputDecoration(
                  hintText: 'Value for {{$k}}',
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel')),
        FilledButton(
          onPressed: () {
            final values = {
              for (final k in widget.varKeys) k: _ctrls[k]!.text.trim()
            };
            Navigator.pop(context, values);
          },
          child: const Text('Send'),
        ),
      ],
    );
  }
}

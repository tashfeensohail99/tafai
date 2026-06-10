import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../leads/presentation/lead_detail_screen.dart';
import '../data/whatsapp_providers.dart';
import '../data/whatsapp_repository.dart';
import '../domain/wa_message.dart';
import '../domain/wa_thread.dart';
import 'template_picker_sheet.dart';

class ThreadScreen extends ConsumerStatefulWidget {
  final WhatsappThread thread;
  const ThreadScreen({super.key, required this.thread});

  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  late WhatsappThread _thread;
  bool? _aiEnabled;
  bool _sending = false;
  bool _busyAi = false;
  bool _initialScrollDone = false;

  String get _threadId => widget.thread.id;

  @override
  void initState() {
    super.initState();
    _thread = widget.thread;
    _aiEnabled = widget.thread.aiEnabled;
    // Mark read + pull a fresh thread (window + AI state) — best-effort.
    Future.microtask(() async {
      final repo = ref.read(whatsappRepositoryProvider);
      try {
        await repo.markRead(_threadId);
      } catch (_) {}
      try {
        final fresh = await repo.getThread(_threadId);
        if (mounted) {
          setState(() {
            _thread = fresh;
            _aiEnabled = fresh.aiEnabled ?? _aiEnabled;
          });
        }
      } catch (_) {}
    });
  }

  @override
  void dispose() {
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _jumpToBottom({bool animate = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      final max = _scroll.position.maxScrollExtent;
      if (animate) {
        _scroll.animateTo(max,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      } else {
        _scroll.jumpTo(max);
      }
    });
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final msg = await ref.read(whatsappRepositoryProvider).sendText(_threadId, text);
      ref.read(messagesControllerProvider(_threadId).notifier).append(msg);
      _composer.clear();
      _jumpToBottom(animate: true);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _toggleAi() async {
    setState(() => _busyAi = true);
    try {
      final next = !(_aiEnabled ?? true);
      final res = await ref.read(whatsappRepositoryProvider).aiToggle(_threadId, next);
      setState(() => _aiEnabled = res);
      _toast(res ? 'AI bot turned on' : 'AI bot turned off');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busyAi = false);
    }
  }

  Future<void> _takeOver() async {
    setState(() => _busyAi = true);
    try {
      final res = await ref.read(whatsappRepositoryProvider).takeOver(_threadId);
      setState(() => _aiEnabled = res);
      _toast('You took over — AI is off and the lead is yours');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busyAi = false);
    }
  }

  Future<void> _sendTemplate() async {
    final params = await showTemplatePicker(context, ref);
    if (params == null || !mounted) return;
    setState(() => _sending = true);
    try {
      final msg = await ref.read(whatsappRepositoryProvider).sendTemplate(
            _threadId,
            templateName: params.templateName,
            language: params.language,
            components: params.components,
          );
      ref.read(messagesControllerProvider(_threadId).notifier).append(msg);
      _jumpToBottom(animate: true);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendMedia() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.media,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty || !mounted) return;
    final picked = result.files.first;
    final path = picked.path;
    if (path == null) {
      _toast('Could not access file.');
      return;
    }
    setState(() => _sending = true);
    try {
      final msg = await ref.read(whatsappRepositoryProvider).sendMedia(
            _threadId,
            filePath: path,
            fileName: picked.name,
          );
      ref.read(messagesControllerProvider(_threadId).notifier).append(msg);
      _jumpToBottom(animate: true);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _openLead() {
    final id = _thread.leadId;
    if (id == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => LeadDetailScreen(leadId: id)),
    );
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(messagesControllerProvider(_threadId));
    final aiOn = _aiEnabled ?? true;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_thread.displayName,
                maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(
              _thread.phone,
              style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w400, color: Colors.white70),
            ),
          ],
        ),
        actions: [
          if (_busyAi)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: AppTokens.space4),
              child: Center(
                child: SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white)),
              ),
            )
          else
            PopupMenuButton<String>(
              onSelected: (v) {
                switch (v) {
                  case 'ai':
                    _toggleAi();
                    break;
                  case 'takeover':
                    _takeOver();
                    break;
                  case 'lead':
                    _openLead();
                    break;
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'ai',
                  child: Row(
                    children: [
                      Icon(aiOn ? Icons.smart_toy_outlined : Icons.smart_toy,
                          size: 20),
                      const SizedBox(width: AppTokens.space3),
                      Text(aiOn ? 'Turn AI bot off' : 'Turn AI bot on'),
                    ],
                  ),
                ),
                const PopupMenuItem(
                  value: 'takeover',
                  child: Row(
                    children: [
                      Icon(Icons.pan_tool_outlined, size: 20),
                      SizedBox(width: AppTokens.space3),
                      Text('Take over (stop bot)'),
                    ],
                  ),
                ),
                if (_thread.leadId != null)
                  const PopupMenuItem(
                    value: 'lead',
                    child: Row(
                      children: [
                        Icon(Icons.person_outline, size: 20),
                        SizedBox(width: AppTokens.space3),
                        Text('Open lead'),
                      ],
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          if (!aiOn)
            Container(
              width: double.infinity,
              color: AppTokens.statusWarningBg,
              padding: const EdgeInsets.symmetric(
                  horizontal: AppTokens.space4, vertical: AppTokens.space2),
              child: const Text('AI bot is off for this chat — you are replying manually.',
                  style: TextStyle(
                      color: AppTokens.statusWarning,
                      fontSize: AppTokens.fontSizeXs,
                      fontWeight: FontWeight.w600)),
            ),
          Expanded(child: _messagesView(messages)),
          _composerBar(),
        ],
      ),
    );
  }

  Widget _messagesView(MessagesState state) {
    if (state.loading) return const LoadingView();
    if (state.error != null) {
      return ErrorView(
        error: state.error!,
        onRetry: () =>
            ref.read(messagesControllerProvider(_threadId).notifier).refresh(),
      );
    }
    if (state.items.isEmpty) {
      return const EmptyView(
        icon: Icons.chat_bubble_outline,
        title: 'No messages yet',
        message: 'Say hello to start the conversation.',
      );
    }
    if (!_initialScrollDone) {
      _initialScrollDone = true;
      _jumpToBottom();
    }
    final hasHeader = state.hasOlder;
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space3),
      itemCount: state.items.length + (hasHeader ? 1 : 0),
      itemBuilder: (context, i) {
        if (hasHeader && i == 0) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space2),
              child: state.loadingOlder
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : TextButton(
                      onPressed: () => ref
                          .read(messagesControllerProvider(_threadId).notifier)
                          .loadOlder(),
                      child: const Text('Load older messages'),
                    ),
            ),
          );
        }
        final msg = state.items[hasHeader ? i - 1 : i];
        return _Bubble(message: msg);
      },
    );
  }

  Widget _composerBar() {
    final windowOpen = _thread.windowOpen;
    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppTokens.borderLight)),
        ),
        padding: const EdgeInsets.fromLTRB(
            AppTokens.space2, AppTokens.space2, AppTokens.space2, AppTokens.space2),
        child: windowOpen
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  // Media attach (only inside window)
                  IconButton(
                    tooltip: 'Send media',
                    icon: const Icon(Icons.attach_file, size: 22),
                    onPressed: _sending ? null : _sendMedia,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      minLines: 1,
                      maxLines: 4,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'Type a message',
                        isDense: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.all(AppTokens.radiusXl),
                        ),
                      ),
                    ),
                  ),
                  // Template button (always available)
                  IconButton(
                    tooltip: 'Send template',
                    icon: const Icon(Icons.auto_awesome_outlined, size: 22),
                    onPressed: _sending ? null : _sendTemplate,
                  ),
                  // Send text button
                  _sending
                      ? const Padding(
                          padding: EdgeInsets.all(AppTokens.space2),
                          child: SizedBox(
                              height: 24,
                              width: 24,
                              child: CircularProgressIndicator(strokeWidth: 2)),
                        )
                      : IconButton.filled(
                          onPressed: _send,
                          icon: const Icon(Icons.send),
                        ),
                ],
              )
            : Row(
                children: [
                  const Icon(Icons.lock_clock,
                      size: 18, color: AppTokens.textMutedLight),
                  const SizedBox(width: AppTokens.space2),
                  Expanded(
                    child: Text(
                      'Outside the 24-hour window — send a template to reopen the conversation.',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: AppTokens.textMutedLight),
                    ),
                  ),
                  const SizedBox(width: AppTokens.space2),
                  // Template is the ONLY option outside the window
                  _sending
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : FilledButton.icon(
                          onPressed: _sendTemplate,
                          icon: const Icon(Icons.auto_awesome, size: 16),
                          label: const Text('Template'),
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(
                                horizontal: AppTokens.space3,
                                vertical: AppTokens.space2),
                            textStyle: const TextStyle(fontSize: 13),
                          ),
                        ),
                ],
              ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final ChatMessage message;
  const _Bubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final out = message.isOutbound;
    final bg = out ? AppTokens.primary600 : AppTokens.surfaceSubtleLight;
    final fg = out ? Colors.white : AppTokens.textPrimaryLight;
    return Align(
      alignment: out ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.symmetric(
            horizontal: AppTokens.space4, vertical: 3),
        padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space3, vertical: AppTokens.space2),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(12),
            topRight: const Radius.circular(12),
            bottomLeft: Radius.circular(out ? 12 : 2),
            bottomRight: Radius.circular(out ? 2 : 12),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _content(fg),
            const SizedBox(height: 2),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  formatTime(message.createdAt),
                  style: TextStyle(
                      fontSize: 10,
                      color: out ? Colors.white70 : AppTokens.textMutedLight),
                ),
                if (out) ...[
                  const SizedBox(width: 4),
                  _tick(),
                ],
              ],
            ),
            if (message.isFailed && message.errorTitle != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(message.errorTitle!,
                    style: const TextStyle(
                        color: AppTokens.statusDanger, fontSize: 10)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _content(Color fg) {
    if (message.isMedia) {
      final icon = switch (message.type) {
        'IMAGE' => Icons.photo_outlined,
        'VIDEO' => Icons.videocam_outlined,
        'AUDIO' => Icons.mic_outlined,
        'DOCUMENT' => Icons.description_outlined,
        _ => Icons.attachment,
      };
      final label = switch (message.type) {
        'IMAGE' => 'Photo',
        'VIDEO' => 'Video',
        'AUDIO' => 'Voice message',
        'DOCUMENT' => 'Document',
        _ => 'Attachment',
      };
      return Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: fg),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              message.body?.isNotEmpty == true ? message.body! : label,
              style: TextStyle(color: fg, fontSize: AppTokens.fontSizeSm),
            ),
          ),
        ],
      );
    }
    final text = message.body?.isNotEmpty == true
        ? message.body!
        : (message.type == 'TEMPLATE' ? '[template message]' : '…');
    return Text(text, style: TextStyle(color: fg, fontSize: AppTokens.fontSizeSm));
  }

  Widget _tick() {
    final (icon, color) = switch (message.status) {
      'READ' => (Icons.done_all, const Color(0xFF93C5FD)),
      'DELIVERED' => (Icons.done_all, Colors.white70),
      'SENT' => (Icons.done, Colors.white70),
      'FAILED' => (Icons.error_outline, const Color(0xFFFCA5A5)),
      _ => (Icons.schedule, Colors.white70),
    };
    return Icon(icon, size: 13, color: color);
  }
}

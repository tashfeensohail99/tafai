import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../calls/application/call_controller.dart';
import '../../leads/presentation/lead_detail_screen.dart';
import '../data/whatsapp_providers.dart';
import '../data/whatsapp_repository.dart';
import '../domain/wa_message.dart';
import '../domain/wa_thread.dart';
import 'media_preview_screen.dart';
import 'quick_reply_sheet.dart';
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

  // Voice note recording (WhatsApp-style).
  AudioRecorder? _voiceRec;
  DateTime? _voiceStart;
  Timer? _voiceTick;

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
    _voiceTick?.cancel();
    final rec = _voiceRec;
    if (rec != null) {
      rec.stop().then((_) => rec.dispose()).catchError((_) {});
    }
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

    // WhatsApp-style: show a preview + optional caption and let the user
    // confirm before anything is sent. Returns null if they back out.
    const imageExts = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'};
    final ext = (picked.extension ?? '').toLowerCase();
    final caption = await Navigator.of(context).push<String?>(
      MaterialPageRoute(
        builder: (_) => MediaPreviewScreen(
          filePath: path,
          fileName: picked.name,
          isImage: imageExts.contains(ext),
          contactName: _thread.displayName,
        ),
      ),
    );
    if (caption == null || !mounted) return; // cancelled in the preview

    setState(() => _sending = true);
    try {
      final msg = await ref.read(whatsappRepositoryProvider).sendMedia(
            _threadId,
            filePath: path,
            fileName: picked.name,
            caption: caption.isEmpty ? null : caption,
          );
      ref.read(messagesControllerProvider(_threadId).notifier).append(msg);
      _jumpToBottom(animate: true);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  // ── Voice notes ────────────────────────────────────────────────────────────

  Future<void> _startVoiceNote() async {
    if (_sending || _voiceRec != null) return;
    try {
      final rec = AudioRecorder();
      if (!await rec.hasPermission()) {
        rec.dispose();
        _toast('Microphone permission is needed for voice notes.');
        return;
      }
      final dir = await getTemporaryDirectory();
      final path =
          '${dir.path}/voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
      await rec.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, numChannels: 1),
        path: path,
      );
      setState(() {
        _voiceRec = rec;
        _voiceStart = DateTime.now();
      });
      _voiceTick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } catch (e) {
      _toast('Could not start recording.');
      _voiceRec = null;
    }
  }

  Future<void> _cancelVoiceNote() async {
    _voiceTick?.cancel();
    final rec = _voiceRec;
    setState(() {
      _voiceRec = null;
      _voiceStart = null;
    });
    if (rec == null) return;
    try {
      final path = await rec.stop();
      rec.dispose();
      if (path != null) {
        final f = File(path);
        if (await f.exists()) await f.delete();
      }
    } catch (_) {}
  }

  Future<void> _sendVoiceNote() async {
    _voiceTick?.cancel();
    final rec = _voiceRec;
    setState(() {
      _voiceRec = null;
      _voiceStart = null;
    });
    if (rec == null) return;
    String? path;
    try {
      path = await rec.stop();
      rec.dispose();
    } catch (_) {}
    if (path == null || !mounted) return;

    setState(() => _sending = true);
    try {
      final msg = await ref.read(whatsappRepositoryProvider).sendMedia(
            _threadId,
            filePath: path,
            fileName: 'voice-note.m4a',
          );
      ref.read(messagesControllerProvider(_threadId).notifier).append(msg);
      _jumpToBottom(animate: true);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      try {
        final f = File(path);
        if (await f.exists()) await f.delete();
      } catch (_) {}
      if (mounted) setState(() => _sending = false);
    }
  }

  String get _voiceLabel {
    final start = _voiceStart;
    if (start == null) return '0:00';
    final s = DateTime.now().difference(start).inSeconds;
    return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
  }

  /// Pick a saved snippet and insert it into the composer ({{name}} filled
  /// with the customer's first name). Nothing auto-sends.
  Future<void> _insertQuickReply() async {
    final body = await showQuickReplySheet(context);
    if (body == null || body.isEmpty) return;
    final firstName = _thread.displayName.trim().split(RegExp(r'\s+')).first;
    final filled = body.replaceAll('{{name}}', firstName);
    final existing = _composer.text;
    _composer.text = existing.trim().isEmpty ? filled : '$existing $filled';
    _composer.selection =
        TextSelection.collapsed(offset: _composer.text.length);
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

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  /// Place a real in-app WhatsApp voice call to this contact. The global
  /// CallOverlay (mounted above every route) takes over the UI from here.
  void _initiateCall() {
    ref.read(callControllerProvider.notifier).startOutbound(
          threadId: _threadId,
          name: _thread.displayName,
          phone: _thread.phone,
        );
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(messagesControllerProvider(_threadId));
    final aiOn = _aiEnabled ?? true;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // WhatsApp-style: teal header, white icons
    final headerBg = isDark ? AppTokens.waHeaderDark : AppTokens.waTealDark;
    final chatBg = isDark ? AppTokens.waChatBgDark : AppTokens.waChatBg;

    // Override status bar to match WA header
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ));

    return Scaffold(
      backgroundColor: chatBg,
      appBar: AppBar(
        backgroundColor: headerBg,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.of(context).pop(),
        ),
        titleSpacing: 0,
        title: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: Colors.white.withValues(alpha: 0.25),
              child: Text(
                _initials(_thread.displayName),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _thread.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      height: 1.2,
                    ),
                  ),
                  Text(
                    _thread.phone,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w400,
                      color: Colors.white.withValues(alpha: 0.8),
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Call contact',
            icon: const Icon(Icons.call_outlined, color: Colors.white),
            onPressed: _initiateCall,
          ),
          if (_busyAi)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: AppTokens.space4),
              child: Center(
                child: SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
              ),
            )
          else
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert, color: Colors.white),
              onSelected: (v) {
                switch (v) {
                  case 'ai': _toggleAi(); break;
                  case 'takeover': _takeOver(); break;
                  case 'lead': _openLead(); break;
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'ai',
                  child: Row(children: [
                    Icon(aiOn ? Icons.smart_toy_outlined : Icons.smart_toy, size: 20),
                    const SizedBox(width: AppTokens.space3),
                    Text(aiOn ? 'Turn AI bot off' : 'Turn AI bot on'),
                  ]),
                ),
                const PopupMenuItem(
                  value: 'takeover',
                  child: Row(children: [
                    Icon(Icons.pan_tool_outlined, size: 20),
                    SizedBox(width: AppTokens.space3),
                    Text('Take over (stop bot)'),
                  ]),
                ),
                if (_thread.leadId != null)
                  const PopupMenuItem(
                    value: 'lead',
                    child: Row(children: [
                      Icon(Icons.person_outline, size: 20),
                      SizedBox(width: AppTokens.space3),
                      Text('Open lead'),
                    ]),
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final barBg = isDark ? AppTokens.waHeaderDark : Colors.white;
    return SafeArea(
      top: false,
      child: Container(
        decoration: BoxDecoration(
          color: barBg,
          border: Border(
            top: BorderSide(
              color: isDark ? AppTokens.borderDark : AppTokens.borderLight,
            ),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(
            AppTokens.space2, AppTokens.space2, AppTokens.space2, AppTokens.space2),
        child: windowOpen
            ? (_voiceRec != null
                ? Row(
                    children: [
                      IconButton(
                        tooltip: 'Discard',
                        icon: const Icon(Icons.delete_outline,
                            color: AppTokens.statusDanger),
                        onPressed: _cancelVoiceNote,
                      ),
                      const Icon(Icons.fiber_manual_record,
                          size: 14, color: AppTokens.statusDanger),
                      const SizedBox(width: AppTokens.space2),
                      Text('Recording $_voiceLabel',
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      const Spacer(),
                      IconButton.filled(
                        tooltip: 'Send voice note',
                        onPressed: _sendVoiceNote,
                        icon: const Icon(Icons.send),
                      ),
                    ],
                  )
                : Row(
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
                  // Quick replies — saved snippets inserted into the box
                  IconButton(
                    tooltip: 'Quick reply',
                    icon: const Icon(Icons.bolt_outlined, size: 22),
                    onPressed: _sending ? null : _insertQuickReply,
                  ),
                  // Voice note (inside window)
                  IconButton(
                    tooltip: 'Voice note',
                    icon: const Icon(Icons.mic_none, size: 22),
                    onPressed: _sending ? null : _startVoiceNote,
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
              ))
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
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final bg = out
        ? (isDark ? AppTokens.waBubbleOutDark : AppTokens.waBubbleOut)
        : (isDark ? AppTokens.waBubbleInDark : AppTokens.waBubbleIn);
    final fg = out
        ? (isDark ? AppTokens.waBubbleOutTextDark : AppTokens.waBubbleOutText)
        : (isDark ? AppTokens.waBubbleInTextDark : AppTokens.waBubbleInText);
    final timeColor = out
        ? (isDark ? const Color(0xFF8FA89E) : const Color(0xFF6B8068))
        : (isDark ? AppTokens.textMutedDark : AppTokens.textMutedLight);

    return Align(
      alignment: out ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.symmetric(
            horizontal: AppTokens.space3, vertical: 2),
        padding: const EdgeInsets.fromLTRB(10, 7, 10, 5),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(10),
            topRight: const Radius.circular(10),
            bottomLeft: Radius.circular(out ? 10 : 2),
            bottomRight: Radius.circular(out ? 2 : 10),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.15 : 0.06),
              blurRadius: 2,
              offset: const Offset(0, 1),
            ),
          ],
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
                  style: TextStyle(fontSize: 10, color: timeColor),
                ),
                if (out) ...[
                  const SizedBox(width: 3),
                  _tick(isDark),
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
              style: TextStyle(color: fg, fontSize: AppTokens.fontSizeSm, height: 1.35),
            ),
          ),
        ],
      );
    }
    final text = message.body?.isNotEmpty == true
        ? message.body!
        : (message.type == 'TEMPLATE' ? '[template message]' : '…');
    return Text(text,
        style: TextStyle(color: fg, fontSize: AppTokens.fontSizeSm, height: 1.35));
  }

  Widget _tick(bool isDark) {
    final (icon, color) = switch (message.status) {
      'READ' => (Icons.done_all, const Color(0xFF53BDEB)),
      'DELIVERED' => (Icons.done_all, const Color(0xFF8FA89E)),
      'SENT' => (Icons.done, const Color(0xFF8FA89E)),
      'FAILED' => (Icons.error_outline, AppTokens.statusDanger),
      _ => (Icons.schedule, const Color(0xFF8FA89E)),
    };
    return Icon(icon, size: 13, color: color);
  }
}

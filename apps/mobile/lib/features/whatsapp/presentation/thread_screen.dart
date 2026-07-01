import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:video_player/video_player.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../calls/application/call_controller.dart';
import '../../leads/presentation/lead_detail_screen.dart';
import '../data/whatsapp_providers.dart';
import '../data/whatsapp_repository.dart';
import '../domain/wa_message.dart';
import '../domain/wa_thread.dart';
import 'media_preview_screen.dart';
import 'quick_reply_sheet.dart';
import 'video_player_screen.dart';
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

  // Live status ticks (sent → delivered → read) + new inbound, while the
  // thread is open. The thread has no socket, so we quietly poll the tail.
  Timer? _statusPoll;

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
    // Poll the tail every 5s so outgoing ticks advance and new inbound
    // messages appear without a manual pull-to-refresh.
    _statusPoll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || _sending) return;
      ref.read(messagesControllerProvider(_threadId).notifier).syncTail();
    });
  }

  @override
  void dispose() {
    _statusPoll?.cancel();
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

  /// The message currently being replied to (swipe a bubble to set it). When
  /// set, a quote bar shows above the composer and the next send links to it.
  ChatMessage? _replyingTo;

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || _sending) return;
    HapticFeedback.lightImpact();
    final replyTo = _replyingTo;
    setState(() => _sending = true);
    try {
      final msg = await ref.read(whatsappRepositoryProvider).sendText(
            _threadId,
            text,
            contextWaMessageId: replyTo?.waMessageId,
          );
      ref.read(messagesControllerProvider(_threadId).notifier).append(msg);
      _composer.clear();
      if (mounted) setState(() => _replyingTo = null);
      _jumpToBottom(animate: true);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// "Replying to …" bar shown above the composer when a reply target is set.
  Widget _replyPreviewBar(bool isDark) {
    final r = _replyingTo;
    if (r == null) return const SizedBox.shrink();
    final who = r.isOutbound ? 'You' : _thread.displayName;
    final preview = (r.body?.trim().isNotEmpty ?? false)
        ? r.body!.trim()
        : (r.isMedia ? '[media]' : '[message]');
    return Container(
      margin: const EdgeInsets.fromLTRB(
          AppTokens.space2, 0, AppTokens.space2, AppTokens.space2),
      padding: const EdgeInsets.symmetric(
          horizontal: AppTokens.space3, vertical: AppTokens.space2),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF2A3942) : const Color(0xFFEFF2F5),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: const Border(
          left: BorderSide(color: AppTokens.brandNavy, width: 3),
        ),
      ),
      child: Row(
        children: [
          const Icon(Icons.reply, size: 16, color: AppTokens.brandNavy),
          const SizedBox(width: AppTokens.space2),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(who,
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppTokens.brandNavy)),
                Text(preview,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5)),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancel reply',
            icon: const Icon(Icons.close, size: 18),
            visualDensity: VisualDensity.compact,
            onPressed: () => setState(() => _replyingTo = null),
          ),
        ],
      ),
    );
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

  // ── Archive / Block ──────────────────────────────────────────────────────────

  Future<void> _archive() async {
    setState(() => _busyAi = true);
    try {
      await ref.read(whatsappRepositoryProvider).archiveThread(_threadId);
      if (!mounted) return;
      _toast('Conversation archived');
      Navigator.of(context).pop(); // back to inbox (it refreshes on return)
    } on AppError catch (e) {
      _toast(messageForError(e));
      if (mounted) setState(() => _busyAi = false);
    }
  }

  Future<void> _unarchive() async {
    setState(() => _busyAi = true);
    try {
      await ref.read(whatsappRepositoryProvider).unarchiveThread(_threadId);
      if (!mounted) return;
      setState(() => _thread = _thread.copyWith(status: 'OPEN'));
      _toast('Conversation unarchived');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busyAi = false);
    }
  }

  Future<void> _block() async {
    final reason = await _confirmBlock();
    if (reason == null || !mounted) return; // cancelled
    setState(() => _busyAi = true);
    try {
      await ref
          .read(whatsappRepositoryProvider)
          .blockContact(_threadId, reason: reason.isEmpty ? null : reason);
      if (!mounted) return;
      // Block also archives the thread server-side; leave the chat.
      _toast('Contact blocked');
      Navigator.of(context).pop();
    } on AppError catch (e) {
      _toast(messageForError(e));
      if (mounted) setState(() => _busyAi = false);
    }
  }

  Future<void> _unblock() async {
    setState(() => _busyAi = true);
    try {
      await ref.read(whatsappRepositoryProvider).unblockContact(_threadId);
      if (!mounted) return;
      // Reflect locally: clear blockedAt on whichever party exists.
      setState(() => _thread = _thread.copyWith(
            lead: _thread.lead?.unblocked(),
            client: _thread.client?.unblocked(),
          ));
      _toast('Contact unblocked');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busyAi = false);
    }
  }

  /// Confirm dialog with an optional reason. Returns the reason string (may be
  /// empty) on confirm, or null on cancel.
  Future<String?> _confirmBlock() async {
    final reasonCtrl = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Block contact?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Block ${_thread.displayName}? This archives the conversation and '
              'flags the contact across the CRM.',
            ),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: reasonCtrl,
              autofocus: true,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Reason (optional)',
                hintText: 'e.g. spam, abusive',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: AppTokens.statusDanger),
            onPressed: () => Navigator.of(ctx).pop(reasonCtrl.text.trim()),
            child: const Text('Block'),
          ),
        ],
      ),
    );
    reasonCtrl.dispose();
    return result;
  }

  Future<void> _sendTemplate() async {
    final params =
        await showTemplatePicker(context, ref, channelId: _thread.channelId);
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
      // Record Opus-in-Ogg directly — the exact format WhatsApp voice notes
      // require. The web portal records Opus and delivers fine; AAC (m4a)
      // re-encoded server-side produced a stream Meta refused (131053). 48 kHz
      // is Opus's native rate.
      final path =
          '${dir.path}/voice-${DateTime.now().millisecondsSinceEpoch}.ogg';
      await rec.start(
        const RecordConfig(
          encoder: AudioEncoder.opus,
          numChannels: 1,
          sampleRate: 48000,
        ),
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
            fileName: 'voice-note.ogg',
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

  /// Ask the customer to allow WhatsApp calls (Meta requires opt-in before a
  /// business can call). Once they tap "Allow", the rep can place the call.
  Future<void> _requestCallPermission() async {
    try {
      await ref.read(callControllerProvider.notifier).requestPermission(_threadId);
      _toast('Call-permission request sent. Once they tap Allow, you can call them.');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } catch (_) {
      _toast('Could not send the call-permission request.');
    }
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
          // Single context-aware control: until the customer grants WhatsApp-
          // call permission this requests it; once granted it becomes the real
          // Call button. (Replaces the old always-on call icon + the overflow
          // "Request call permission" item.)
          Builder(builder: (_) {
            if (_thread.canCall) {
              return IconButton(
                tooltip: 'Call contact',
                icon: const Icon(Icons.call, color: Colors.white),
                onPressed: _initiateCall,
              );
            }
            if (_thread.callPermissionStatus == 'PENDING') {
              return IconButton(
                tooltip: 'Call permission requested — waiting for the customer to allow',
                icon: const Icon(Icons.schedule, color: Colors.white),
                onPressed: () => _toast(
                    'Waiting for the customer to tap Allow on the call-permission request.'),
              );
            }
            return IconButton(
              tooltip: 'Request call permission',
              icon: const Icon(Icons.add_call, color: Colors.white),
              onPressed: _requestCallPermission,
            );
          }),
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
                  case 'archive': _archive(); break;
                  case 'unarchive': _unarchive(); break;
                  case 'block': _block(); break;
                  case 'unblock': _unblock(); break;
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
                const PopupMenuDivider(),
                if (_thread.isArchived)
                  const PopupMenuItem(
                    value: 'unarchive',
                    child: Row(children: [
                      Icon(Icons.unarchive_outlined, size: 20),
                      SizedBox(width: AppTokens.space3),
                      Text('Unarchive'),
                    ]),
                  )
                else
                  const PopupMenuItem(
                    value: 'archive',
                    child: Row(children: [
                      Icon(Icons.archive_outlined, size: 20),
                      SizedBox(width: AppTokens.space3),
                      Text('Archive'),
                    ]),
                  ),
                if (_thread.isBlocked)
                  const PopupMenuItem(
                    value: 'unblock',
                    child: Row(children: [
                      Icon(Icons.lock_open_outlined,
                          size: 20, color: AppTokens.statusDanger),
                      SizedBox(width: AppTokens.space3),
                      Text('Unblock contact',
                          style: TextStyle(color: AppTokens.statusDanger)),
                    ]),
                  )
                else
                  const PopupMenuItem(
                    value: 'block',
                    child: Row(children: [
                      Icon(Icons.block,
                          size: 20, color: AppTokens.statusDanger),
                      SizedBox(width: AppTokens.space3),
                      Text('Block contact',
                          style: TextStyle(color: AppTokens.statusDanger)),
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
        final di = hasHeader ? i - 1 : i;
        final msg = state.items[di];
        // WhatsApp-style day separator: a centered date chip is inserted above
        // this bubble whenever it starts a new calendar day vs the previous one.
        final prevMsg = di > 0 ? state.items[di - 1] : null;
        final showDay = prevMsg == null ||
            chatDayKey(prevMsg.createdAt) != chatDayKey(msg.createdAt);
        // Resolve the quoted message (if this is a reply) from the loaded list.
        ChatMessage? quoted;
        if (msg.repliedToWaMessageId != null) {
          for (final m in state.items) {
            if (m.waMessageId != null &&
                m.waMessageId == msg.repliedToWaMessageId) {
              quoted = m;
              break;
            }
          }
        }
        // Swipe a bubble left→right to reply to it (bounces back, like WhatsApp).
        final bubble = Dismissible(
          key: ValueKey('swipe-${msg.id}'),
          direction: DismissDirection.startToEnd,
          dismissThresholds: const {DismissDirection.startToEnd: 0.28},
          confirmDismiss: (_) async {
            HapticFeedback.lightImpact();
            setState(() => _replyingTo = msg);
            return false;
          },
          background: const Padding(
            padding: EdgeInsets.only(left: 28),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Icon(Icons.reply, color: AppTokens.brandNavy),
            ),
          ),
          child: _Bubble(message: msg, threadId: _threadId, quoted: quoted),
        );
        if (!showDay) return bubble;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _DaySeparator(label: chatDaySeparator(msg.createdAt)),
            bubble,
          ],
        );
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_replyingTo != null) _replyPreviewBar(isDark),
            windowOpen
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
                    tooltip: 'Attach',
                    icon: const Icon(Icons.add, size: 24),
                    onPressed: _sending ? null : _sendMedia,
                  ),
                  // Rounded input pill: text field + quick-reply (⚡) and
                  // template (✨) tucked inside on the right, WhatsApp-style.
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: isDark
                            ? const Color(0xFF2A3942)
                            : const Color(0xFFEFF2F5),
                        borderRadius: const BorderRadius.all(AppTokens.radiusXl),
                      ),
                      padding: const EdgeInsets.only(left: 14, right: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _composer,
                              minLines: 1,
                              maxLines: 4,
                              textCapitalization: TextCapitalization.sentences,
                              decoration: const InputDecoration(
                                hintText: 'Type a message',
                                isDense: true,
                                border: InputBorder.none,
                                enabledBorder: InputBorder.none,
                                focusedBorder: InputBorder.none,
                                contentPadding:
                                    EdgeInsets.symmetric(vertical: 10),
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Quick reply',
                            icon: const Icon(Icons.bolt_outlined, size: 21),
                            visualDensity: VisualDensity.compact,
                            constraints: const BoxConstraints(
                                minWidth: 34, minHeight: 40),
                            padding: EdgeInsets.zero,
                            color: AppTokens.textMutedLight,
                            onPressed: _sending ? null : _insertQuickReply,
                          ),
                          IconButton(
                            tooltip: 'Send template',
                            icon: const Icon(Icons.auto_awesome_outlined,
                                size: 21),
                            visualDensity: VisualDensity.compact,
                            constraints: const BoxConstraints(
                                minWidth: 34, minHeight: 40),
                            padding: EdgeInsets.zero,
                            color: AppTokens.textMutedLight,
                            onPressed: _sending ? null : _sendTemplate,
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTokens.space2),
                  // One round button: mic when empty, send once you type —
                  // exactly like real WhatsApp.
                  _sending
                      ? const Padding(
                          padding: EdgeInsets.all(AppTokens.space2),
                          child: SizedBox(
                              height: 24,
                              width: 24,
                              child: CircularProgressIndicator(strokeWidth: 2)),
                        )
                      : ValueListenableBuilder<TextEditingValue>(
                          valueListenable: _composer,
                          builder: (_, value, __) {
                            final hasText = value.text.trim().isNotEmpty;
                            return IconButton.filled(
                              tooltip: hasText ? 'Send' : 'Voice note',
                              onPressed: hasText ? _send : _startVoiceNote,
                              icon: Icon(hasText ? Icons.send : Icons.mic_none),
                            );
                          },
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
          ],
        ),
      ),
    );
  }
}

/// Centered date chip shown between message groups in the chat thread, like
/// WhatsApp (Today / Yesterday / weekday / date — see chatDaySeparator).
class _DaySeparator extends StatelessWidget {
  const _DaySeparator({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: isDark ? AppTokens.waHeaderDark : Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: isDark ? AppTokens.borderDark : AppTokens.borderLight,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: isDark ? AppTokens.textMutedDark : AppTokens.textMutedLight,
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final ChatMessage message;
  final String threadId;
  final ChatMessage? quoted;
  const _Bubble({required this.message, required this.threadId, this.quoted});

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
            if (quoted != null) _quotedBlock(quoted!, out, fg),
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

  /// The small quoted-message block rendered above a reply's body.
  Widget _quotedBlock(ChatMessage q, bool out, Color fg) {
    final who = q.isOutbound ? 'You' : 'Them';
    final preview = (q.body?.trim().isNotEmpty ?? false)
        ? q.body!.trim()
        : (q.isMedia ? '[media]' : '[message]');
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.fromLTRB(8, 5, 8, 5),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: out ? 0.06 : 0.04),
        borderRadius: const BorderRadius.all(Radius.circular(6)),
        border: const Border(
          left: BorderSide(color: AppTokens.brandNavy, width: 3),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(who,
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppTokens.brandNavy)),
          Text(preview,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: fg.withValues(alpha: 0.85))),
        ],
      ),
    );
  }

  Widget _content(Color fg) {
    if (message.isMedia) {
      return _MediaContent(threadId: threadId, message: message, fg: fg);
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

/// Renders a message attachment. Inbound images show inline (tap → full view in
/// the browser); video / document / audio show a tappable chip that opens the
/// file in the browser. The bytes live behind a short-lived signed URL fetched
/// from the backend — the app's bearer token can't be sent to storage or the
/// browser, so a self-authorizing URL is required.
class _MediaContent extends ConsumerStatefulWidget {
  final String threadId;
  final ChatMessage message;
  final Color fg;
  const _MediaContent({
    required this.threadId,
    required this.message,
    required this.fg,
  });

  @override
  ConsumerState<_MediaContent> createState() => _MediaContentState();
}

/// Session cache of signed media URLs by message id, so scrolling the thread
/// doesn't refetch a fresh URL for every image each time it scrolls back in.
/// (The image bytes are also disk-cached by CachedNetworkImage via cacheKey.)
final Map<String, String> _mediaUrlCache = {};

class _MediaContentState extends ConsumerState<_MediaContent> {
  String? _url;
  bool _loading = false;

  // Inline voice/audio playback via video_player (ExoPlayer) — reliable on the
  // phones where the device browser mangled / wouldn't play Opus-Ogg voice
  // notes. Lazy: the controller is built on the first play tap, and works for
  // inbound voice AND the rep's own outbound voice (both resolve a signed URL).
  VideoPlayerController? _audio;
  bool _audioReady = false;
  bool _audioLoading = false;

  bool get _isImage =>
      widget.message.type == 'IMAGE' || widget.message.type == 'STICKER';

  bool get _isAudio =>
      widget.message.type == 'AUDIO' || widget.message.type == 'VOICE';

  @override
  void initState() {
    super.initState();
    if (_isImage) _fetchUrl();
  }

  Future<String?> _fetchUrl() async {
    if (_url != null) return _url;
    final cached = _mediaUrlCache[widget.message.id];
    if (cached != null) {
      if (mounted) setState(() => _url = cached);
      return cached;
    }
    if (mounted) setState(() => _loading = true);
    try {
      final url = await ref
          .read(whatsappRepositoryProvider)
          .mediaSignedUrl(widget.threadId, widget.message.id);
      _mediaUrlCache[widget.message.id] = url;
      if (mounted) setState(() => _url = url);
      return url;
    } catch (_) {
      return null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open() async {
    final url = _url ?? await _fetchUrl();
    if (url == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not load the attachment.')),
        );
      }
      return;
    }
    if (!mounted) return;
    // Videos play in-app (WhatsApp-style); everything else opens in the browser.
    if (widget.message.type == 'VIDEO') {
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => VideoPlayerScreen(url: url)),
      );
    } else {
      await openExternalUrl(url);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.message;
    final caption = (m.body?.isNotEmpty ?? false) ? m.body : null;

    if (_isImage) {
      return GestureDetector(
        onTap: _open,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: _url != null
                  ? CachedNetworkImage(
                      imageUrl: _url!,
                      cacheKey: m.id,
                      width: 230,
                      fit: BoxFit.cover,
                      errorWidget: (_, __, ___) => _box(
                          Icons.broken_image_outlined, 'Photo unavailable'),
                      placeholder: (_, __) =>
                          _box(Icons.photo_outlined, 'Loading…'),
                    )
                  : _box(Icons.photo_outlined, _loading ? 'Loading…' : 'Photo'),
            ),
            if (caption != null) ...[
              const SizedBox(height: 4),
              Text(caption,
                  style: TextStyle(
                      color: widget.fg,
                      fontSize: AppTokens.fontSizeSm,
                      height: 1.35)),
            ],
          ],
        ),
      );
    }

    if (m.type == 'VIDEO') {
      return GestureDetector(
        onTap: _open,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Container(
                width: 230,
                height: 150,
                color: Colors.black.withValues(alpha: 0.12),
                alignment: Alignment.center,
                child: _loading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.play_circle_fill,
                        size: 54, color: Colors.white),
              ),
            ),
            if (caption != null) ...[
              const SizedBox(height: 4),
              Text(caption,
                  style: TextStyle(
                      color: widget.fg,
                      fontSize: AppTokens.fontSizeSm,
                      height: 1.35)),
            ],
          ],
        ),
      );
    }

    // Voice / audio: inline player (play/pause + seek bar + duration), like
    // WhatsApp — instead of bouncing to the browser (which couldn't reliably
    // play Opus-Ogg on these phones). Works for inbound AND the rep's own sent
    // voice notes.
    if (_isAudio) {
      final c = _audio;
      final dur = c?.value.duration ?? Duration.zero;
      final pos = c?.value.position ?? Duration.zero;
      final playing = c?.value.isPlaying ?? false;
      final maxMs = dur.inMilliseconds > 0 ? dur.inMilliseconds.toDouble() : 1.0;
      final posMs = dur.inMilliseconds > 0
          ? pos.inMilliseconds.clamp(0, dur.inMilliseconds).toDouble()
          : 0.0;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 234,
            child: Row(
              children: [
                GestureDetector(
                  onTap: _toggleAudio,
                  child: _audioLoading
                      ? const SizedBox(
                          width: 36,
                          height: 36,
                          child: Padding(
                            padding: EdgeInsets.all(8),
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: widget.fg.withValues(alpha: 0.15),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(playing ? Icons.pause : Icons.play_arrow,
                              color: widget.fg, size: 22),
                        ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        height: 20,
                        child: SliderTheme(
                          data: SliderThemeData(
                            trackHeight: 2.5,
                            thumbShape: const RoundSliderThumbShape(
                                enabledThumbRadius: 6),
                            overlayShape: const RoundSliderOverlayShape(
                                overlayRadius: 12),
                            activeTrackColor: widget.fg,
                            inactiveTrackColor: widget.fg.withValues(alpha: 0.3),
                            thumbColor: widget.fg,
                          ),
                          child: Slider(
                            value: _audioReady ? posMs : 0,
                            max: _audioReady ? maxMs : 1,
                            onChanged: _audioReady
                                ? (v) =>
                                    c?.seekTo(Duration(milliseconds: v.round()))
                                : null,
                          ),
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Icon(Icons.mic,
                              size: 13, color: widget.fg.withValues(alpha: 0.7)),
                          Text(
                            _audioReady
                                ? '${_fmtDur(pos)} / ${_fmtDur(dur)}'
                                : 'Voice message',
                            style: TextStyle(
                                color: widget.fg.withValues(alpha: 0.75),
                                fontSize: 11),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (caption != null) ...[
            const SizedBox(height: 4),
            Text(caption,
                style: TextStyle(
                    color: widget.fg,
                    fontSize: AppTokens.fontSizeSm,
                    height: 1.35)),
          ],
        ],
      );
    }

    final (icon, label) = switch (m.type) {
      'AUDIO' => (Icons.mic_outlined, 'Voice message'),
      'DOCUMENT' => (Icons.description_outlined, 'Document'),
      _ => (Icons.attachment, 'Attachment'),
    };
    return InkWell(
      onTap: _open,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(icon, size: 18, color: widget.fg),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              caption ?? label,
              style: TextStyle(
                  color: widget.fg,
                  fontSize: AppTokens.fontSizeSm,
                  height: 1.35),
            ),
          ),
          const SizedBox(width: 6),
          Icon(Icons.open_in_new, size: 13, color: widget.fg),
        ],
      ),
    );
  }

  /// Lazily load + play/pause the voice note. Builds the ExoPlayer controller
  /// on first tap (works for inbound and the rep's own outbound voice).
  Future<void> _toggleAudio() async {
    var c = _audio;
    if (c == null) {
      if (_audioLoading) return;
      if (mounted) setState(() => _audioLoading = true);
      final url = await _fetchUrl();
      if (url == null) {
        if (mounted) setState(() => _audioLoading = false);
        return;
      }
      c = VideoPlayerController.networkUrl(Uri.parse(url));
      try {
        await c.initialize();
      } catch (_) {
        await c.dispose();
        if (mounted) {
          setState(() => _audioLoading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not play this voice message.')),
          );
        }
        return;
      }
      c.addListener(_onAudioTick);
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() {
        _audio = c;
        _audioReady = true;
        _audioLoading = false;
      });
    }
    if (c.value.isPlaying) {
      await c.pause();
    } else {
      if (c.value.duration > Duration.zero &&
          c.value.position >= c.value.duration) {
        await c.seekTo(Duration.zero);
      }
      await c.play();
    }
    if (mounted) setState(() {});
  }

  void _onAudioTick() {
    if (mounted) setState(() {});
  }

  String _fmtDur(Duration d) =>
      '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  void dispose() {
    _audio?.removeListener(_onAudioTick);
    _audio?.dispose();
    super.dispose();
  }

  Widget _box(IconData icon, String label) => Container(
        width: 230,
        height: 150,
        color: Colors.black.withValues(alpha: 0.08),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: widget.fg),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(color: widget.fg, fontSize: 11)),
          ],
        ),
      );
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/portal_providers.dart';
import '../data/portal_repository.dart';
import '../domain/portal_models.dart';

/// Messages tab — a chat with the assigned officer. Clones the WhatsApp
/// thread_screen bubble styling (AppTokens.waBubble*). The client's own
/// messages (CLIENT_TO_OFFICER) sit right; officer (OFFICER_TO_CLIENT) and
/// system (SYSTEM_TO_CLIENT) sit left. Fetching the thread marks officer
/// messages read server-side. Body widget (no Scaffold; lives in the shell).
class ClientMessagesTab extends ConsumerStatefulWidget {
  final String? caseId;
  const ClientMessagesTab({super.key, required this.caseId});

  @override
  ConsumerState<ClientMessagesTab> createState() => _ClientMessagesTabState();
}

class _ClientMessagesTabState extends ConsumerState<ClientMessagesTab> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  bool _sending = false;
  bool _initialScrollDone = false;

  @override
  void dispose() {
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _jumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  Future<void> _send() async {
    final caseId = widget.caseId;
    final text = _composer.text.trim();
    if (caseId == null || text.isEmpty || _sending) return;
    HapticFeedback.lightImpact();
    setState(() => _sending = true);
    try {
      await ref
          .read(portalRepositoryProvider)
          .sendMessage(caseId, content: text);
      _composer.clear();
      // Re-fetch the thread so the new message (and any officer reply) shows.
      ref.invalidate(portalMessagesProvider(caseId));
      await ref.read(portalMessagesProvider(caseId).future);
      _jumpToBottom();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final caseId = widget.caseId;
    if (caseId == null) {
      return const EmptyView(
        icon: Icons.chat_bubble_outline,
        title: 'No conversation yet',
        message: 'Messaging opens up once your case is active.',
      );
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final chatBg = isDark ? AppTokens.waChatBgDark : AppTokens.waChatBg;
    final async = ref.watch(portalMessagesProvider(caseId));

    return Container(
      color: chatBg,
      child: Column(
        children: [
          Expanded(
            child: async.when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(
                error: e,
                onRetry: () => ref.invalidate(portalMessagesProvider(caseId)),
              ),
              data: (messages) {
                if (messages.isEmpty) {
                  return const EmptyView(
                    icon: Icons.chat_bubble_outline,
                    title: 'No messages yet',
                    message:
                        'Send a message to your officer — they’ll reply here.',
                  );
                }
                if (!_initialScrollDone) {
                  _initialScrollDone = true;
                  _jumpToBottom();
                }
                return RefreshIndicator(
                  color: AppTokens.brandNavy,
                  onRefresh: () =>
                      ref.refresh(portalMessagesProvider(caseId).future),
                  child: ListView.builder(
                    controller: _scroll,
                    padding:
                        const EdgeInsets.symmetric(vertical: AppTokens.space3),
                    itemCount: messages.length,
                    itemBuilder: (_, i) => _Bubble(message: messages[i]),
                  ),
                );
              },
            ),
          ),
          _composerBar(isDark),
        ],
      ),
    );
  }

  Widget _composerBar(bool isDark) {
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
        padding: const EdgeInsets.all(AppTokens.space2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: isDark
                      ? const Color(0xFF2A3942)
                      : const Color(0xFFEFF2F5),
                  borderRadius: const BorderRadius.all(AppTokens.radiusXl),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: TextField(
                  controller: _composer,
                  minLines: 1,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    hintText: 'Message your officer',
                    isDense: true,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
            ),
            const SizedBox(width: AppTokens.space2),
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
                        tooltip: 'Send',
                        style: IconButton.styleFrom(
                          backgroundColor: AppTokens.brandNavy,
                        ),
                        onPressed: hasText ? _send : null,
                        icon: const Icon(Icons.send),
                      );
                    },
                  ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final PortalMessage message;
  const _Bubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // System messages render centered + muted (like a WhatsApp info banner).
    if (message.isSystem) {
      return Center(
        child: Container(
          constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.82),
          margin: const EdgeInsets.symmetric(
              horizontal: AppTokens.space4, vertical: 4),
          padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space3, vertical: AppTokens.space2),
          decoration: BoxDecoration(
            color: (isDark ? Colors.white : AppTokens.brandNavy)
                .withValues(alpha: 0.06),
            borderRadius: const BorderRadius.all(AppTokens.radiusMd),
          ),
          child: Text(
            message.content,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: AppTokens.fontSizeXs,
              color: isDark ? AppTokens.textMutedDark : AppTokens.textMutedLight,
              height: 1.35,
            ),
          ),
        ),
      );
    }

    final out = message.isFromClient;
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
        constraints:
            BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin:
            const EdgeInsets.symmetric(horizontal: AppTokens.space3, vertical: 2),
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
            // Officer name on inbound bubbles so the client knows who replied.
            if (!out && message.senderName != null &&
                message.senderName!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  message.senderName!,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: fg.withValues(alpha: 0.8),
                  ),
                ),
              ),
            if (message.subject != null &&
                message.subject!.isNotEmpty &&
                message.subject != 'Message from client')
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  message.subject!,
                  style: TextStyle(
                    fontSize: AppTokens.fontSizeSm,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ),
            Text(
              message.content,
              style: TextStyle(
                  color: fg, fontSize: AppTokens.fontSizeSm, height: 1.35),
            ),
            const SizedBox(height: 2),
            Text(
              message.createdAt != null ? formatTime(message.createdAt!) : '',
              style: TextStyle(fontSize: 10, color: timeColor),
            ),
          ],
        ),
      ),
    );
  }
}

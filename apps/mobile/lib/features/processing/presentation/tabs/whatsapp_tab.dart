import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/widgets/app_states.dart';
import '../../../whatsapp/data/whatsapp_repository.dart';
import '../../../whatsapp/domain/wa_thread.dart';
import '../../../whatsapp/presentation/thread_screen.dart';
import '../../data/processing_repository.dart';

/// WhatsApp tab for a case. Resolves the conversation thread via the case
/// endpoint (matches by lead OR client — processing clients are frequently
/// client-linked with no leadId), then reuses the existing Sales [ThreadScreen]
/// (full chat: history, media, voice, templates, ticks) by fetching the thread.
class CaseWhatsAppTab extends ConsumerStatefulWidget {
  final String caseId;
  const CaseWhatsAppTab({super.key, required this.caseId});

  @override
  ConsumerState<CaseWhatsAppTab> createState() => _CaseWhatsAppTabState();
}

class _CaseWhatsAppTabState extends ConsumerState<CaseWhatsAppTab> {
  late Future<WhatsappThread?> _future;

  @override
  void initState() {
    super.initState();
    _future = _resolveThread();
  }

  Future<WhatsappThread?> _resolveThread() async {
    // Resolve the thread pointer from the case endpoint, then hydrate the full
    // thread via the WhatsApp repository so we can reuse ThreadScreen verbatim.
    final caseWa =
        await ref.read(processingRepositoryProvider).caseWhatsApp(widget.caseId);
    final threadId = caseWa.threadId;
    if (threadId == null) return null;
    return ref.read(whatsappRepositoryProvider).getThread(threadId);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<WhatsappThread?>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingView(label: 'Loading WhatsApp…');
        }
        if (snap.hasError) {
          final err = snap.error;
          return _NoConversation(
            message: err is AppError ? messageForError(err) : null,
          );
        }
        final thread = snap.data;
        if (thread == null) return const _NoConversation();
        // ThreadScreen owns its own Scaffold + WhatsApp-style header.
        return ThreadScreen(thread: thread);
      },
    );
  }
}

class _NoConversation extends StatelessWidget {
  final String? message;
  const _NoConversation({this.message});

  @override
  Widget build(BuildContext context) {
    return EmptyView(
      icon: Icons.chat_bubble_outline,
      title: 'No WhatsApp conversation yet',
      message: message ??
          'When this client messages your business number, the chat appears here.',
    );
  }
}

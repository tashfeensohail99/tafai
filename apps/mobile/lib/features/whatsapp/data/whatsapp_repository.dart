import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http_parser/http_parser.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/wa_message.dart';
import '../domain/wa_quick_reply.dart';
import '../domain/wa_stats.dart';
import '../domain/wa_template.dart';
import '../domain/wa_thread.dart';

/// One page of the inbox (cursor pagination).
class ThreadsPage {
  final List<WhatsappThread> items;
  final String? nextCursor;
  const ThreadsPage(this.items, this.nextCursor);
}

class WhatsappRepository {
  final Dio _c;
  WhatsappRepository(this._c);

  /// GET /whatsapp/threads — inbox list (scoped). The tab maps to one of
  /// contacted/uncontacted; followUpDue is the "Due" chip.
  ///
  /// `archived` / `blocked` are mutually-exclusive "show ONLY these" views.
  /// When NEITHER is passed the backend excludes archived AND blocked threads
  /// from the default list, so we simply don't send the flags for the inbox.
  Future<ThreadsPage> listThreads({
    bool? contacted,
    bool? uncontacted,
    bool? needsReply,
    bool? followUpDue,
    bool? archived,
    bool? blocked,
    String? search,
    String? cursor,
    int limit = 30,
  }) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/whatsapp/threads',
        queryParameters: <String, dynamic>{
          if (contacted == true) 'contacted': true,
          if (uncontacted == true) 'uncontacted': true,
          if (needsReply == true) 'needsReply': true,
          if (followUpDue == true) 'followUpDue': true,
          if (archived == true) 'archived': true,
          if (blocked == true) 'blocked': true,
          if (search != null && search.isNotEmpty) 'search': search,
          if (cursor != null) 'cursor': cursor,
          'limit': limit,
        },
      );
      final data = res.data ?? const {};
      final items = (data['items'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(WhatsappThread.fromJson)
          .toList();
      return ThreadsPage(items, data['nextCursor'] as String?);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/threads/stats — tab-badge counts.
  Future<ThreadStats> stats() async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/whatsapp/threads/stats');
      return ThreadStats.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/threads/by-lead/:leadId — the thread for a lead (chat tab).
  Future<WhatsappThread?> byLead(String leadId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/whatsapp/threads/by-lead/$leadId',
      );
      final item = res.data?['item'];
      return item is Map<String, dynamic>
          ? WhatsappThread.fromJson(item)
          : null;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/threads/:id — thread detail (fresher window + ai state).
  Future<WhatsappThread> getThread(String id) async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/whatsapp/threads/$id');
      return WhatsappThread.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/threads/:id/messages — history (returns ascending by time).
  /// `before` fetches an older page (scroll-up).
  Future<List<ChatMessage>> messages(
    String threadId, {
    DateTime? before,
    DateTime? after,
  }) async {
    try {
      final res = await _c.get<List<dynamic>>(
        '/whatsapp/threads/$threadId/messages',
        queryParameters: <String, dynamic>{
          if (before != null) 'before': before.toUtc().toIso8601String(),
          if (after != null) 'after': after.toUtc().toIso8601String(),
        },
      );
      final list = (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ChatMessage.fromJson)
          .toList();
      list.sort((a, b) => a.createdAt.compareTo(b.createdAt));
      return list;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/threads/:threadId/messages/:messageId/media-url → { url }.
  /// Short-lived signed URL for an attachment's bytes — used to show inbound
  /// images inline and to open videos / documents in the browser (our bearer
  /// token must never be sent to storage or handed to the browser).
  Future<String> mediaSignedUrl(String threadId, String messageId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/messages/$messageId/media-url',
      );
      return res.data!['url'] as String;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:id/messages/text — only inside the 24h window
  /// (else 400 → use a template).
  Future<ChatMessage> sendText(String threadId, String body,
      {String? contextWaMessageId}) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/messages/text',
        data: {
          'body': body,
          if (contextWaMessageId != null)
            'contextWaMessageId': contextWaMessageId,
        },
      );
      return ChatMessage.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:id/read — clears unread.
  Future<void> markRead(String threadId) async {
    try {
      await _c.post<dynamic>('/whatsapp/threads/$threadId/read');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:id/ai-toggle — returns the new aiEnabled.
  Future<bool> aiToggle(String threadId, bool enabled) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/ai-toggle',
        data: {'aiEnabled': enabled},
      );
      return res.data?['aiEnabled'] as bool? ?? enabled;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:id/take-over — human takes over (bot off).
  Future<bool> takeOver(String threadId) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/take-over',
      );
      return res.data?['aiEnabled'] as bool? ?? false;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Block / archive (thread + contact moderation) ────────────────────────────

  /// POST /whatsapp/threads/:threadId/block — blocks the contact (Lead+Client)
  /// AND archives the thread. perm: whatsapp.block.
  Future<void> blockContact(String threadId, {String? reason}) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/block',
        data: {
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:threadId/unblock — clears the block on the
  /// contact (Lead+Client). perm: whatsapp.block.
  Future<void> unblockContact(String threadId) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/unblock',
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:threadId/archive — thread.status = ARCHIVED.
  /// perm: whatsapp.send_message.
  Future<void> archiveThread(String threadId) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/archive',
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:threadId/unarchive — thread.status = OPEN.
  /// perm: whatsapp.send_message.
  Future<void> unarchiveThread(String threadId) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/unarchive',
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Channels + Templates ───────────────────────────────────────────────────

  /// GET /whatsapp/channels
  Future<List<WaChannel>> listChannels() async {
    try {
      final res = await _c.get<dynamic>('/whatsapp/channels');
      final data = res.data;
      final List<dynamic> raw;
      if (data is List) {
        raw = data;
      } else if (data is Map<String, dynamic> && data['items'] is List) {
        raw = data['items'] as List<dynamic>;
      } else {
        raw = const [];
      }
      return raw
          .whereType<Map<String, dynamic>>()
          .map(WaChannel.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/channels/:channelId/templates
  Future<List<WaTemplate>> listTemplates(String channelId) async {
    try {
      final res =
          await _c.get<dynamic>('/whatsapp/channels/$channelId/templates');
      final data = res.data;
      final List<dynamic> raw;
      if (data is List) {
        raw = data;
      } else if (data is Map<String, dynamic> && data['items'] is List) {
        raw = data['items'] as List<dynamic>;
      } else {
        raw = const [];
      }
      return raw
          .whereType<Map<String, dynamic>>()
          .map(WaTemplate.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/threads/:threadId/messages/template
  Future<ChatMessage> sendTemplate(
    String threadId, {
    required String templateName,
    required String language,
    required List<Map<String, dynamic>> components,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/messages/template',
        data: {
          'templateName': templateName,
          'language': language,
          'components': components,
        },
      );
      return ChatMessage.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// MIME type from the filename extension — the backend (and Meta behind
  /// it) rejects untyped octet-stream uploads.
  static MediaType? _mediaTypeFor(String name) {
    final ext = name.toLowerCase().split('.').last;
    const map = <String, List<String>>{
      'm4a': ['audio', 'mp4'],
      'aac': ['audio', 'aac'],
      'mp3': ['audio', 'mpeg'],
      'ogg': ['audio', 'ogg'],
      'amr': ['audio', 'amr'],
      'jpg': ['image', 'jpeg'],
      'jpeg': ['image', 'jpeg'],
      'png': ['image', 'png'],
      'webp': ['image', 'webp'],
      'gif': ['image', 'gif'],
      'mp4': ['video', 'mp4'],
      '3gp': ['video', '3gp'],
      'pdf': ['application', 'pdf'],
      'txt': ['text', 'plain'],
    };
    final m = map[ext];
    return m == null ? null : MediaType(m[0], m[1]);
  }

  /// POST /whatsapp/threads/:threadId/messages/media (multipart)
  Future<ChatMessage> sendMedia(
    String threadId, {
    required String filePath,
    String? fileName,
    String? caption,
  }) async {
    try {
      final form = FormData.fromMap({
        // Declare the real content type — without it the part goes up as
        // application/octet-stream and the backend rejects it for Meta.
        'file': await MultipartFile.fromFile(
          filePath,
          filename: fileName,
          contentType: _mediaTypeFor(fileName ?? filePath),
        ),
        if (caption != null && caption.isNotEmpty) 'caption': caption,
      });
      final res = await _c.post<Map<String, dynamic>>(
        '/whatsapp/threads/$threadId/messages/media',
        data: form,
      );
      return ChatMessage.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Quick replies (saved snippets — not Meta templates) ──────────────────

  /// GET /quick-replies — team + personal snippets for the composer.
  Future<QuickReplyList> quickReplies() async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/quick-replies');
      return QuickReplyList.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /quick-replies — `team` needs template-manager permission.
  Future<void> createQuickReply({
    required String title,
    required String body,
    bool team = false,
  }) async {
    try {
      await _c.post<Map<String, dynamic>>('/quick-replies', data: {
        'title': title,
        'body': body,
        if (team) 'team': true,
      });
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// DELETE /quick-replies/:id — own snippets (team with manager permission).
  Future<void> deleteQuickReply(String id) async {
    try {
      await _c.delete<void>('/quick-replies/$id');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final whatsappRepositoryProvider = Provider<WhatsappRepository>((ref) {
  return WhatsappRepository(ref.watch(apiClientProvider));
});

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/portal_models.dart';

/// Repository for the CLIENT portal (external customer). Every method talks to
/// the backend /portal/* routes and maps Dio errors to typed AppErrors.
///
/// Authorisation is by the 'client' ROLE only — clients carry an empty
/// permissions[] so we never check a permission key. A client with
/// portalAccessEnabled=false (or a non-ACTIVE account) authenticates but the
/// backend returns 403 on every call; mapDioError turns that into a
/// ForbiddenError the screens render as a clean "no access" state.
class PortalRepository {
  final Dio _client;
  PortalRepository(this._client);

  // ── Cases ─────────────────────────────────────────────────────────────────

  /// GET /portal/cases/mine — the client's active cases (newest first). Used on
  /// shell load to resolve the active caseId (the first / most recent).
  Future<List<PortalCaseSummary>> myCases() async {
    try {
      final res = await _client.get<List<dynamic>>('/portal/cases/mine');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PortalCaseSummary.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /portal/cases/:caseId — case overview detail.
  Future<PortalCaseDetail> caseDetail(String caseId) async {
    try {
      final res =
          await _client.get<Map<String, dynamic>>('/portal/cases/$caseId');
      return PortalCaseDetail.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /portal/cases/:caseId/timeline — the client-safe activity feed
  /// (stage changes, document decisions, officer/system messages). Ascending
  /// by createdAt; the tab reverses for newest-first.
  Future<List<PortalTimelineEvent>> timeline(String caseId) async {
    try {
      final res =
          await _client.get<List<dynamic>>('/portal/cases/$caseId/timeline');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PortalTimelineEvent.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Documents ───────────────────────────────────────────────────────────

  /// GET /portal/cases/:caseId/documents — the filtered checklist.
  Future<List<PortalDocumentItem>> documents(String caseId) async {
    try {
      final res =
          await _client.get<List<dynamic>>('/portal/cases/$caseId/documents');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PortalDocumentItem.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /portal/cases/:caseId/documents/:itemId/upload (multipart, field
  /// "file"). [filePath] is a local device path from file_picker. The server
  /// flips the item status to SUBMITTED and runs AI assessment.
  Future<void> uploadDocument(
    String caseId,
    String itemId, {
    required String filePath,
    String? fileName,
  }) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      await _client.post<Map<String, dynamic>>(
        '/portal/cases/$caseId/documents/$itemId/upload',
        data: form,
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /portal/cases/:caseId/additional-documents (multipart, field "file"
  /// + optional "note"). An extra document not tied to a checklist slot.
  Future<void> uploadAdditionalDocument(
    String caseId, {
    required String filePath,
    String? fileName,
    String? note,
  }) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      });
      await _client.post<Map<String, dynamic>>(
        '/portal/cases/$caseId/additional-documents',
        data: form,
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /portal/cases/:caseId/documents/:itemId/signed-url → a short-lived URL
  /// the client opens in the external browser (never an in-app PDF viewer).
  Future<String> documentSignedUrl(String caseId, String itemId) async {
    try {
      final res = await _client.get<Map<String, dynamic>>(
        '/portal/cases/$caseId/documents/$itemId/signed-url',
      );
      return res.data!['url'] as String;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /// GET /portal/cases/:caseId/communications — the client↔officer thread.
  /// The server marks unread officer messages as read as a side effect.
  Future<List<PortalMessage>> messages(String caseId) async {
    try {
      final res = await _client
          .get<List<dynamic>>('/portal/cases/$caseId/communications');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PortalMessage.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /portal/cases/:caseId/communications — send a CLIENT_TO_OFFICER
  /// message. Returns the created message.
  Future<PortalMessage> sendMessage(
    String caseId, {
    required String content,
    String? subject,
  }) async {
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/portal/cases/$caseId/communications',
        data: <String, dynamic>{
          'content': content,
          if (subject != null && subject.trim().isNotEmpty)
            'subject': subject.trim(),
        },
      );
      return PortalMessage.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  /// GET /portal/notifications — the aggregated, computed feed.
  Future<List<PortalNotification>> notifications() async {
    try {
      final res = await _client.get<List<dynamic>>('/portal/notifications');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PortalNotification.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Appointments ────────────────────────────────────────────────────────

  /// GET /portal/appointments — all of the client's appointments (past +
  /// upcoming, ascending by time).
  Future<List<PortalAppointment>> appointments() async {
    try {
      final res = await _client.get<List<dynamic>>('/portal/appointments');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PortalAppointment.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final portalRepositoryProvider = Provider<PortalRepository>((ref) {
  return PortalRepository(ref.watch(apiClientProvider));
});

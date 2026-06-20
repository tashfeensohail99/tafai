import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/processing_models.dart';

/// Processing department API client. Endpoint paths + JSON shapes are derived
/// 1:1 from the live web client (apps/frontend/lib/processing.ts). Every call
/// follows the mobile convention: Dio inject + try/catch -> mapDioError.
///
/// Associates are server-scoped to their own cases (the backend filters by
/// assignedOfficerId); manager-only surfaces gate client-side on the
/// processing_manager role AND fail closed when the server returns 403.
class ProcessingRepository {
  final Dio _c;
  ProcessingRepository(this._c);

  // --- Dashboard -----------------------------------------------------------

  /// GET /processing/dashboard — role KPIs (server filters by officer for
  /// associates; global aggregates for managers).
  Future<ProcessingDashboardMetrics> dashboard() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/processing/dashboard');
      return ProcessingDashboardMetrics.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /processing/admin-overview — manager dashboard (requires view_all).
  Future<AdminOverview> adminOverview() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/processing/admin-overview');
      return AdminOverview.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Cases ---------------------------------------------------------------

  /// GET /processing/cases — scoped + filtered list. `stages` (multi) wins over
  /// `stage` when both passed, matching the web client.
  Future<ListCasesResult> listCases({
    String? search,
    String? stage,
    List<String>? stages,
    String? priority,
    String? service,
    String? targetCountry,
    String? authorityDecision,
    int? page,
    int limit = 50,
  }) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/processing/cases',
        queryParameters: <String, dynamic>{
          if (search != null && search.isNotEmpty) 'search': search,
          if (stages != null && stages.isNotEmpty) 'stages': stages.join(','),
          if ((stages == null || stages.isEmpty) && stage != null) 'stage': stage,
          if (priority != null) 'priority': priority,
          if (service != null) 'service': service,
          if (targetCountry != null) 'targetCountry': targetCountry,
          if (authorityDecision != null) 'authorityDecision': authorityDecision,
          if (page != null) 'page': page,
          'limit': limit,
        },
      );
      final data = res.data ?? const {};
      final cases = (data['cases'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProcessingCaseListItem.fromJson)
          .toList();
      return ListCasesResult(
        cases: cases,
        total: (data['total'] as num?)?.toInt() ?? cases.length,
        page: (data['page'] as num?)?.toInt() ?? 1,
        limit: (data['limit'] as num?)?.toInt() ?? limit,
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /processing/cases/:id
  Future<ProcessingCaseDetail> getCase(String caseId) async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/processing/cases/$caseId');
      return ProcessingCaseDetail.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /processing/cases/:id/stage — gated stage change. Pass only the
  /// named fields the target stage requires (the server re-validates).
  Future<ProcessingCaseDetail> changeStage(
    String caseId, {
    required String toStage,
    String? reason,
    String? notes,
    String? submissionReference,
    String? authorityTrackingRef,
    String? cancellationReason,
    String? completionNotes,
  }) async {
    try {
      final res = await _c.patch<Map<String, dynamic>>(
        '/processing/cases/$caseId/stage',
        data: <String, dynamic>{
          'toStage': toStage,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
          if (submissionReference != null && submissionReference.isNotEmpty)
            'submissionReference': submissionReference,
          if (authorityTrackingRef != null && authorityTrackingRef.isNotEmpty)
            'authorityTrackingRef': authorityTrackingRef,
          if (cancellationReason != null && cancellationReason.isNotEmpty)
            'cancellationReason': cancellationReason,
          if (completionNotes != null && completionNotes.isNotEmpty)
            'completionNotes': completionNotes,
        },
      );
      return ProcessingCaseDetail.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /processing/cases/:id/assign — manager reassign. Body field is
  /// `officerId` (matches the backend AssignCaseDto).
  Future<ProcessingCaseDetail> assignCase(
      String caseId, String officerId) async {
    try {
      final res = await _c.patch<Map<String, dynamic>>(
        '/processing/cases/$caseId/assign',
        data: {'officerId': officerId},
      );
      return ProcessingCaseDetail.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Officers / intake (manager) -----------------------------------------

  /// GET /processing/officers — roster for the acknowledge / reassign pickers.
  Future<List<ProcessingOfficer>> officers() async {
    try {
      final res = await _c.get<List<dynamic>>('/processing/officers');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProcessingOfficer.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /processing/intake — finance-handover cases awaiting manager assignment.
  Future<List<IntakeCaseItem>> intakeQueue() async {
    try {
      final res = await _c.get<List<dynamic>>('/processing/intake');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(IntakeCaseItem.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /processing/intake/:id/acknowledge — manager acknowledges + assigns.
  Future<ProcessingCaseDetail> acknowledgeIntake(
    String caseId, {
    required String assignOfficerId,
    String? service,
    String? programCode,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/intake/$caseId/acknowledge',
        data: <String, dynamic>{
          'assignOfficerId': assignOfficerId,
          if (service != null && service.isNotEmpty) 'service': service,
          if (programCode != null && programCode.isNotEmpty)
            'programCode': programCode,
        },
      );
      return ProcessingCaseDetail.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Cross-case queues ---------------------------------------------------

  /// GET /processing/documents — cross-case document review queue.
  Future<List<AggregatedDocument>> aggregatedDocuments() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/processing/documents');
      return ((res.data ?? const {})['items'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AggregatedDocument.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /processing/tasks — cross-case task queue.
  Future<List<AggregatedTask>> aggregatedTasks() async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/processing/tasks');
      return ((res.data ?? const {})['tasks'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AggregatedTask.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Documents (per case) ------------------------------------------------

  /// GET /processing/cases/:id/documents
  Future<List<CaseDocumentItem>> caseDocuments(String caseId) async {
    try {
      final res = await _c
          .get<List<dynamic>>('/processing/cases/$caseId/documents');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CaseDocumentItem.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /processing/cases/:id/documents/:itemId/signed-url — for browser open.
  Future<String> documentSignedUrl(String caseId, String itemId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/processing/cases/$caseId/documents/$itemId/signed-url',
      );
      return res.data!['url'] as String;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /processing/cases/:id/documents/:itemId/review — ACCEPT / REJECT.
  /// The web client maps ACCEPT→ACCEPTED / REJECT→REJECTED for the backend enum.
  Future<CaseDocumentItem> reviewDocument(
    String caseId,
    String itemId, {
    required String decision, // 'ACCEPT' | 'REJECT'
    List<String>? rejectionReasonCodes,
    String? rejectionNote,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/cases/$caseId/documents/$itemId/review',
        data: <String, dynamic>{
          'decision': decision == 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
          if (rejectionReasonCodes != null && rejectionReasonCodes.isNotEmpty)
            'rejectionReasonCodes': rejectionReasonCodes,
          if (rejectionNote != null && rejectionNote.isNotEmpty)
            'rejectionNote': rejectionNote,
        },
      );
      return CaseDocumentItem.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /processing/cases/:id/documents/:itemId/waive
  Future<CaseDocumentItem> waiveDocument(
    String caseId,
    String itemId, {
    required String waiveReason,
  }) async {
    try {
      final res = await _c.patch<Map<String, dynamic>>(
        '/processing/cases/$caseId/documents/$itemId/waive',
        data: {'waiveReason': waiveReason},
      );
      return CaseDocumentItem.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /processing/cases/:id/documents/:itemId/request — ask the client.
  Future<CaseDocumentItem> requestDocument(
    String caseId,
    String itemId, {
    String? message,
  }) async {
    try {
      final res = await _c.patch<Map<String, dynamic>>(
        '/processing/cases/$caseId/documents/$itemId/request',
        data: <String, dynamic>{
          if (message != null && message.isNotEmpty) 'message': message,
        },
      );
      return CaseDocumentItem.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /processing/cases/:id/documents/:itemId/upload (multipart) — officer
  /// uploads on the client's behalf into a checklist slot. [filePath] is a
  /// local device path (file_picker). Mirrors the leads uploadFile pattern.
  Future<CaseDocumentItem> uploadDocument(
    String caseId,
    String itemId, {
    required String filePath,
    String? fileName,
  }) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/cases/$caseId/documents/$itemId/upload',
        data: form,
      );
      return CaseDocumentItem.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /processing/cases/:id/identity-reconciliation — read panel.
  Future<IdentityReconciliation> identityReconciliation(String caseId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/processing/cases/$caseId/identity-reconciliation',
      );
      return IdentityReconciliation.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Notes ---------------------------------------------------------------

  Future<List<ProcessingNote>> caseNotes(String caseId) async {
    try {
      final res =
          await _c.get<List<dynamic>>('/processing/cases/$caseId/notes');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProcessingNote.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<ProcessingNote> createNote(
    String caseId, {
    required String content,
    String? noteType,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/cases/$caseId/notes',
        data: <String, dynamic>{
          'content': content,
          if (noteType != null) 'noteType': noteType,
        },
      );
      return ProcessingNote.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<ProcessingNote> pinNote(
    String caseId,
    String noteId, {
    required bool isPinned,
  }) async {
    try {
      final res = await _c.patch<Map<String, dynamic>>(
        '/processing/cases/$caseId/notes/$noteId/pin',
        data: {'isPinned': isPinned},
      );
      return ProcessingNote.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Tasks ---------------------------------------------------------------

  Future<List<ProcessingTask>> caseTasks(String caseId) async {
    try {
      final res =
          await _c.get<List<dynamic>>('/processing/cases/$caseId/tasks');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProcessingTask.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<ProcessingTask> createTask(
    String caseId, {
    required String title,
    String? description,
    String? dueDate,
    String? priority,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/cases/$caseId/tasks',
        data: <String, dynamic>{
          'title': title,
          if (description != null && description.isNotEmpty)
            'description': description,
          if (dueDate != null && dueDate.isNotEmpty) 'dueDate': dueDate,
          if (priority != null) 'priority': priority,
        },
      );
      return ProcessingTask.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<ProcessingTask> updateTaskStatus(
    String caseId,
    String taskId, {
    required String status,
  }) async {
    try {
      final res = await _c.patch<Map<String, dynamic>>(
        '/processing/cases/$caseId/tasks/$taskId',
        data: {'status': status},
      );
      return ProcessingTask.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Communications ------------------------------------------------------

  Future<List<CaseCommunication>> caseCommunications(String caseId) async {
    try {
      final res = await _c
          .get<List<dynamic>>('/processing/cases/$caseId/communications');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CaseCommunication.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<SendCommunicationResult> sendCommunication(
    String caseId, {
    required String subject,
    required String content,
    required List<String> channelsSent,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/cases/$caseId/communications',
        data: {
          'subject': subject,
          'content': content,
          'channelsSent': channelsSent,
        },
      );
      return SendCommunicationResult.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Audit / Background --------------------------------------------------

  Future<List<CaseAuditLog>> caseAudit(String caseId) async {
    try {
      final res =
          await _c.get<List<dynamic>>('/processing/cases/$caseId/audit');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CaseAuditLog.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<CaseBackground> caseBackground(String caseId) async {
    try {
      final res = await _c
          .get<Map<String, dynamic>>('/processing/cases/$caseId/background');
      return CaseBackground.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- WhatsApp ------------------------------------------------------------

  /// GET /processing/cases/:id/whatsapp — resolves the thread pointer (matches
  /// by lead OR client). We only need the threadId to reuse the WhatsApp
  /// ThreadScreen via the whatsapp repository's getThread().
  Future<CaseWhatsAppRef> caseWhatsApp(String caseId) async {
    try {
      final res = await _c
          .get<Map<String, dynamic>>('/processing/cases/$caseId/whatsapp');
      return CaseWhatsAppRef.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Submission readiness + package -------------------------------------

  Future<SubmissionReadiness> submissionReadiness(String caseId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/processing/cases/$caseId/submission-readiness',
      );
      return SubmissionReadiness.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<SubmissionPackage> submissionPackage(String caseId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/processing/cases/$caseId/submission-package',
      );
      return SubmissionPackage.fromJson(res.data ?? const {'exists': false});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST .../submission-package/assemble — builds the merged PDF; returns the
  /// signed URL. Throws ServerError(400) with the blocker message when the
  /// quality gate fails (surfaced via mapDioError).
  Future<SubmissionPackage> assembleSubmissionPackage(String caseId) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/processing/cases/$caseId/submission-package/assemble',
      );
      final data = res.data ?? const {};
      return SubmissionPackage.fromJson({...data, 'exists': true});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final processingRepositoryProvider = Provider<ProcessingRepository>((ref) {
  return ProcessingRepository(ref.watch(apiClientProvider));
});

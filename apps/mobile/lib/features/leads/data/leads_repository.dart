import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../../../core/util/parsers.dart';
import '../domain/lead.dart';
import '../domain/lead_stats.dart';

/// One sales-disposition history entry (who + when) for a lead.
class DispositionHistoryEntry {
  final String disposition;
  final String? note;
  final String? byName;
  final DateTime at;
  const DispositionHistoryEntry({
    required this.disposition,
    this.note,
    this.byName,
    required this.at,
  });
  factory DispositionHistoryEntry.fromJson(Map<String, dynamic> j) =>
      DispositionHistoryEntry(
        disposition: j['disposition'] as String? ?? '',
        note: asStringOrNull(j['note']),
        byName: asStringOrNull(j['byName']),
        at: parseApiDate(j['at']),
      );
}

class LeadsRepository {
  final Dio _client;
  LeadsRepository(this._client);

  /// GET /leads — scoped list with server-side filters. `priority` is NOT a
  /// server filter, so it's refined client-side here.
  Future<List<Lead>> list({
    String? search,
    String? status,
    String? priority,
    String? sourceChannel,
    String? serviceInterest,
    String? targetCountry,
    bool? fromCsv,
    int limit = 1000,
  }) async {
    try {
      final res = await _client.get<List<dynamic>>(
        '/leads',
        queryParameters: <String, dynamic>{
          if (search != null && search.isNotEmpty) 'search': search,
          if (status != null) 'status': status,
          if (sourceChannel != null) 'sourceChannel': sourceChannel,
          if (serviceInterest != null) 'serviceInterest': serviceInterest,
          if (targetCountry != null) 'targetCountry': targetCountry,
          if (fromCsv != null) 'fromCsv': fromCsv,
          'limit': '$limit',
        },
      );
      final leads = (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(Lead.fromJson)
          .toList();
      if (priority != null) {
        return leads.where((l) => l.priority == priority).toList();
      }
      return leads;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /leads/:id
  Future<Lead> get(String id) async {
    try {
      final res = await _client.get<Map<String, dynamic>>('/leads/$id');
      return Lead.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /leads/dashboard-summary
  Future<LeadDashboardSummary> dashboardSummary() async {
    try {
      final res =
          await _client.get<Map<String, dynamic>>('/leads/dashboard-summary');
      return LeadDashboardSummary.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /leads/my-stats
  Future<MySalesStats> myStats() async {
    try {
      final res = await _client.get<Map<String, dynamic>>('/leads/my-stats');
      return MySalesStats.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /leads
  Future<Lead> create({
    required String firstName,
    required String lastName,
    required String phone,
    String? email,
    String? targetCountry,
    String? serviceInterest,
    String? sourceChannel,
    String? priority,
    String? notes,
  }) async {
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/leads',
        data: <String, dynamic>{
          'firstName': firstName,
          'lastName': lastName,
          'phone': phone,
          if (email != null && email.isNotEmpty) 'email': email,
          if (targetCountry != null && targetCountry.isNotEmpty)
            'targetCountry': targetCountry,
          if (serviceInterest != null && serviceInterest.isNotEmpty)
            'serviceInterest': serviceInterest,
          if (sourceChannel != null && sourceChannel.isNotEmpty)
            'sourceChannel': sourceChannel,
          if (priority != null) 'priority': priority,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
        },
      );
      return Lead.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /leads/:id — only the provided fields are sent. Empty strings clear
  /// the optional text fields (server resets the column to NULL).
  Future<void> update(
    String id, {
    String? status,
    String? priority,
    String? notes,
    String? firstName,
    String? lastName,
    String? phone,
    String? email,
    String? serviceInterest,
    String? targetCountry,
    String? serviceFeeAmount,
    String? serviceFeeCurrency,
    String? lostReason,
  }) async {
    final body = <String, dynamic>{};
    if (status != null) body['status'] = status;
    if (priority != null) body['priority'] = priority;
    if (notes != null) body['notes'] = notes;
    if (firstName != null) body['firstName'] = firstName;
    if (lastName != null) body['lastName'] = lastName;
    if (phone != null) body['phone'] = phone;
    if (email != null) body['email'] = email.isEmpty ? null : email;
    if (serviceInterest != null) {
      body['serviceInterest'] = serviceInterest.isEmpty ? null : serviceInterest;
    }
    if (targetCountry != null) {
      body['targetCountry'] = targetCountry.isEmpty ? null : targetCountry;
    }
    if (serviceFeeAmount != null) {
      body['serviceFeeAmount'] =
          serviceFeeAmount.trim().isEmpty ? null : serviceFeeAmount.trim();
    }
    if (serviceFeeCurrency != null) {
      body['serviceFeeCurrency'] =
          serviceFeeCurrency.isEmpty ? null : serviceFeeCurrency;
    }
    if (lostReason != null) body['lostReason'] = lostReason;
    try {
      await _client.patch<Map<String, dynamic>>('/leads/$id', data: body);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /leads/:id/assign — reassign to another employee.
  Future<void> assign(String id, String assignedEmployeeId) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/leads/$id/assign',
        data: {'assignedEmployeeId': assignedEmployeeId},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /leads/:id/convert — Lead → Client. Requires a verified email
  /// (server rejects with 400 otherwise — send verification first).
  Future<void> convert(String id, {String? notes}) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/leads/$id/convert',
        data: {if (notes != null && notes.isNotEmpty) 'notes': notes},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /leads/:id/disposition — set the sales DISPOSITION (call-outcome tag,
  /// separate from pipeline status). For FOLLOW_UP / CONTACT_LATER pass
  /// [reminderAt] to schedule a follow-up reminder.
  Future<void> setDisposition(
    String leadId, {
    required String disposition,
    String? note,
    DateTime? reminderAt,
  }) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/leads/$leadId/disposition',
        data: <String, dynamic>{
          'disposition': disposition,
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
          if (reminderAt != null) 'reminderAt': reminderAt.toUtc().toIso8601String(),
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /leads/:id/disposition-history — who + when, most recent first.
  Future<List<DispositionHistoryEntry>> dispositionHistory(String leadId) async {
    try {
      final res =
          await _client.get<List<dynamic>>('/leads/$leadId/disposition-history');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(DispositionHistoryEntry.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /leads/:id/send-email-verification → `{ sent }`.
  Future<bool> sendEmailVerification(String id) async {
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/leads/$id/send-email-verification',
      );
      return res.data?['sent'] as bool? ?? false;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // --- Files ---------------------------------------------------------------

  /// GET /leads/:id/files
  Future<List<LeadFile>> files(String id) async {
    try {
      final res = await _client.get<List<dynamic>>('/leads/$id/files');
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LeadFile.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /leads/:id/files (multipart). [filePath] is a local device path.
  Future<LeadFile> uploadFile(
    String id, {
    required String filePath,
    String? fileName,
  }) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      final res =
          await _client.post<Map<String, dynamic>>('/leads/$id/files', data: form);
      return LeadFile.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /leads/:id/files/:fileId/url → short-lived signed URL.
  Future<String> fileUrl(String id, String fileId) async {
    try {
      final res = await _client.get<Map<String, dynamic>>(
        '/leads/$id/files/$fileId/url',
      );
      return res.data!['url'] as String;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// DELETE /leads/:id/files/:fileId
  Future<void> deleteFile(String id, String fileId) async {
    try {
      await _client.delete<Map<String, dynamic>>('/leads/$id/files/$fileId');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final leadsRepositoryProvider = Provider<LeadsRepository>((ref) {
  return LeadsRepository(ref.watch(apiClientProvider));
});

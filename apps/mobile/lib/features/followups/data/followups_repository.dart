import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/follow_up.dart';

class FollowUpsRepository {
  final Dio _client;
  FollowUpsRepository(this._client);

  /// GET /follow-ups?bucket=overdue|today|upcoming (bucket ⇒ OPEN; PKT day logic).
  Future<List<FollowUp>> listByBucket(String bucket, {int limit = 100}) async {
    try {
      final res = await _client.get<List<dynamic>>(
        '/follow-ups',
        queryParameters: {'bucket': bucket, 'limit': '$limit'},
      );
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FollowUp.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /follow-ups/:id/complete
  Future<void> complete(String id, {String? outcomeNotes}) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/follow-ups/$id/complete',
        data: {
          if (outcomeNotes != null && outcomeNotes.isNotEmpty)
            'outcomeNotes': outcomeNotes,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /follow-ups/:id/reschedule — re-arms the reminder.
  Future<void> reschedule(String id, DateTime dueAt) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/follow-ups/$id/reschedule',
        data: {'dueAt': dueAt.toUtc().toIso8601String()},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /follow-ups
  Future<void> create({
    required String leadId,
    required String title,
    String? description,
    String? contactMethod,
    required DateTime dueAt,
  }) async {
    try {
      await _client.post<Map<String, dynamic>>('/follow-ups', data: {
        'leadId': leadId,
        'title': title,
        'dueAt': dueAt.toUtc().toIso8601String(),
        if (description != null && description.isNotEmpty)
          'description': description,
        if (contactMethod != null) 'contactMethod': contactMethod,
      });
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final followUpsRepositoryProvider = Provider<FollowUpsRepository>((ref) {
  return FollowUpsRepository(ref.watch(apiClientProvider));
});

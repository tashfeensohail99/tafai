import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/app_notification.dart';

class NotificationsRepository {
  final Dio _c;
  NotificationsRepository(this._c);

  /// GET /notifications?limit=
  Future<List<AppNotification>> list({int limit = 50}) async {
    try {
      final res = await _c.get<List<dynamic>>(
        '/notifications',
        queryParameters: {'limit': limit},
      );
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AppNotification.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /notifications/unread-count → { count }
  Future<int> unreadCount() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/notifications/unread-count');
      return (res.data?['count'] as num?)?.toInt() ?? 0;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /notifications/:id/read
  Future<void> markRead(String id) async {
    try {
      await _c.patch<dynamic>('/notifications/$id/read');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /notifications/read-all
  Future<void> markAllRead() async {
    try {
      await _c.post<dynamic>('/notifications/read-all');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final notificationsRepositoryProvider = Provider<NotificationsRepository>((ref) {
  return NotificationsRepository(ref.watch(apiClientProvider));
});

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/appointment_request.dart';

class AppointmentRequestsRepository {
  final Dio _client;
  AppointmentRequestsRepository(this._client);

  /// GET /sales/appointment-requests?status=&search= (default status PENDING).
  Future<List<AppointmentRequest>> list({
    String status = 'PENDING',
    String? search,
  }) async {
    try {
      final res = await _client.get<List<dynamic>>(
        '/sales/appointment-requests',
        queryParameters: <String, dynamic>{
          'status': status,
          if (search != null && search.isNotEmpty) 'search': search,
        },
      );
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AppointmentRequest.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// PATCH /sales/appointment-requests/:id/reject
  Future<void> reject(String id) async {
    try {
      await _client.patch<dynamic>('/sales/appointment-requests/$id/reject');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final appointmentRequestsRepositoryProvider =
    Provider<AppointmentRequestsRepository>((ref) {
  return AppointmentRequestsRepository(ref.watch(apiClientProvider));
});

/// Pending bot-captured booking requests (drives the banner + the screen).
final pendingAppointmentRequestsProvider =
    FutureProvider.autoDispose<List<AppointmentRequest>>((ref) {
  return ref.watch(appointmentRequestsRepositoryProvider).list(status: 'PENDING');
});

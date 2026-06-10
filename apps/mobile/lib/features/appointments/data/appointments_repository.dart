import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/appointment.dart';
import '../domain/availability.dart';

class AppointmentsRepository {
  final Dio _client;
  AppointmentsRepository(this._client);

  /// GET /appointments — scoped to the caller. Optional date-range + status.
  Future<List<Appointment>> list({
    String? status,
    DateTime? from,
    DateTime? to,
  }) async {
    try {
      final res = await _client.get<List<dynamic>>(
        '/appointments',
        queryParameters: <String, dynamic>{
          if (status != null) 'status': status,
          if (from != null) 'scheduledFrom': from.toUtc().toIso8601String(),
          if (to != null) 'scheduledTo': to.toUtc().toIso8601String(),
        },
      );
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(Appointment.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /appointments/availability?employeeId=&date=YYYY-MM-DD (PKT day).
  Future<AvailabilityDay> availability(String employeeId, DateTime day) async {
    final d = '${day.year.toString().padLeft(4, '0')}-'
        '${day.month.toString().padLeft(2, '0')}-'
        '${day.day.toString().padLeft(2, '0')}';
    try {
      final res = await _client.get<Map<String, dynamic>>(
        '/appointments/availability',
        queryParameters: {'employeeId': employeeId, 'date': d},
      );
      return AvailabilityDay.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /appointments — rejects a double-booking with a [ConflictError]
  /// carrying the next free slot (`suggestedAt`).
  Future<Appointment> create({
    required String leadId,
    required String title,
    required String appointmentType,
    required DateTime scheduledAt,
    int durationMinutes = 30,
    String? location,
    String? notes,
    bool sendWhatsAppConfirmation = false,
    String? appointmentRequestId,
  }) async {
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/appointments',
        data: <String, dynamic>{
          'leadId': leadId,
          'title': title,
          'appointmentType': appointmentType,
          'scheduledAt': scheduledAt.toUtc().toIso8601String(),
          'durationMinutes': durationMinutes,
          if (location != null && location.isNotEmpty) 'location': location,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
          if (sendWhatsAppConfirmation) 'sendWhatsAppConfirmation': true,
          if (appointmentRequestId != null)
            'appointmentRequestId': appointmentRequestId,
        },
      );
      return Appointment.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /appointments/:id/reschedule — double-book checked (409 + suggestedAt).
  Future<void> reschedule(
    String id,
    DateTime scheduledAt, {
    int? durationMinutes,
  }) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/appointments/$id/reschedule',
        data: <String, dynamic>{
          'scheduledAt': scheduledAt.toUtc().toIso8601String(),
          if (durationMinutes != null) 'durationMinutes': durationMinutes,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /appointments/:id/cancel
  Future<void> cancel(String id, {String? reason}) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/appointments/$id/cancel',
        data: <String, dynamic>{
          if (reason != null && reason.isNotEmpty) 'cancellationReason': reason,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final appointmentsRepositoryProvider = Provider<AppointmentsRepository>((ref) {
  return AppointmentsRepository(ref.watch(apiClientProvider));
});

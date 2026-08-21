import 'package:dio/dio.dart';
import 'app_error.dart';

/// Convert a DioException from any API call into a typed AppError.
AppError mapDioError(DioException e) {
  final status = e.response?.statusCode;
  final body = e.response?.data;
  // Prefer `message`; fall back to `reason` (structured 409s like the
  // duplicate-lead guard use `{ error, reason, match }` with no `message`),
  // then `error`. Without this, a duplicate-lead 409 fell through to Dio's raw
  // "invalid status code 409" string instead of "A lead … already exists.".
  final rawMessage = body is Map ? (body['message'] ?? body['reason'] ?? body['error']) : null;
  // NestJS validation errors return `message` as a string[] — join them.
  final message = rawMessage is List
      ? rawMessage.map((m) => m.toString()).join('\n')
      : (rawMessage?.toString() ?? e.message ?? 'Unknown error');

  if (e.type == DioExceptionType.connectionTimeout ||
      e.type == DioExceptionType.receiveTimeout ||
      e.type == DioExceptionType.sendTimeout ||
      e.type == DioExceptionType.connectionError) {
    return const NetworkError('Unable to reach the server. Check your connection.');
  }

  return switch (status) {
    400 => _parseValidationError(body) ?? ServerError(400, message),
    401 => const UnauthorizedError(),
    403 => const ForbiddenError(),
    404 => NotFoundError(message),
    409 => _parseConflict(body, message),
    422 => _parseValidationError(body) ?? ServerError(422, message),
    _ => ServerError(status ?? 0, message),
  };
}

ConflictError _parseConflict(dynamic body, String message) {
  DateTime? suggested;
  if (body is Map && body['suggestedAt'] is String) {
    suggested = DateTime.tryParse(body['suggestedAt'] as String);
  }
  return ConflictError(message, suggestedAt: suggested);
}

ValidationError? _parseValidationError(dynamic body) {
  if (body is! Map) return null;
  final raw = body['errors'];
  if (raw is! Map) return null;
  final errors = <String, List<String>>{};
  for (final entry in raw.entries) {
    final key = entry.key.toString();
    final val = entry.value;
    errors[key] = val is List ? val.map((e) => e.toString()).toList() : [val.toString()];
  }
  return ValidationError(errors);
}

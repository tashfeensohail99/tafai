import 'package:dio/dio.dart';
import 'app_error.dart';

/// Convert a DioException from any API call into a typed AppError.
AppError mapDioError(DioException e) {
  final status = e.response?.statusCode;
  final body = e.response?.data;
  final message = (body is Map ? body['message']?.toString() : null) ?? e.message ?? 'Unknown error';

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
    422 => _parseValidationError(body) ?? ServerError(422, message),
    _ => ServerError(status ?? 0, message),
  };
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

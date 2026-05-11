/// Sealed class for API error handling across the app.
/// Every repository should catch DioException and convert to AppError.
sealed class AppError {
  const AppError();
}

final class NetworkError extends AppError {
  final String message;
  const NetworkError(this.message);
}

final class UnauthorizedError extends AppError {
  const UnauthorizedError();
}

final class ForbiddenError extends AppError {
  const ForbiddenError();
}

final class NotFoundError extends AppError {
  final String? message;
  const NotFoundError([this.message]);
}

final class ValidationError extends AppError {
  final Map<String, List<String>> errors;
  const ValidationError(this.errors);
}

final class ServerError extends AppError {
  final int statusCode;
  final String message;
  const ServerError(this.statusCode, this.message);
}

final class UnknownError extends AppError {
  final Object? cause;
  const UnknownError([this.cause]);
}

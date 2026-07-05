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

/// 409 — a write was rejected because of a conflict. For appointment booking
/// the server includes [suggestedAt]: the next free slot the UI can offer.
final class ConflictError extends AppError {
  final String message;
  final DateTime? suggestedAt;
  const ConflictError(this.message, {this.suggestedAt});
}

final class UnknownError extends AppError {
  final Object? cause;
  const UnknownError([this.cause]);
}

extension AppErrorMessage on AppError {
  /// A single user-facing message for any AppError (e.g. to show in a SnackBar).
  String get userMessage => switch (this) {
        NetworkError(:final message) => message,
        ServerError(:final message) => message,
        ConflictError(:final message) => message,
        NotFoundError(:final message) => message ?? 'Not found.',
        ValidationError(:final errors) =>
          errors.values.expand((e) => e).join('\n'),
        UnauthorizedError() => 'Your session expired. Please sign in again.',
        ForbiddenError() => "You don't have permission to do that.",
        UnknownError() => 'Something went wrong. Please try again.',
      };
}

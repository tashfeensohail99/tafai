import 'package:flutter/material.dart';

import '../errors/app_error.dart';
import '../theme/tokens.dart';

/// Centered spinner with an optional label.
class LoadingView extends StatelessWidget {
  final String? label;
  const LoadingView({super.key, this.label});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(strokeWidth: 2.5),
          if (label != null) ...[
            const SizedBox(height: AppTokens.space4),
            Text(label!, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ],
      ),
    );
  }
}

/// Generic centered illustration + title + message + optional action.
class AppStateView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final Color? iconColor;
  final String? actionLabel;
  final VoidCallback? onAction;

  const AppStateView({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.iconColor,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: iconColor ?? AppTokens.textDisabledLight),
            const SizedBox(height: AppTokens.space4),
            Text(title, style: t.titleMedium, textAlign: TextAlign.center),
            if (message != null) ...[
              const SizedBox(height: AppTokens.space2),
              Text(message!, style: t.bodyMedium, textAlign: TextAlign.center),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: AppTokens.space5),
              OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  final Object error;
  final VoidCallback? onRetry;
  const ErrorView({super.key, required this.error, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return AppStateView(
      icon: Icons.error_outline,
      iconColor: AppTokens.statusDanger,
      title: 'Something went wrong',
      message: messageForError(error),
      actionLabel: onRetry == null ? null : 'Try again',
      onAction: onRetry,
    );
  }
}

class EmptyView extends StatelessWidget {
  final String title;
  final String? message;
  final IconData icon;
  const EmptyView({
    super.key,
    required this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
  });

  @override
  Widget build(BuildContext context) =>
      AppStateView(icon: icon, title: title, message: message);
}

class ForbiddenView extends StatelessWidget {
  const ForbiddenView({super.key});

  @override
  Widget build(BuildContext context) => const AppStateView(
        icon: Icons.lock_outline,
        title: 'No access',
        message: 'You don’t have permission to view this.',
      );
}

/// Inline red banner for form-level errors.
class ErrorBanner extends StatelessWidget {
  final String message;
  const ErrorBanner(this.message, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTokens.space4),
      decoration: BoxDecoration(
        color: AppTokens.statusDangerBg,
        borderRadius: const BorderRadius.all(AppTokens.radiusMd),
        border: Border.all(color: AppTokens.statusDanger.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, color: AppTokens.statusDanger, size: 18),
          const SizedBox(width: AppTokens.space2),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppTokens.statusDanger,
                fontSize: AppTokens.fontSizeSm,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// White spinner sized for inside a filled button.
class ButtonSpinner extends StatelessWidget {
  const ButtonSpinner({super.key});

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 20,
        width: 20,
        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
      );
}

/// Human-readable text for an [AppError] (or any thrown object).
String messageForError(Object error) {
  if (error is AppError) {
    return switch (error) {
      NetworkError(:final message) => message,
      UnauthorizedError() => 'Your session expired. Please sign in again.',
      ForbiddenError() => 'You don’t have permission to do that.',
      NotFoundError(:final message) => message ?? 'Not found.',
      ValidationError(:final errors) =>
        errors.values.expand((e) => e).join('\n'),
      ServerError(:final message) => message,
      ConflictError(:final message) => message,
      UnknownError() => 'Unexpected error. Please try again.',
    };
  }
  return error.toString();
}

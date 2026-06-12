import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

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

/// A shimmering placeholder list shown while data loads — calmer and more
/// premium than a bare spinner, and it hints at the shape of what's coming.
class SkeletonList extends StatelessWidget {
  final int items;
  final EdgeInsetsGeometry padding;
  const SkeletonList({
    super.key,
    this.items = 7,
    this.padding = const EdgeInsets.all(AppTokens.space4),
  });

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: const Color(0xFFE6EAF0),
      highlightColor: const Color(0xFFF6F8FB),
      child: ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: padding,
        itemCount: items,
        separatorBuilder: (_, __) => const SizedBox(height: AppTokens.space4),
        itemBuilder: (_, __) => const _SkeletonRow(),
      ),
    );
  }
}

class _SkeletonRow extends StatelessWidget {
  const _SkeletonRow();

  @override
  Widget build(BuildContext context) {
    // Opaque shapes on transparent gaps — the shimmer gradient sweeps the
    // shapes; the gaps stay clear so each row reads distinctly.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: const [
        _SkeletonBox(width: 44, height: 44, radius: 22),
        SizedBox(width: AppTokens.space3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SkeletonBar(widthFactor: 0.55, height: 13),
              SizedBox(height: 9),
              _SkeletonBar(widthFactor: 0.85, height: 11),
              SizedBox(height: 7),
              _SkeletonBar(widthFactor: 0.4, height: 11),
            ],
          ),
        ),
      ],
    );
  }
}

class _SkeletonBox extends StatelessWidget {
  final double width;
  final double height;
  final double radius;
  const _SkeletonBox(
      {required this.width, required this.height, this.radius = 8});

  @override
  Widget build(BuildContext context) => Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(radius),
        ),
      );
}

class _SkeletonBar extends StatelessWidget {
  final double widthFactor;
  final double height;
  const _SkeletonBar({required this.widthFactor, required this.height});

  @override
  Widget build(BuildContext context) => FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: widthFactor,
        child: Container(
          height: height,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(6),
          ),
        ),
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

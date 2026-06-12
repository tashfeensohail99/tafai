import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

/// Centralizes crash + error reporting.
///
/// Routes uncaught Flutter framework errors and async-zone errors to Firebase
/// Crashlytics (the same Firebase project that already powers FCM), so a crash
/// on a tester's phone surfaces to us without waiting for a manual report.
///
/// Every call is guarded: if Firebase/Crashlytics isn't available the app keeps
/// running silently (mirrors how [CallPushService] treats a missing config).
class Observability {
  Observability._();
  static final Observability instance = Observability._();

  bool _ready = false;

  /// Wire global error handlers. Call once at startup, AFTER Firebase has been
  /// initialized (CallPushService.initEarly() does that).
  Future<void> init() async {
    try {
      if (Firebase.apps.isEmpty) return;
      final crashlytics = FirebaseCrashlytics.instance;
      // Collect only in release builds — keep debug noise out of the dashboard.
      await crashlytics.setCrashlyticsCollectionEnabled(!kDebugMode);

      // Framework errors (build/layout/paint) → Crashlytics + console.
      final priorOnError = FlutterError.onError;
      FlutterError.onError = (FlutterErrorDetails details) {
        priorOnError?.call(details);
        crashlytics.recordFlutterFatalError(details);
      };

      // Uncaught async errors surfaced by the platform dispatcher.
      PlatformDispatcher.instance.onError = (error, stack) {
        crashlytics.recordError(error, stack, fatal: true);
        return true;
      };
      _ready = true;
    } catch (_) {
      // No Firebase / Crashlytics available — stay silent, app continues.
    }
  }

  /// Record a caught (non-fatal) error with optional context.
  Future<void> recordError(
    Object error,
    StackTrace? stack, {
    bool fatal = false,
    String? reason,
  }) async {
    if (kDebugMode) debugPrint('Observability: $error');
    if (!_ready) return;
    try {
      await FirebaseCrashlytics.instance
          .recordError(error, stack, fatal: fatal, reason: reason);
    } catch (_) {}
  }

  /// Tag crash reports with the signed-in user id (helps correlate reports;
  /// no extra PII beyond the opaque id).
  Future<void> setUser(String? userId) async {
    if (!_ready) return;
    try {
      await FirebaseCrashlytics.instance.setUserIdentifier(userId ?? '');
    } catch (_) {}
  }

  /// Leave a breadcrumb that shows up in the next crash log.
  Future<void> log(String message) async {
    if (!_ready) return;
    try {
      await FirebaseCrashlytics.instance.log(message);
    } catch (_) {}
  }
}

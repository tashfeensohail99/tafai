import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/auth/auth_controller.dart';
import 'core/observability/observability.dart';
import 'core/theme/app_theme.dart';
import 'core/router/app_router.dart';
import 'features/calls/data/push_service.dart';
import 'features/calls/presentation/call_host.dart';
import 'features/security/presentation/app_lock_gate.dart';

Future<void> main() async {
  // Run the whole app inside a guarded zone so uncaught async errors are
  // reported to Crashlytics instead of silently vanishing.
  runZonedGuarded<Future<void>>(() async {
    WidgetsFlutterBinding.ensureInitialized();
    // Initialize Firebase + register the FCM background handler so incoming
    // calls can ring while the app is backgrounded/locked. Guarded: a no-op
    // until a Firebase config (google-services.json) is added.
    await CallPushService.instance.initEarly();
    // Wire crash + error reporting on top of the initialized Firebase app.
    await Observability.instance.init();

    // In release, replace Flutter's red error screen with a calm fallback card.
    final defaultErrorBuilder = ErrorWidget.builder;
    ErrorWidget.builder = (FlutterErrorDetails details) =>
        kReleaseMode ? const _AppErrorBox() : defaultErrorBuilder(details);

    runApp(const ProviderScope(child: TafsheenApp()));
  }, (error, stack) {
    Observability.instance.recordError(error, stack, fatal: true);
  });
}

class TafsheenApp extends ConsumerWidget {
  const TafsheenApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    // Tag crash reports with the signed-in user (best-effort, id only).
    ref.listen<AuthState>(authControllerProvider, (_, next) {
      Observability.instance.setUser(next.user?.id);
    });

    return MaterialApp.router(
      title: 'Tashfeen',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      // Locked to the polished light theme. The premium cards are designed
      // light-first (white surfaces, light text tokens); honouring the system
      // dark theme made names render dark-on-dark. A dedicated dark theme can
      // be added later as its own design pass.
      themeMode: ThemeMode.light,
      routerConfig: router,
      // Keep the call surface + signaling socket alive above every route, and
      // gate the content behind the optional biometric app lock.
      builder: (context, child) => CallHost(
        child: AppLockGate(child: child ?? const SizedBox()),
      ),
    );
  }
}

/// Calm fallback shown (release only) when a widget subtree throws while
/// building — far friendlier than Flutter's grey/red default.
class _AppErrorBox extends StatelessWidget {
  const _AppErrorBox();

  @override
  Widget build(BuildContext context) {
    return const Material(
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 44, color: Color(0xFFB42318)),
              SizedBox(height: 12),
              Text('Something went wrong',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              SizedBox(height: 6),
              Text('Please go back and try again.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF667085))),
            ],
          ),
        ),
      ),
    );
  }
}

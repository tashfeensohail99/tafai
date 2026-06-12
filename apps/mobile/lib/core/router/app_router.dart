import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_controller.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/auth/presentation/screens/change_password_screen.dart';
import '../../features/shared/presentation/splash_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/leads/presentation/lead_detail_screen.dart';

/// Root navigator — lets non-widget code (e.g. a notification-tap handler)
/// push screens without a BuildContext.
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Route paths — use these constants instead of raw strings.
abstract class AppRoutes {
  static const splash = '/splash';
  static const login = '/login';
  static const forgotPassword = '/forgot-password';
  static const changePassword = '/change-password';
  static const home = '/';
  static const leads = '/leads';
  static const followUps = '/follow-ups';
  static const appointments = '/appointments';
  static const chat = '/chat';
  static const notifications = '/notifications';
  static const settings = '/settings';

  static String leadDetail(String id) => '/leads/$id';
}

/// The app router. Plain Riverpod `Provider` (no code generation). It watches
/// auth state via a refresh notifier and redirects based on the current
/// session: unknown → splash, signed-out → login, must-change-password →
/// change-password, otherwise → the app shell.
final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen<AuthState>(authControllerProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: AppRoutes.splash,
    debugLogDiagnostics: kDebugMode,
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final loc = state.matchedLocation;

      // Session not resolved yet → hold on the splash.
      if (auth.status == AuthStatus.unknown) {
        return loc == AppRoutes.splash ? null : AppRoutes.splash;
      }

      final onAuthPage =
          loc == AppRoutes.login || loc == AppRoutes.forgotPassword;

      if (!auth.isAuthenticated) {
        return onAuthPage ? null : AppRoutes.login;
      }

      // Signed in but a password change is required → force it.
      if (auth.mustChangePassword && loc != AppRoutes.changePassword) {
        return AppRoutes.changePassword;
      }

      // Signed in but sitting on splash/login → go home.
      if (loc == AppRoutes.splash || onAuthPage) {
        return AppRoutes.home;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.forgotPassword,
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: AppRoutes.changePassword,
        builder: (context, state) => const ChangePasswordScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const AppShell(),
      ),
      GoRoute(
        path: AppRoutes.settings,
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/leads/:id',
        builder: (context, state) =>
            LeadDetailScreen(leadId: state.pathParameters['id']!),
      ),
    ],
  );
});

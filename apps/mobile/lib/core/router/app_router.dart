import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_controller.dart';
import '../auth/role_home.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/auth/presentation/screens/change_password_screen.dart';
import '../../features/shared/presentation/splash_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/shell/presentation/finance_shell.dart';
import '../../features/shell/presentation/client_shell.dart';
import '../../features/shell/presentation/processing_shell.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/leads/presentation/lead_detail_screen.dart';
import '../../features/finance/presentation/finance_customer_profile_screen.dart';
import '../../features/finance/presentation/finance_agreement_detail_screen.dart';

/// Root navigator — lets non-widget code (e.g. a notification-tap handler)
/// push screens without a BuildContext.
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Route paths — use these constants instead of raw strings.
abstract class AppRoutes {
  static const splash = '/splash';
  static const login = '/login';
  static const forgotPassword = '/forgot-password';
  static const changePassword = '/change-password';
  static const home = '/'; // Sales shell — also the default/fallback portal.
  static const financeHome = '/finance';
  static const clientHome = '/portal';
  static const processingHome = '/processing';
  static const leads = '/leads';
  static const followUps = '/follow-ups';
  static const appointments = '/appointments';
  static const chat = '/chat';
  static const notifications = '/notifications';
  static const settings = '/settings';

  static String leadDetail(String id) => '/leads/$id';

  // Finance detail routes — flat siblings pushed over the FinanceShell.
  static String financeCustomer(String leadId) => '/finance/customer/$leadId';
  static String financeAgreement(String id) => '/finance/agreements/$id';
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

      // NOTE: we intentionally do NOT force a password change on mobile. The
      // web app never enforced `mustChangePassword`, and most existing accounts
      // carry the flag from admin-provisioning/temp passwords — gating on it
      // here would force the whole team to change their password on first
      // mobile login. Voluntary change stays available in Settings → Change
      // password. (Re-introduce a forced gate only with a deliberate, web-
      // aligned rollout.)

      // Signed in but sitting on splash/login → route to the portal that
      // matches the user's role(s). Sales/admin/etc. resolve to '/' (AppShell).
      if (loc == AppRoutes.splash || onAuthPage) {
        return homeRouteForRoles(auth.user?.roles ?? const []);
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
        path: AppRoutes.financeHome,
        builder: (context, state) => const FinanceShell(),
      ),
      GoRoute(
        path: AppRoutes.clientHome,
        builder: (context, state) => const ClientShell(),
      ),
      GoRoute(
        path: AppRoutes.processingHome,
        builder: (context, state) => const ProcessingShell(),
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
      // Finance detail screens — flat siblings pushed over the FinanceShell.
      GoRoute(
        path: '/finance/customer/:leadId',
        builder: (context, state) => FinanceCustomerProfileScreen(
            leadId: state.pathParameters['leadId']!),
      ),
      GoRoute(
        path: '/finance/agreements/:id',
        builder: (context, state) => FinanceAgreementDetailScreen(
            agreementId: state.pathParameters['id']!),
      ),
    ],
  );
});

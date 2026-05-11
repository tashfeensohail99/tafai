import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/dashboard/presentation/dashboard_screen.dart';

part 'app_router.g.dart';

/// Route name constants — use these instead of raw strings
abstract class AppRoutes {
  static const login = '/login';
  static const dashboard = '/dashboard';
  static const leads = '/leads';
  static const cases = '/cases';
  static const documents = '/documents';
  static const appointments = '/appointments';
}

@riverpod
GoRouter appRouter(AppRouterRef ref) {
  // TODO: watch auth state provider and redirect accordingly
  return GoRouter(
    initialLocation: AppRoutes.login,
    debugLogDiagnostics: false,
    routes: [
      GoRoute(
        path: AppRoutes.login,
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.dashboard,
        name: 'dashboard',
        builder: (context, state) => const DashboardScreen(),
      ),
    ],
    // Redirect unauthenticated users to login
    redirect: (context, state) {
      // TODO: replace with actual auth state check from auth provider
      // final isLoggedIn = ref.read(authStateProvider).isAuthenticated;
      // if (!isLoggedIn && state.matchedLocation != AppRoutes.login) {
      //   return AppRoutes.login;
      // }
      return null;
    },
  );
}

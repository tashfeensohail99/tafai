import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../errors/app_error.dart';
import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/domain/auth_user.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  final AuthStatus status;
  final AuthUser? user;

  const AuthState({required this.status, this.user});

  const AuthState.unknown()
      : status = AuthStatus.unknown,
        user = null;

  bool get isAuthenticated =>
      status == AuthStatus.authenticated && user != null;

  bool get mustChangePassword => user?.mustChangePassword ?? false;
}

/// Owns the session lifecycle: app-start restore, login, logout, profile reload.
/// The router watches this to gate navigation.
class AuthController extends StateNotifier<AuthState> {
  final AuthRepository _repo;

  AuthController(this._repo) : super(const AuthState.unknown()) {
    bootstrap();
  }

  /// App-start: try to restore a session from the stored refresh token.
  Future<void> bootstrap() async {
    try {
      await _repo.refresh(); // throws UnauthorizedError when none/invalid
      final user = await _repo.me();
      state = AuthState(status: AuthStatus.authenticated, user: user);
    } catch (_) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  Future<void> login({
    required String email,
    required String password,
  }) async {
    await _repo.login(email: email, password: password);
    final user = await _repo.me();
    state = AuthState(status: AuthStatus.authenticated, user: user);
  }

  /// Change own password, then reload the profile so `mustChangePassword`
  /// clears and the router lets the user proceed.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _repo.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    await refreshProfile();
  }

  /// Re-fetch the current profile (best-effort; keeps state on transient error).
  Future<void> refreshProfile() async {
    try {
      final user = await _repo.me();
      state = AuthState(status: AuthStatus.authenticated, user: user);
    } on AppError {
      // Leave state as-is; a hard 401 routes through [forceLogout].
    }
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Flip to signed-out without a server round-trip (used on a hard 401).
  void forceLogout() {
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref.watch(authRepositoryProvider));
});

/// Convenience accessor for the current user (or null).
final currentUserProvider = Provider<AuthUser?>((ref) {
  return ref.watch(authControllerProvider).user;
});

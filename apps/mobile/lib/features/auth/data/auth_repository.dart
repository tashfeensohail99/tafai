import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/auth/token_storage.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/auth_user.dart';

class AuthRepository {
  final Dio _client;
  final TokenStorage _tokenStorage;

  AuthRepository(this._client, this._tokenStorage);

  /// Load any persisted access token into memory (cold-start restore — e.g.
  /// the app was relaunched by accepting a call).
  Future<void> restoreSession() => _tokenStorage.restore();

  /// POST /auth/login — returns **tokens only**. Persists them; the caller then
  /// loads the profile via [me]. (The login response intentionally carries no
  /// user object — see API_AUTH_CONTRACT.md.)
  Future<void> login({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/auth/login',
        data: {'email': email, 'password': password},
      );
      await _storeTokens(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /auth/logout — revokes all sessions server-side, then clears local tokens.
  Future<void> logout() async {
    try {
      await _client.post<void>('/auth/logout');
    } on DioException catch (_) {
      // Ignore network errors on logout — clear local tokens regardless.
    } finally {
      await _tokenStorage.clearAll();
    }
  }

  /// POST /auth/refresh — rotate tokens. Throws [UnauthorizedError] when there
  /// is no stored refresh token or it is rejected.
  Future<void> refresh() async {
    final refreshToken = await _tokenStorage.getRefreshToken();
    if (refreshToken == null) throw const UnauthorizedError();
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      await _storeTokens(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /auth/me — current user profile (roles, permissions, employee, flag).
  Future<AuthUser> me() async {
    try {
      final res = await _client.get<Map<String, dynamic>>('/auth/me');
      return AuthUser.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /auth/password/change — change own password.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/auth/password/change',
        data: {
          'currentPassword': currentPassword,
          'newPassword': newPassword,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /auth/password/reset-request — always 200 (no user enumeration).
  Future<void> requestPasswordReset(String email) async {
    try {
      await _client.post<void>(
        '/auth/password/reset-request',
        data: {'email': email},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  Future<void> _storeTokens(Map<String, dynamic> data) async {
    final access = data['accessToken'] as String?;
    if (access != null) _tokenStorage.setAccessToken(access);
    final refreshToken = data['refreshToken'] as String?;
    if (refreshToken != null) {
      await _tokenStorage.saveRefreshToken(refreshToken);
    }
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final client = ref.watch(apiClientProvider);
  final tokenStorage = ref.watch(tokenStorageProvider);
  return AuthRepository(client, tokenStorage);
});

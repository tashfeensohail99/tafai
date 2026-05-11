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

  /// POST /auth/login
  /// Returns the authenticated user and stores tokens.
  Future<AuthUser> login({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/auth/login',
        data: {'email': email, 'password': password},
      );
      final data = res.data!;
      _tokenStorage.setAccessToken(data['accessToken'] as String);
      if (data['refreshToken'] != null) {
        await _tokenStorage.saveRefreshToken(data['refreshToken'] as String);
      }
      return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /auth/logout — revokes all sessions server-side
  Future<void> logout() async {
    try {
      await _client.post<void>('/auth/logout');
    } on DioException catch (_) {
      // Ignore network errors on logout — clear local tokens regardless
    } finally {
      await _tokenStorage.clearAll();
    }
  }

  /// POST /auth/refresh — rotate refresh token
  Future<void> refresh() async {
    final refreshToken = await _tokenStorage.getRefreshToken();
    if (refreshToken == null) throw const UnauthorizedError();
    try {
      final res = await _client.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = res.data!;
      _tokenStorage.setAccessToken(data['accessToken'] as String);
      if (data['refreshToken'] != null) {
        await _tokenStorage.saveRefreshToken(data['refreshToken'] as String);
      }
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /auth/me — fetch current user profile
  Future<AuthUser> me() async {
    try {
      final res = await _client.get<Map<String, dynamic>>('/auth/me');
      return AuthUser.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /auth/password/reset-request
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
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final client = ref.watch(apiClientProvider);
  final tokenStorage = ref.watch(tokenStorageProvider);
  return AuthRepository(client, tokenStorage);
});

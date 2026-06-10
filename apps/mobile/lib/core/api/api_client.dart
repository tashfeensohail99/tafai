import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/token_storage.dart';

const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  // Production API by default so device/emulator builds work out of the box.
  // Override for local dev with --dart-define=API_BASE_URL=http://10.0.2.2:3001
  defaultValue: 'https://backend-production-5a89.up.railway.app',
);

/// Creates a Dio instance with:
/// - JWT bearer injection, restoring the persisted token first when the
///   process was cold-started (e.g. CallKit relaunched the app to answer)
/// - Automatic access-token refresh on 401, SINGLE-FLIGHT so concurrent 401s
///   share one refresh (parallel refreshes rotate the token twice; the loser
///   gets rejected → random "session expired" logouts)
/// - Tokens are only cleared when the server actually REJECTS the refresh
///   token — a network hiccup must never log the rep out
Dio buildApiClient({
  required TokenStorage tokenStorage,
  String baseUrl = _defaultBaseUrl,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ),
  );

  // Single-flight refresh: every 401 while a refresh is already running awaits
  // the same future instead of firing its own /auth/refresh.
  Future<String?>? refreshInFlight;

  Future<String?> refreshOnce() {
    return refreshInFlight ??= () async {
      try {
        final refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken == null) return null;
        final refreshDio = Dio(BaseOptions(baseUrl: baseUrl));
        final res = await refreshDio.post<Map<String, dynamic>>(
          '/auth/refresh',
          data: {'refreshToken': refreshToken},
        );
        final newAccessToken = res.data?['accessToken'] as String?;
        if (newAccessToken == null) return null;
        tokenStorage.setAccessToken(newAccessToken);
        final newRefreshToken = res.data?['refreshToken'] as String?;
        if (newRefreshToken != null) {
          await tokenStorage.saveRefreshToken(newRefreshToken);
        }
        return newAccessToken;
      } on DioException catch (e) {
        // Drop the session only when the server rejected the refresh token.
        // Network errors (flaky data right after a call) keep the tokens so a
        // later request can retry.
        final status = e.response?.statusCode;
        if (status != null && status >= 400 && status < 500) {
          await tokenStorage.clearAll();
        }
        return null;
      } catch (_) {
        return null;
      } finally {
        refreshInFlight = null;
      }
    }();
  }

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Cold start: the in-memory token is gone but the persisted one
        // survives — restore it before the first authenticated request.
        if (tokenStorage.accessToken == null) {
          await tokenStorage.restore();
        }
        final token = tokenStorage.accessToken;
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        final path = error.requestOptions.path;
        final isAuthCall =
            path.contains('/auth/login') || path.contains('/auth/refresh');
        if (error.response?.statusCode == 401 && !isAuthCall) {
          final newAccessToken = await refreshOnce();
          if (newAccessToken != null) {
            try {
              final opts = error.requestOptions;
              opts.headers['Authorization'] = 'Bearer $newAccessToken';
              final retryResponse = await dio.fetch<dynamic>(opts);
              return handler.resolve(retryResponse);
            } catch (_) {
              // Fall through to the original error.
            }
          }
        }
        handler.next(error);
      },
    ),
  );

  return dio;
}

final apiClientProvider = Provider<Dio>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);
  return buildApiClient(tokenStorage: tokenStorage);
});

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/token_storage.dart';

const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3001', // Android emulator → host localhost
);

/// Creates a Dio instance with:
/// - JWT bearer token injection on every request
/// - Automatic access-token refresh on 401 using the refresh token
/// - Proper error mapping
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

  // Inject access token on every request
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        final token = tokenStorage.accessToken;
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode == 401) {
          // Try refresh
          final refreshToken = await tokenStorage.getRefreshToken();
          if (refreshToken != null) {
            try {
              final refreshDio = Dio(BaseOptions(baseUrl: baseUrl));
              final res = await refreshDio.post(
                '/auth/refresh',
                data: {'refreshToken': refreshToken},
              );
              final newAccessToken = res.data['accessToken'] as String;
              final newRefreshToken = res.data['refreshToken'] as String?;

              tokenStorage.setAccessToken(newAccessToken);
              if (newRefreshToken != null) {
                await tokenStorage.saveRefreshToken(newRefreshToken);
              }

              // Retry original request with new token
              final opts = error.requestOptions;
              opts.headers['Authorization'] = 'Bearer $newAccessToken';
              final retryResponse = await dio.fetch(opts);
              return handler.resolve(retryResponse);
            } catch (_) {
              // Refresh failed — force logout
              await tokenStorage.clearAll();
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

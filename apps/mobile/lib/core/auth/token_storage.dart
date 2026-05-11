import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Keys used in secure storage
abstract class _StorageKeys {
  static const accessToken = 'access_token';
  static const refreshToken = 'refresh_token';
}

/// Provider for the secure storage instance
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
});

/// Token storage — reads and writes JWT tokens to the device keychain.
/// Access tokens are stored in memory only to reduce disk writes;
/// refresh tokens are persisted in secure storage.
class TokenStorage {
  final FlutterSecureStorage _storage;

  // In-memory access token (not stored to disk)
  String? _accessToken;

  TokenStorage(this._storage);

  String? get accessToken => _accessToken;

  void setAccessToken(String token) {
    _accessToken = token;
  }

  void clearAccessToken() {
    _accessToken = null;
  }

  Future<void> saveRefreshToken(String token) async {
    await _storage.write(key: _StorageKeys.refreshToken, value: token);
  }

  Future<String?> getRefreshToken() async {
    return _storage.read(key: _StorageKeys.refreshToken);
  }

  Future<void> clearAll() async {
    _accessToken = null;
    await _storage.delete(key: _StorageKeys.refreshToken);
  }
}

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  final storage = ref.watch(secureStorageProvider);
  return TokenStorage(storage);
});

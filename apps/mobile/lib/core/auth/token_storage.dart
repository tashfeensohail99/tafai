import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Keys used in secure storage
abstract class _StorageKeys {
  static const refreshToken = 'refresh_token';
  static const accessToken = 'access_token';
}

/// Provider for the secure storage instance
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
});

/// Token storage — JWTs in the device keychain.
///
/// Both tokens are persisted to encrypted storage so the session SURVIVES an
/// app process restart. This matters because an incoming/accepted call can
/// relaunch the app (CallKit cold-start) or the OEM may kill it in the
/// background — previously the in-memory-only access token was lost on restart,
/// kicking the rep back to login ("session expired right after a call").
class TokenStorage {
  final FlutterSecureStorage _storage;

  /// In-memory copy — authoritative for the running process, mirrored to disk.
  String? _accessToken;

  TokenStorage(this._storage);

  String? get accessToken => _accessToken;

  void setAccessToken(String token) {
    _accessToken = token;
    // Persist (fire-and-forget) so a restart can restore the session.
    _storage
        .write(key: _StorageKeys.accessToken, value: token)
        .catchError((_) {});
  }

  /// Load the persisted access token into memory at app start. Call once during
  /// session bootstrap, before any authenticated request.
  Future<void> restore() async {
    if (_accessToken != null) return;
    try {
      _accessToken = await _storage.read(key: _StorageKeys.accessToken);
    } catch (_) {}
  }

  void clearAccessToken() {
    _accessToken = null;
    _storage.delete(key: _StorageKeys.accessToken).catchError((_) {});
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
    await _storage.delete(key: _StorageKeys.accessToken);
  }
}

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  final storage = ref.watch(secureStorageProvider);
  return TokenStorage(storage);
});

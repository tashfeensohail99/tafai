import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

final LocalAuthentication _localAuth = LocalAuthentication();

/// Whether the user has switched on the biometric / device-credential app lock.
/// Persisted in shared preferences. Defaults OFF so testers are never
/// unexpectedly locked out — they opt in from Settings.
final appLockEnabledProvider =
    StateNotifierProvider<AppLockEnabledNotifier, bool>((ref) {
  return AppLockEnabledNotifier();
});

class AppLockEnabledNotifier extends StateNotifier<bool> {
  AppLockEnabledNotifier() : super(false) {
    _load();
  }

  static const _key = 'appLockEnabled';

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      state = prefs.getBool(_key) ?? false;
    } catch (_) {}
  }

  Future<void> set(bool value) async {
    state = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_key, value);
    } catch (_) {}
  }
}

/// Whether the app is currently locked (content hidden until re-auth).
final appLockedProvider = StateProvider<bool>((ref) => false);

/// True when the device can authenticate (enrolled biometrics OR a device PIN/
/// pattern/passcode). Used to decide whether to even offer the lock toggle.
Future<bool> deviceSupportsLock() async {
  try {
    return await _localAuth.isDeviceSupported();
  } catch (_) {
    return false;
  }
}

/// Prompt the OS biometric / device-credential sheet. Returns true on success.
/// Falls back to PIN/pattern/passcode (biometricOnly: false) so it still works
/// on phones without a fingerprint sensor.
Future<bool> authenticateLock({
  String reason = 'Unlock Tashfeen CRM',
}) async {
  try {
    return await _localAuth.authenticate(
      localizedReason: reason,
      options: const AuthenticationOptions(
        stickyAuth: true,
        biometricOnly: false,
      ),
    );
  } catch (_) {
    return false;
  }
}

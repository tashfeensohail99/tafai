import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shorebird_code_push/shorebird_code_push.dart';

/// Longest report we will send. The backend DTO caps `deviceInfo` at 255 chars
/// and *rejects* anything longer — a 400 there would cost the rep their push
/// token, and with it every incoming call ring. Telemetry must never be able to
/// break registration, so we truncate well short of the limit.
const _maxReportChars = 200;

/// A one-line fingerprint of what this phone is actually running, sent with the
/// FCM token on every app start and stored on `DeviceToken.deviceInfo`.
///
/// This is what makes fleet version spread answerable: which reps are on the
/// current build, and — the part nothing else can tell us — which Shorebird
/// patch actually landed on the device, as opposed to merely being published.
///
///     v1.0.42+44 · patch 3 · Redmi Note 12 · Android 14
///
/// The patch field reads:
/// * `patch N`    — patch N is live on this device
/// * `patch none` — running the base release, no patch applied
/// * `patch n/a`  — build has no Shorebird engine (debug, or a plain
///                  `flutter build` rather than `shorebird release`)
///
/// Every lookup is individually guarded: a device that cannot report its model
/// should still report its version.
Future<String> buildDeviceReport() async {
  final parts = <String>[];

  try {
    final pkg = await PackageInfo.fromPlatform();
    parts.add('v${pkg.version}+${pkg.buildNumber}');
  } catch (_) {
    parts.add('v?');
  }

  parts.add(await _patchLabel());

  try {
    final android = await DeviceInfoPlugin().androidInfo;
    parts.add(android.model);
    parts.add('Android ${android.version.release}');
  } catch (_) {
    // Not Android, or the plugin failed — the version half still has value.
  }

  final report = parts.join(' · ');
  return report.length <= _maxReportChars
      ? report
      : report.substring(0, _maxReportChars);
}

/// Which Shorebird patch is live right now. `readCurrentPatch` is a local read
/// (unlike `checkForUpdate`, which hits the network), so this is safe to call
/// during startup.
Future<String> _patchLabel() async {
  try {
    final updater = ShorebirdUpdater();
    if (!updater.isAvailable) return 'patch n/a';
    final patch = await updater.readCurrentPatch();
    return patch == null ? 'patch none' : 'patch ${patch.number}';
  } catch (_) {
    return 'patch ?';
  }
}

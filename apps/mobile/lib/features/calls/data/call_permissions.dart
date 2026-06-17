import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

/// Snapshot of the permissions the softphone needs.
class CallPermissionState {
  final bool microphone;
  final bool notification;
  final bool overlay; // "Display over other apps" — full-screen ring on lock
  final bool battery; // ignore battery optimization — wake in background
  final bool fullScreenIntent; // Android 14+ "Full screen notifications"

  const CallPermissionState({
    required this.microphone,
    required this.notification,
    required this.overlay,
    required this.battery,
    required this.fullScreenIntent,
  });

  const CallPermissionState.unknown()
      : microphone = false,
        notification = false,
        overlay = false,
        battery = false,
        fullScreenIntent = false;

  /// The permissions calls genuinely cannot work without: the microphone (to
  /// talk) and notifications (to surface an incoming call). The overlay /
  /// full-screen / battery permissions only *improve* lock-screen ringing — and
  /// on some OEM phones they can't be granted at all — so they are recommended,
  /// NOT required. Keeping them out of "essential" stops the setup screen from
  /// treating setup as incomplete and re-opening on every single launch.
  bool get essentialGranted => microphone && notification;

  /// True only when everything — including the lock-screen-ring extras — is
  /// granted; drives the "you're all set" header.
  bool get allGranted =>
      microphone && notification && overlay && battery && fullScreenIntent;
}

/// Wraps the runtime + special-access permission requests the call feature
/// needs. Standard ones (mic, notifications) show the normal Android prompt;
/// the "special access" ones (overlay, battery, full-screen) open the relevant
/// system page.
class CallPermissions {
  Future<CallPermissionState> check() async {
    return CallPermissionState(
      microphone: await Permission.microphone.isGranted,
      notification: await Permission.notification.isGranted,
      overlay: await Permission.systemAlertWindow.isGranted,
      battery: await Permission.ignoreBatteryOptimizations.isGranted,
      fullScreenIntent: await _canUseFullScreenIntent(),
    );
  }

  /// Android 14+: whether the app may post full-screen (ringing) call
  /// notifications. Older Android always allows it.
  Future<bool> _canUseFullScreenIntent() async {
    try {
      final res = await FlutterCallkitIncoming.canUseFullScreenIntent();
      return res is bool ? res : true;
    } catch (_) {
      return true; // older Android / iOS — not gated
    }
  }

  Future<bool> requestMicrophone() async =>
      (await Permission.microphone.request()).isGranted;

  Future<bool> requestNotification() async =>
      (await Permission.notification.request()).isGranted;

  /// Opens the "Display over other apps" system screen.
  Future<bool> requestOverlay() async =>
      (await Permission.systemAlertWindow.request()).isGranted;

  /// Shows the "allow background battery usage" system dialog.
  Future<bool> requestBattery() async =>
      (await Permission.ignoreBatteryOptimizations.request()).isGranted;

  /// Opens the Android 14+ "Full screen notifications" settings page.
  Future<void> requestFullScreenIntent() async {
    try {
      await FlutterCallkitIncoming.requestFullIntentPermission();
    } catch (_) {}
  }

  /// Request the standard runtime prompts up front (mic + notifications).
  Future<void> requestStandard() async {
    await Permission.microphone.request();
    await Permission.notification.request();
  }

  /// Open the app's system settings page (for Autostart / anything the user
  /// must toggle manually on OEM skins like XOS/MIUI).
  Future<void> openSettings() => openAppSettings();
}

final callPermissionsProvider = Provider<CallPermissions>((ref) {
  return CallPermissions();
});

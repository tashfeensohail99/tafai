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

  /// Everything needed to ring like a real call — incl. the Android 14+
  /// full-screen notification permission, without which a locked phone shows
  /// only a small silent notification instead of the ringing call screen.
  bool get essentialGranted =>
      microphone && notification && overlay && fullScreenIntent;

  /// Everything, incl. the recommended battery exemption.
  bool get allGranted => essentialGranted && battery;
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

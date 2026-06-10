import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

/// Snapshot of the permissions the softphone needs.
class CallPermissionState {
  final bool microphone;
  final bool notification;
  final bool overlay; // "Display over other apps" — full-screen ring on lock
  final bool battery; // ignore battery optimization — wake in background

  const CallPermissionState({
    required this.microphone,
    required this.notification,
    required this.overlay,
    required this.battery,
  });

  const CallPermissionState.unknown()
      : microphone = false,
        notification = false,
        overlay = false,
        battery = false;

  /// Mic + notifications + overlay are required to ring like a real call.
  bool get essentialGranted => microphone && notification && overlay;

  /// Everything, incl. the recommended battery exemption.
  bool get allGranted => essentialGranted && battery;
}

/// Wraps the runtime + special-access permission requests the call feature
/// needs. Standard ones (mic, notifications) show the normal Android prompt;
/// the "special access" ones (overlay, battery) open the relevant system page.
class CallPermissions {
  Future<CallPermissionState> check() async {
    return CallPermissionState(
      microphone: await Permission.microphone.isGranted,
      notification: await Permission.notification.isGranted,
      overlay: await Permission.systemAlertWindow.isGranted,
      battery: await Permission.ignoreBatteryOptimizations.isGranted,
    );
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

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../config/api_config.dart';

/// Public website page testers download new builds from.
const String downloadsPageUrl = 'https://tashfeengroup.com/downloads';

/// Result of comparing the running build against the latest published one.
class AppUpdateStatus {
  /// "major.minor.patch+build" of the build the user is running.
  final String currentVersion;

  /// Latest published "major.minor.patch+build", or null if the check failed.
  final String? latestVersion;

  final bool updateAvailable;

  const AppUpdateStatus({
    required this.currentVersion,
    this.latestVersion,
    this.updateAvailable = false,
  });
}

/// Checks the published build manifest (`/public/app/info`) and compares its
/// version+build to ours. Any network/parse failure resolves to "no update", so
/// a flaky check never blocks or nags the user.
final appUpdateProvider = FutureProvider<AppUpdateStatus>((ref) async {
  final info = await PackageInfo.fromPlatform();
  final current = '${info.version}+${info.buildNumber}';
  try {
    final res = await Dio().get<Map<String, dynamic>>(
      '$apiBaseUrl/public/app/info',
      options: Options(
        receiveTimeout: const Duration(seconds: 8),
        sendTimeout: const Duration(seconds: 8),
      ),
    );
    final latest = res.data?['version']?.toString();
    return AppUpdateStatus(
      currentVersion: current,
      latestVersion: latest,
      updateAvailable: latest != null && isNewerVersion(latest, current),
    );
  } catch (_) {
    return AppUpdateStatus(currentVersion: current);
  }
});

/// Compare two "major.minor.patch+build" strings numerically, segment by
/// segment. Returns true when [latest] is strictly greater than [current].
/// Tolerant of missing segments and non-numeric noise.
bool isNewerVersion(String latest, String current) {
  List<int> parse(String v) => v
      .replaceAll('+', '.')
      .split('.')
      .map((p) => int.tryParse(p.trim()) ?? 0)
      .toList();
  final a = parse(latest);
  final b = parse(current);
  final len = a.length > b.length ? a.length : b.length;
  for (var i = 0; i < len; i++) {
    final x = i < a.length ? a[i] : 0;
    final y = i < b.length ? b[i] : 0;
    if (x != y) return x > y;
  }
  return false;
}

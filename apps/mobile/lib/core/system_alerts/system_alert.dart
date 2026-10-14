import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';

/// One active service-health alert, as returned by `GET /system/alerts`.
class SystemAlert {
  final String key;
  final String severity; // 'critical' | 'warning'
  final String title;
  final String message;

  const SystemAlert({
    required this.key,
    required this.severity,
    required this.title,
    required this.message,
  });

  /// Anything that isn't an explicit 'warning' is treated as critical (red), so
  /// an unexpected/blank severity still reads as "something is wrong".
  bool get isCritical => severity != 'warning';

  factory SystemAlert.fromJson(Map<String, dynamic> json) => SystemAlert(
        key: json['key']?.toString() ?? '',
        severity: json['severity']?.toString() ?? 'critical',
        title: json['title']?.toString() ?? '',
        message: json['message']?.toString() ?? '',
      );
}

/// Polls `GET /system/alerts` every 60s so reps see an outage banner within a
/// minute of the sentinel raising it — e.g. "WhatsApp sending is temporarily
/// down, use calls" — instead of silently hitting a dead channel. Emits [] when
/// everything is healthy, and FAILS CLOSED (empty) on any network / auth / parse
/// error so the banner can never wedge the app. Mirrors the web SystemAlertBanner.
final systemAlertsProvider =
    StreamProvider.autoDispose<List<SystemAlert>>((ref) async* {
  final dio = ref.watch(apiClientProvider);

  Future<List<SystemAlert>> fetchOnce() async {
    try {
      final res = await dio.get<dynamic>('/system/alerts');
      final data = res.data;
      if (data is! List) return const <SystemAlert>[];
      return data
          .whereType<Map>()
          .map((m) => SystemAlert.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    } catch (_) {
      // Fail closed: a flaky check, a 401 mid-refresh, or a 500 (incl. the DB
      // being the outage — which alerts by email anyway) must never show a
      // false banner or block the shell.
      return const <SystemAlert>[];
    }
  }

  yield await fetchOnce();
  await for (final _ in Stream<void>.periodic(const Duration(seconds: 60))) {
    yield await fetchOnce();
  }
});

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/call_history.dart';

/// REST client for the WhatsApp call-control endpoints (controller prefix
/// `/whatsapp/calls`, all behind JwtAuthGuard). Mirrors the web CallDock's
/// `apiFetch` calls 1:1 so the same backend contract serves both clients.
class CallApi {
  final Dio _c;
  CallApi(this._c);

  /// GET /whatsapp/calls/ice → { iceServers: [...] }
  /// Returns the array ready to drop into createPeerConnection({'iceServers': …}).
  Future<List<Map<String, dynamic>>> getIceServers() async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/whatsapp/calls/ice');
      final raw = res.data?['iceServers'];
      if (raw is List) {
        return raw
            .whereType<Map>()
            .map((m) => m.map((k, v) => MapEntry(k.toString(), v)))
            .toList();
      }
      return const [];
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/calls/{id} → { id, status, leadId, sdpOffer }
  /// The inbound SDP offer to answer. Throws if the offer is missing.
  Future<String> getInboundOffer(String callId) async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/whatsapp/calls/$callId');
      final sdp = res.data?['sdpOffer'] as String?;
      if (sdp == null || sdp.isEmpty) {
        throw const _NoOffer();
      }
      return sdp;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/outbound { threadId, sdpOffer } → { callId }
  Future<String> startOutbound({
    required String threadId,
    required String sdpOffer,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/whatsapp/calls/outbound',
        data: {'threadId': threadId, 'sdpOffer': sdpOffer},
      );
      final id = res.data?['callId'] as String?;
      if (id == null || id.isEmpty) {
        throw const _NoCallId();
      }
      return id;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/{id}/pre-accept { sdpAnswer } — Meta-recommended
  /// early media: sent while the call is still RINGING so ICE/DTLS warm up
  /// during the ring; the real answer() then carries the SAME SDP and audio
  /// starts near-instantly. Best-effort — a failure just means the classic
  /// (slower) accept path.
  Future<void> preAccept(String callId, String sdpAnswer) async {
    try {
      await _c.post<dynamic>(
        '/whatsapp/calls/$callId/pre-accept',
        data: {'sdpAnswer': sdpAnswer},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/{id}/answer { sdpAnswer }
  Future<void> answer(String callId, String sdpAnswer) async {
    try {
      await _c.post<dynamic>(
        '/whatsapp/calls/$callId/answer',
        data: {'sdpAnswer': sdpAnswer},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/{id}/heartbeat — liveness ping while connected so the
  /// backend sweeper can free the leg if this app dies. Fire-and-forget.
  Future<void> heartbeat(String callId) async {
    try {
      await _c.post<dynamic>('/whatsapp/calls/$callId/heartbeat');
    } on DioException catch (_) {
      // best-effort; a missed beat is fine, never surface
    }
  }

  /// POST /whatsapp/calls/{id}/stats — per-call quality CDR (ICE path, RTT,
  /// jitter, loss, bytes) + the rep's networkType (wifi/cellular) + platform.
  /// Best-effort telemetry; a failure must never surface to the call.
  Future<void> recordStats(String callId, Map<String, dynamic> stats) async {
    try {
      await _c.post<dynamic>('/whatsapp/calls/$callId/stats', data: stats);
    } on DioException catch (_) {
      // best-effort; losing a CDR sample is fine, never surface
    }
  }

  /// GET /whatsapp/calls/mine → the rep's own call log (assigned or answered).
  /// filter via [direction] (INBOUND/OUTBOUND) and [status] (MISSED/ENDED/…).
  Future<CallHistoryPage> myCalls({
    int limit = 60,
    DateTime? before,
    String? direction,
    String? status,
  }) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/whatsapp/calls/mine',
        queryParameters: {
          'limit': limit,
          if (before != null) 'before': before.toUtc().toIso8601String(),
          if (direction != null) 'direction': direction,
          if (status != null) 'status': status,
        },
      );
      final items = (res.data?['items'] as List? ?? const [])
          .whereType<Map>()
          .map((m) => CallHistoryItem.fromJson(
              m.map((k, v) => MapEntry(k.toString(), v))))
          .toList();
      final nb = res.data?['nextBefore'] as String?;
      return CallHistoryPage(items, nb != null ? DateTime.tryParse(nb) : null);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /whatsapp/calls/mine/missed-count → { count } for the Calls-tab badge.
  /// Best-effort: a failure yields 0 so the badge never blocks the shell.
  Future<int> myMissedCount() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/whatsapp/calls/mine/missed-count');
      return (res.data?['count'] as num?)?.toInt() ?? 0;
    } on DioException catch (_) {
      return 0;
    }
  }

  /// POST /whatsapp/calls/{id}/reject
  Future<void> reject(String callId) async {
    try {
      await _c.post<dynamic>('/whatsapp/calls/$callId/reject');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/{id}/hangup
  Future<void> hangup(String callId) async {
    try {
      await _c.post<dynamic>('/whatsapp/calls/$callId/hangup');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/permission { threadId } — ask the customer to allow
  /// calls when an outbound is blocked for missing opt-in.
  Future<void> requestPermission(String threadId) async {
    try {
      await _c.post<dynamic>(
        '/whatsapp/calls/permission',
        data: {'threadId': threadId},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /whatsapp/calls/{id}/recording (multipart, field `file`).
  Future<void> uploadRecording({
    required String callId,
    required String filePath,
    required String fileName,
  }) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      await _c.post<dynamic>(
        '/whatsapp/calls/$callId/recording',
        data: form,
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /devices/register { token, platform, deviceInfo } — register this
  /// device's FCM token so the backend can ring it with a high-priority push.
  Future<void> registerDevice({
    required String token,
    String platform = 'ANDROID',
    String? deviceInfo,
  }) async {
    try {
      await _c.post<dynamic>(
        '/devices/register',
        data: {
          'token': token,
          'platform': platform,
          if (deviceInfo != null) 'deviceInfo': deviceInfo,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

class _NoOffer implements Exception {
  const _NoOffer();
  @override
  String toString() => 'No SDP offer for this call';
}

class _NoCallId implements Exception {
  const _NoCallId();
  @override
  String toString() => 'Server did not return a call id';
}

final callApiProvider = Provider<CallApi>((ref) {
  return CallApi(ref.watch(apiClientProvider));
});

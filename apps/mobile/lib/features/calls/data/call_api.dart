import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';

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

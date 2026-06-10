import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/config/api_config.dart';
import '../domain/call_models.dart';

/// Wraps the Socket.IO connection to the backend `/whatsapp/realtime` gateway.
/// The gateway authenticates from `handshake.auth.token` (the JWT access token)
/// and, on connect, joins the per-employee room — so this client only has to
/// connect with the rep's token and listen for the three call events. Call
/// rings are fanned out to the rep's room by the backend; no client-side join.
class RealtimeService {
  io.Socket? _socket;
  final _events = StreamController<RealtimeCallEvent>.broadcast();
  bool _connected = false;
  String? _token;

  /// Broadcast stream of inbound call signaling events.
  Stream<RealtimeCallEvent> get events => _events.stream;

  bool get isConnected => _connected;

  /// (Re)connect with the given JWT. No-op if already connected with the same
  /// token. Safe to call repeatedly (e.g. on auth refresh / app resume).
  void connect(String token) {
    if (_socket != null && _token == token && _connected) return;
    // Token changed or first connect → tear down any stale socket first.
    if (_socket != null) {
      _disposeSocket();
    }
    _token = token;

    final socket = io.io(
      apiBaseUrl,
      <String, dynamic>{
        'path': '/whatsapp/realtime',
        'transports': ['websocket'],
        'autoConnect': false,
        'forceNew': true,
        'auth': {'token': token},
        // Resilience: keep retrying with backoff if the network drops.
        'reconnection': true,
        'reconnectionAttempts': double.infinity,
        'reconnectionDelay': 1000,
        'reconnectionDelayMax': 8000,
      },
    );

    socket.onConnect((_) {
      _connected = true;
      if (kDebugMode) debugPrint('[realtime] connected');
    });
    socket.onDisconnect((_) {
      _connected = false;
      if (kDebugMode) debugPrint('[realtime] disconnected');
    });
    socket.onConnectError((e) {
      _connected = false;
      if (kDebugMode) debugPrint('[realtime] connect_error: $e');
    });

    socket.on('whatsapp.call.incoming', (data) {
      final map = _asMap(data);
      if (map != null) _events.add(CallIncoming.fromJson(map));
    });
    socket.on('whatsapp.call.answered', (data) {
      final map = _asMap(data);
      if (map != null) _events.add(CallAnswered.fromJson(map));
    });
    socket.on('whatsapp.call.ended', (data) {
      final map = _asMap(data);
      if (map != null) _events.add(CallEnded.fromJson(map));
    });

    socket.connect();
    _socket = socket;
  }

  void disconnect() {
    _disposeSocket();
    _token = null;
    _connected = false;
  }

  void _disposeSocket() {
    final s = _socket;
    _socket = null;
    if (s != null) {
      try {
        s.dispose();
      } catch (_) {}
    }
  }

  void dispose() {
    _disposeSocket();
    _events.close();
  }

  static Map<String, dynamic>? _asMap(dynamic data) {
    if (data is Map) {
      return data.map((k, v) => MapEntry(k.toString(), v));
    }
    return null;
  }
}

final realtimeServiceProvider = Provider<RealtimeService>((ref) {
  final svc = RealtimeService();
  ref.onDispose(svc.dispose);
  return svc;
});

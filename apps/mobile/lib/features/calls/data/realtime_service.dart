import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/config/api_config.dart';
import '../domain/call_models.dart';

/// Wraps the Socket.IO connection to the backend `/whatsapp/realtime` gateway.
/// The gateway authenticates from `handshake.auth.token` (the JWT access token)
/// and, on connect, joins the per-employee room — call rings are fanned out to
/// that room, so this client only has to stay connected and listen.
///
/// Reconnection is managed HERE (socket.io's built-in reconnect is disabled):
/// the built-in path re-sends the token captured at connect time, so once that
/// access token expired every reconnect was rejected ("Unauthorized") and the
/// app silently stopped receiving incoming-call rings. Each retry now awaits
/// [_tokenProvider] for a FRESH token first.
class RealtimeService {
  io.Socket? _socket;
  final _events = StreamController<RealtimeCallEvent>.broadcast();
  bool _connected = false;
  bool _enabled = false;
  bool _connecting = false;
  Future<String?> Function()? _tokenProvider;
  Timer? _retryTimer;
  int _retryAttempt = 0;

  /// Broadcast stream of inbound call signaling events.
  Stream<RealtimeCallEvent> get events => _events.stream;

  bool get isConnected => _connected;

  /// Enable the connection. [tokenProvider] is awaited before every
  /// (re)connect attempt so the handshake always carries a valid token.
  /// Safe to call repeatedly.
  void start(Future<String?> Function() tokenProvider) {
    _tokenProvider = tokenProvider;
    _enabled = true;
    _retryAttempt = 0;
    _connect();
  }

  /// Kick a reconnect if we're enabled but not connected (e.g. on app resume —
  /// OEMs like XOS freeze sockets in the background).
  void ensureConnected() {
    if (_enabled && !_connected && !_connecting) {
      _retryAttempt = 0;
      _connect();
    }
  }

  Future<void> _connect() async {
    if (!_enabled || _connecting) return;
    _connecting = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    try {
      final token = await _tokenProvider?.call();
      if (!_enabled) return;
      if (token == null || token.isEmpty) {
        _scheduleRetry();
        return;
      }

      _disposeSocket();
      final socket = io.io(
        apiBaseUrl,
        <String, dynamic>{
          'path': '/whatsapp/realtime',
          'transports': ['websocket'],
          'autoConnect': false,
          'forceNew': true,
          'auth': {'token': token},
          // Built-in reconnection re-uses the (possibly expired) handshake
          // token forever — we retry ourselves with a fresh one instead.
          'reconnection': false,
        },
      );

      socket.onConnect((_) {
        _connected = true;
        _retryAttempt = 0;
        if (kDebugMode) debugPrint('[realtime] connected');
      });
      socket.onDisconnect((_) {
        _connected = false;
        if (kDebugMode) debugPrint('[realtime] disconnected');
        _scheduleRetry();
      });
      socket.onConnectError((e) {
        _connected = false;
        if (kDebugMode) debugPrint('[realtime] connect_error: $e');
        _scheduleRetry();
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
    } finally {
      _connecting = false;
    }
  }

  void _scheduleRetry() {
    if (!_enabled || _retryTimer != null) return;
    // 2s, 4s, 8s, 16s, then 30s forever.
    final seconds = math.min(30, 2 << math.min(_retryAttempt, 3));
    _retryAttempt++;
    _retryTimer = Timer(Duration(seconds: seconds), () {
      _retryTimer = null;
      _connect();
    });
  }

  void disconnect() {
    _enabled = false;
    _tokenProvider = null;
    _retryTimer?.cancel();
    _retryTimer = null;
    _disposeSocket();
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
    disconnect();
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

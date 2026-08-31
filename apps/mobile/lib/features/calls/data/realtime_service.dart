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
/// Thin org-room WhatsApp message/thread event. Payloads carry IDS ONLY (the
/// backend publishes {threadId, messageId, ...}) — consumers refetch what they
/// need (the thread screen runs a delta syncTail, the inbox a quietReload), so
/// there is no payload-shape coupling to the server.
class RealtimeMessageEvent {
  /// 'new' (whatsapp.message.new) | 'status' (whatsapp.message.status) |
  /// 'thread' (whatsapp.thread.updated).
  final String kind;
  final String? threadId;
  const RealtimeMessageEvent(this.kind, this.threadId);
}

class RealtimeService {
  io.Socket? _socket;
  final _events = StreamController<RealtimeCallEvent>.broadcast();
  final _messageEvents = StreamController<RealtimeMessageEvent>.broadcast();
  bool _connected = false;
  bool _enabled = false;
  bool _connecting = false;
  Future<String?> Function()? _tokenProvider;
  Timer? _retryTimer;
  int _retryAttempt = 0;

  /// Broadcast stream of inbound call signaling events.
  Stream<RealtimeCallEvent> get events => _events.stream;

  /// Broadcast stream of WhatsApp message/thread events (org room). The
  /// gateway already fans these out to every connected agent — the app just
  /// never listened before Patch 7; messaging rode a 5s poll instead.
  Stream<RealtimeMessageEvent> get messageEvents => _messageEvents.stream;

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

  /// The socket may be a ZOMBIE: an OEM background-freeze can kill the TCP
  /// connection without the client noticing for up to the engine's ping
  /// timeout (~45s), during which `isConnected` is a stale true — so
  /// [ensureConnected] no-ops and consumers (the thread poll's 20s relaxed
  /// cadence, call rings) trust a dead pipe. Called after a LONG background
  /// stretch: drop the flag and rebuild the connection outright (forceNew
  /// tears the old socket down); a healthy reconnect re-proves liveness in
  /// one round trip.
  void markSuspect() {
    if (!_enabled) return;
    _connected = false;
    _retryAttempt = 0;
    _connect();
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

      socket.on('whatsapp.message.new', (data) {
        _messageEvents.add(
            RealtimeMessageEvent('new', _asMap(data)?['threadId']?.toString()));
      });
      socket.on('whatsapp.message.status', (data) {
        _messageEvents.add(RealtimeMessageEvent(
            'status', _asMap(data)?['threadId']?.toString()));
      });
      socket.on('whatsapp.thread.updated', (data) {
        _messageEvents.add(RealtimeMessageEvent(
            'thread', _asMap(data)?['threadId']?.toString()));
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
    _messageEvents.close();
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

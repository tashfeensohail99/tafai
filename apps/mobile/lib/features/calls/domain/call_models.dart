// Domain models for the in-app WhatsApp softphone.

enum CallDirection { inbound, outbound }

/// Lifecycle of a single call, mirroring the web CallDock phases.
enum CallPhase {
  idle, // nothing happening
  dialing, // outbound: created PC, waiting for backend callId / customer answer
  ringing, // inbound: ring screen shown, awaiting Accept/Decline
  connecting, // SDP exchanged, ICE negotiating
  inCall, // media connected
  reconnecting, // media hiccup — grace period before giving up
  ended, // finished (brief terminal state before reset)
  error, // something failed
}

/// The realtime signaling events we care about (from /whatsapp/realtime).
sealed class RealtimeCallEvent {
  const RealtimeCallEvent();
}

class CallIncoming extends RealtimeCallEvent {
  final String callId;
  final String from;
  final String? leadName;
  final String? leadId;
  final String? threadId;
  const CallIncoming({
    required this.callId,
    required this.from,
    this.leadName,
    this.leadId,
    this.threadId,
  });

  factory CallIncoming.fromJson(Map<String, dynamic> j) => CallIncoming(
        callId: j['callId'] as String,
        from: j['from'] as String? ?? '',
        leadName: j['leadName'] as String?,
        leadId: j['leadId'] as String?,
        threadId: j['threadId'] as String?,
      );
}

class CallAnswered extends RealtimeCallEvent {
  final String callId;
  final String sdpAnswer;
  const CallAnswered({required this.callId, required this.sdpAnswer});

  factory CallAnswered.fromJson(Map<String, dynamic> j) => CallAnswered(
        callId: j['callId'] as String,
        sdpAnswer: j['sdpAnswer'] as String? ?? '',
      );
}

class CallEnded extends RealtimeCallEvent {
  final String callId;
  const CallEnded({required this.callId});

  factory CallEnded.fromJson(Map<String, dynamic> j) =>
      CallEnded(callId: j['callId'] as String);
}

/// Snapshot of the current (single) call for the UI.
class CallState {
  final CallPhase phase;
  final CallDirection? direction;

  /// Internal WhatsAppCall id. Null for outbound until the backend returns it.
  final String? callId;
  final String? threadId;
  final String? leadId;

  final String peerName;
  final String peerPhone;

  final bool muted;
  final bool speakerOn;
  final int durationSeconds;
  final String? errorText;

  /// A SECOND inbound call that arrived while this one is already active
  /// (call-waiting). Surfaced as a WhatsApp-style banner over the live call —
  /// the rep can End & Accept it or Decline. Null when there's no waiting call.
  final CallIncoming? waiting;

  const CallState({
    required this.phase,
    this.direction,
    this.callId,
    this.threadId,
    this.leadId,
    this.peerName = '',
    this.peerPhone = '',
    this.muted = false,
    this.speakerOn = false,
    this.durationSeconds = 0,
    this.errorText,
    this.waiting,
  });

  const CallState.idle() : this(phase: CallPhase.idle);

  bool get isInbound => direction == CallDirection.inbound;
  bool get isOutbound => direction == CallDirection.outbound;

  /// Whether a call card/overlay should be visible.
  bool get isActive => phase != CallPhase.idle;

  String get displayName => peerName.trim().isNotEmpty ? peerName : peerPhone;

  CallState copyWith({
    CallPhase? phase,
    CallDirection? direction,
    String? callId,
    String? threadId,
    String? leadId,
    String? peerName,
    String? peerPhone,
    bool? muted,
    bool? speakerOn,
    int? durationSeconds,
    String? errorText,
    bool clearError = false,
    CallIncoming? waiting,
    bool clearWaiting = false,
  }) {
    return CallState(
      phase: phase ?? this.phase,
      direction: direction ?? this.direction,
      callId: callId ?? this.callId,
      threadId: threadId ?? this.threadId,
      leadId: leadId ?? this.leadId,
      peerName: peerName ?? this.peerName,
      peerPhone: peerPhone ?? this.peerPhone,
      muted: muted ?? this.muted,
      speakerOn: speakerOn ?? this.speakerOn,
      durationSeconds: durationSeconds ?? this.durationSeconds,
      errorText: clearError ? null : (errorText ?? this.errorText),
      waiting: clearWaiting ? null : (waiting ?? this.waiting),
    );
  }

  /// Human m:ss timer.
  String get timerLabel {
    final m = durationSeconds ~/ 60;
    final s = durationSeconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  /// Status line under the name.
  String get statusLabel => switch (phase) {
        CallPhase.dialing => 'Calling…',
        CallPhase.ringing => 'Incoming WhatsApp call',
        // OUTBOUND sits in `connecting` while the CUSTOMER'S phone is still
        // ringing — Meta warms the media path during ringback, so we reach
        // 'connected' before they pick up. Showing "Connecting…" there reads as
        // "the system is stuck", so reps hang up on calls that were ringing
        // perfectly well. INBOUND is genuinely connecting (rep already answered).
        CallPhase.connecting => isOutbound ? 'Ringing…' : 'Connecting…',
        CallPhase.inCall => timerLabel,
        CallPhase.reconnecting => 'Reconnecting…',
        CallPhase.ended => 'Call ended',
        CallPhase.error => errorText ?? 'Call failed',
        CallPhase.idle => '',
      };
}

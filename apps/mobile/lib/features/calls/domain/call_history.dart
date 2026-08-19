import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/call_api.dart';

/// One row in the rep's Calls tab — a past call they own (assigned or answered).
/// Mirrors the backend `GET /whatsapp/calls/mine` item shape.
class CallHistoryItem {
  final String id;
  final String direction; // INBOUND | OUTBOUND
  final String status; // ENDED | MISSED | ANSWERED | RINGING | FAILED
  final String? phone;
  final String? contactName;
  final String? contactType; // lead | client
  final String? leadId;
  final String? clientId;
  final String? threadId;
  final int? durationSeconds;
  final DateTime createdAt;
  final bool hasRecording;

  const CallHistoryItem({
    required this.id,
    required this.direction,
    required this.status,
    required this.createdAt,
    this.phone,
    this.contactName,
    this.contactType,
    this.leadId,
    this.clientId,
    this.threadId,
    this.durationSeconds,
    this.hasRecording = false,
  });

  bool get isMissed => status == 'MISSED';
  bool get isInbound => direction == 'INBOUND';
  bool get isConnected => status == 'ENDED' || status == 'ANSWERED';

  String get displayName {
    final n = contactName?.trim();
    if (n != null && n.isNotEmpty) return n;
    return phone ?? 'Unknown';
  }

  factory CallHistoryItem.fromJson(Map<String, dynamic> j) => CallHistoryItem(
        id: j['id'] as String,
        direction: (j['direction'] as String?) ?? 'INBOUND',
        status: (j['status'] as String?) ?? '',
        phone: j['phone'] as String?,
        contactName: j['contactName'] as String?,
        contactType: j['contactType'] as String?,
        leadId: j['leadId'] as String?,
        clientId: j['clientId'] as String?,
        threadId: j['threadId'] as String?,
        durationSeconds: (j['durationSeconds'] as num?)?.toInt(),
        createdAt:
            DateTime.tryParse(j['createdAt']?.toString() ?? '')?.toLocal() ??
                DateTime.fromMillisecondsSinceEpoch(0),
        hasRecording: (j['hasRecording'] as bool?) ?? false,
      );
}

class CallHistoryPage {
  final List<CallHistoryItem> items;
  final DateTime? nextBefore;
  const CallHistoryPage(this.items, this.nextBefore);
}

/// The rep's unread missed-inbound-call count (last 24h) — the badge on the
/// Calls tab. Refreshed by the shell's periodic poll.
final myMissedCallCountProvider = FutureProvider.autoDispose<int>((ref) async {
  return ref.watch(callApiProvider).myMissedCount();
});

/// Rep's call history for a given filter key: 'all' | 'missed' | 'incoming' |
/// 'outgoing'. Read-only first page (newest 60); pull-to-refresh re-fetches.
final callsHistoryProvider =
    FutureProvider.autoDispose.family<CallHistoryPage, String>((ref, filter) async {
  final api = ref.watch(callApiProvider);
  String? direction;
  String? status;
  switch (filter) {
    case 'missed':
      status = 'MISSED';
      direction = 'INBOUND';
      break;
    case 'incoming':
      direction = 'INBOUND';
      break;
    case 'outgoing':
      direction = 'OUTBOUND';
      break;
  }
  return api.myCalls(direction: direction, status: status);
});

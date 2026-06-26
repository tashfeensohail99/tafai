import '../../../core/util/parsers.dart';

/// The lead or client a thread is with (subset the API returns on a thread).
class WaParty {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String? status;
  /// Block lives on the CONTACT (Lead/Client). Non-null = this contact is
  /// currently blocked. May be absent on list payloads; present on detail.
  final DateTime? blockedAt;

  const WaParty({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.status,
    this.blockedAt,
  });

  String get fullName => '$firstName $lastName'.trim();

  /// A copy with the block cleared (used to reflect unblock locally).
  WaParty unblocked() => WaParty(
        id: id,
        firstName: firstName,
        lastName: lastName,
        phone: phone,
        status: status,
      );

  factory WaParty.fromJson(Map<String, dynamic> j) => WaParty(
        id: j['id'] as String? ?? '',
        firstName: j['firstName'] as String? ?? '',
        lastName: j['lastName'] as String? ?? '',
        phone: j['phone'] as String? ?? '',
        status: asStringOrNull(j['status']),
        blockedAt: parseApiDateOrNull(j['blockedAt']),
      );
}

/// A WhatsApp conversation. Mirrors the backend `ThreadListItem` / `ThreadDetail`
/// (the detail is a superset; we parse the fields we need from either).
class WhatsappThread {
  final String id;
  final String status; // OPEN | PENDING | RESOLVED | ARCHIVED
  final String waContactId;
  /// The WhatsApp channel (business number) this conversation belongs to.
  /// Templates are per-channel, so the composer must fetch templates for THIS
  /// channel — not just whichever channel happens to be listed first.
  final String? channelId;
  final DateTime? windowExpiresAt;
  final bool awaitingReply;
  final DateTime? lastHumanReplyAt;
  final DateTime? lastMessageAt;
  final String? lastMessagePreview;
  final int unreadCount;
  final bool? aiEnabled;
  /// Meta WhatsApp call permission for this contact: null (never asked) |
  /// PENDING | GRANTED | REJECTED. GRANTED (+ not past expiry) means we can
  /// place a business-initiated call.
  final String? callPermissionStatus;
  final DateTime? callPermissionExpiresAt;
  final WaParty? lead;
  final WaParty? client;

  const WhatsappThread({
    required this.id,
    required this.status,
    required this.waContactId,
    this.channelId,
    this.windowExpiresAt,
    this.awaitingReply = false,
    this.lastHumanReplyAt,
    this.lastMessageAt,
    this.lastMessagePreview,
    this.unreadCount = 0,
    this.aiEnabled,
    this.callPermissionStatus,
    this.callPermissionExpiresAt,
    this.lead,
    this.client,
  });

  WhatsappThread copyWith({
    String? status,
    WaParty? lead,
    WaParty? client,
  }) =>
      WhatsappThread(
        id: id,
        status: status ?? this.status,
        waContactId: waContactId,
        channelId: channelId,
        windowExpiresAt: windowExpiresAt,
        awaitingReply: awaitingReply,
        lastHumanReplyAt: lastHumanReplyAt,
        lastMessageAt: lastMessageAt,
        lastMessagePreview: lastMessagePreview,
        unreadCount: unreadCount,
        aiEnabled: aiEnabled,
        callPermissionStatus: callPermissionStatus,
        callPermissionExpiresAt: callPermissionExpiresAt,
        lead: lead ?? this.lead,
        client: client ?? this.client,
      );

  WaParty? get party => lead ?? client;
  String get displayName {
    final n = party?.fullName ?? '';
    return n.isNotEmpty ? n : waContactId;
  }

  String get phone => party?.phone.isNotEmpty == true ? party!.phone : waContactId;
  String? get leadId => lead?.id;

  /// Thread has been archived (status flips to ARCHIVED on archive/block).
  bool get isArchived => status == 'ARCHIVED';

  /// The contact (Lead or Client) is currently blocked.
  bool get isBlocked =>
      lead?.blockedAt != null || client?.blockedAt != null;

  /// No human has ever replied — bot greeting only ("Uncontacted").
  bool get isUncontacted => lastHumanReplyAt == null;

  /// 24h customer-service window still open → free-text allowed.
  bool get windowOpen =>
      windowExpiresAt != null && windowExpiresAt!.isAfter(DateTime.now());

  /// Customer has granted WhatsApp-call permission (and it hasn't expired) →
  /// we can place a business-initiated call now.
  bool get canCall =>
      callPermissionStatus == 'GRANTED' &&
      (callPermissionExpiresAt == null ||
          callPermissionExpiresAt!.isAfter(DateTime.now()));

  factory WhatsappThread.fromJson(Map<String, dynamic> j) => WhatsappThread(
        id: j['id'] as String,
        status: j['status'] as String? ?? 'OPEN',
        waContactId: j['waContactId'] as String? ?? '',
        channelId: (j['channel'] is Map<String, dynamic>
                ? (j['channel'] as Map<String, dynamic>)['id'] as String?
                : null) ??
            j['channelId'] as String?,
        windowExpiresAt: parseApiDateOrNull(j['windowExpiresAt']),
        awaitingReply: j['awaitingReply'] as bool? ?? false,
        lastHumanReplyAt: parseApiDateOrNull(j['lastHumanReplyAt']),
        lastMessageAt: parseApiDateOrNull(j['lastMessageAt']),
        lastMessagePreview: asStringOrNull(j['lastMessagePreview']),
        unreadCount: asInt(j['unreadCount']),
        aiEnabled: j['aiEnabled'] as bool?,
        callPermissionStatus: asStringOrNull(j['callPermissionStatus']),
        callPermissionExpiresAt: parseApiDateOrNull(j['callPermissionExpiresAt']),
        lead: j['lead'] is Map<String, dynamic>
            ? WaParty.fromJson(j['lead'] as Map<String, dynamic>)
            : null,
        client: j['client'] is Map<String, dynamic>
            ? WaParty.fromJson(j['client'] as Map<String, dynamic>)
            : null,
      );
}

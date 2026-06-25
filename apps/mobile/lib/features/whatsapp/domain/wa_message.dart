import '../../../core/util/parsers.dart';

/// A single WhatsApp message. Mirrors the backend `ChatMessage`.
class ChatMessage {
  final String id;
  final String direction; // INBOUND | OUTBOUND
  final String type; // TEXT | IMAGE | VIDEO | AUDIO | DOCUMENT | TEMPLATE | ...
  final String status; // QUEUED | SENDING | SENT | DELIVERED | READ | FAILED | RECEIVED
  final String? body;
  final String? mediaUrl;
  final String? mediaMimeType;
  final String? templateName;
  final String? errorCode;
  final String? errorTitle;
  final String? waMessageId; // Meta's id — the key a reply quotes
  final String? repliedToWaMessageId; // set when this message quotes another
  final DateTime createdAt;
  final DateTime? sentAt;
  final DateTime? deliveredAt;
  final DateTime? readAt;
  final DateTime? failedAt;

  const ChatMessage({
    required this.id,
    required this.direction,
    required this.type,
    required this.status,
    this.body,
    this.mediaUrl,
    this.mediaMimeType,
    this.templateName,
    this.errorCode,
    this.errorTitle,
    this.waMessageId,
    this.repliedToWaMessageId,
    required this.createdAt,
    this.sentAt,
    this.deliveredAt,
    this.readAt,
    this.failedAt,
  });

  bool get isOutbound => direction == 'OUTBOUND';
  bool get isFailed => status == 'FAILED';
  bool get isText => type == 'TEXT';
  bool get isMedia =>
      type == 'IMAGE' ||
      type == 'VIDEO' ||
      type == 'AUDIO' ||
      type == 'DOCUMENT' ||
      type == 'STICKER';

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: j['id'] as String,
        direction: j['direction'] as String? ?? 'OUTBOUND',
        type: j['type'] as String? ?? 'TEXT',
        status: j['status'] as String? ?? 'SENT',
        body: asStringOrNull(j['body']),
        mediaUrl: asStringOrNull(j['mediaUrl']),
        mediaMimeType: asStringOrNull(j['mediaMimeType']),
        templateName: asStringOrNull(j['templateName']),
        errorCode: asStringOrNull(j['errorCode']),
        errorTitle: asStringOrNull(j['errorTitle']),
        waMessageId: asStringOrNull(j['waMessageId']),
        repliedToWaMessageId: asStringOrNull(j['repliedToWaMessageId']),
        createdAt: parseApiDate(j['createdAt']),
        sentAt: parseApiDateOrNull(j['sentAt']),
        deliveredAt: parseApiDateOrNull(j['deliveredAt']),
        readAt: parseApiDateOrNull(j['readAt']),
        failedAt: parseApiDateOrNull(j['failedAt']),
      );
}

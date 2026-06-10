import '../../../core/util/parsers.dart';

/// A bell notification. Mirrors the backend `Notification` row.
class AppNotification {
  final String id;
  final String type;
  final String title;
  final String? body;
  final String? link; // relative deep-link path, e.g. /sales/leads/<id>
  final bool read;
  final DateTime? readAt;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    this.link,
    this.read = false,
    this.readAt,
    required this.createdAt,
  });

  bool get isUnread => !read;

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['id'] as String,
        type: j['type'] as String? ?? '',
        title: j['title'] as String? ?? 'Notification',
        body: asStringOrNull(j['body']),
        link: asStringOrNull(j['link']),
        read: j['read'] as bool? ?? false,
        readAt: parseApiDateOrNull(j['readAt']),
        createdAt: parseApiDate(j['createdAt']),
      );
}

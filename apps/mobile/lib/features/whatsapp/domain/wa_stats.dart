import '../../../core/util/parsers.dart';

/// Inbox tab-badge counts (server-side, over the whole table — not the page).
/// Mirrors `GET /whatsapp/threads/stats`.
class ThreadStats {
  final int total;
  final int uncontacted;
  final int awaitingReply;
  final int followUpDue;
  final int unread;
  final int resolved;
  final int archived;
  final int blocked;

  const ThreadStats({
    required this.total,
    required this.uncontacted,
    required this.awaitingReply,
    required this.followUpDue,
    required this.unread,
    required this.resolved,
    this.archived = 0,
    this.blocked = 0,
  });

  /// "Open" = a human has replied at least once = total − uncontacted.
  int get open => (total - uncontacted).clamp(0, total);

  static const empty = ThreadStats(
    total: 0,
    uncontacted: 0,
    awaitingReply: 0,
    followUpDue: 0,
    unread: 0,
    resolved: 0,
    archived: 0,
    blocked: 0,
  );

  factory ThreadStats.fromJson(Map<String, dynamic> j) => ThreadStats(
        total: asInt(j['total']),
        uncontacted: asInt(j['uncontacted']),
        awaitingReply: asInt(j['awaitingReply']),
        followUpDue: asInt(j['followUpDue']),
        unread: asInt(j['unread']),
        resolved: asInt(j['resolved']),
        archived: asInt(j['archived']),
        blocked: asInt(j['blocked']),
      );
}

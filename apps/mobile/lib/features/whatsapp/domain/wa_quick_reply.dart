/// Saved chat snippet for the composer (NOT a Meta template — those are the
/// pre-approved forms used outside the 24h window).
class QuickReply {
  final String id;
  final String title;
  final String body;
  final bool isTeam;

  const QuickReply({
    required this.id,
    required this.title,
    required this.body,
    required this.isTeam,
  });

  factory QuickReply.fromJson(Map<String, dynamic> j) => QuickReply(
        id: j['id'] as String,
        title: j['title'] as String? ?? '',
        body: j['body'] as String? ?? '',
        isTeam: j['ownerUserId'] == null,
      );
}

class QuickReplyList {
  final List<QuickReply> team;
  final List<QuickReply> mine;
  final bool canManageTeam;

  const QuickReplyList({
    required this.team,
    required this.mine,
    required this.canManageTeam,
  });

  factory QuickReplyList.fromJson(Map<String, dynamic> j) => QuickReplyList(
        team: ((j['team'] as List?) ?? const [])
            .map((e) => QuickReply.fromJson(e as Map<String, dynamic>))
            .toList(),
        mine: ((j['mine'] as List?) ?? const [])
            .map((e) => QuickReply.fromJson(e as Map<String, dynamic>))
            .toList(),
        canManageTeam: j['canManageTeam'] == true,
      );
}

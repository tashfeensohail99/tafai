import '../../../core/util/parsers.dart';

/// GET /leads/dashboard-summary — one-shot counts + 5 recent leads for the
/// sales home screen.
class LeadDashboardSummary {
  final int activeLeads;
  final int handovers;
  final int adminAssigned;
  final int autoAssigned;
  final int adminToday;
  final int autoToday;
  final int overdue;
  final List<PipelineStage> pipeline;
  final List<RecentLead> recentLeads;

  const LeadDashboardSummary({
    required this.activeLeads,
    required this.handovers,
    required this.adminAssigned,
    required this.autoAssigned,
    required this.adminToday,
    required this.autoToday,
    required this.overdue,
    required this.pipeline,
    required this.recentLeads,
  });

  factory LeadDashboardSummary.fromJson(Map<String, dynamic> json) =>
      LeadDashboardSummary(
        activeLeads: asInt(json['activeLeads']),
        handovers: asInt(json['handovers']),
        adminAssigned: asInt(json['adminAssigned']),
        autoAssigned: asInt(json['autoAssigned']),
        adminToday: asInt(json['adminToday']),
        autoToday: asInt(json['autoToday']),
        overdue: asInt(json['overdue']),
        pipeline: (json['pipeline'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(PipelineStage.fromJson)
            .toList(),
        recentLeads: (json['recentLeads'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(RecentLead.fromJson)
            .toList(),
      );
}

class PipelineStage {
  final String stage;
  final int count;
  const PipelineStage({required this.stage, required this.count});

  factory PipelineStage.fromJson(Map<String, dynamic> json) => PipelineStage(
        stage: json['stage'] as String? ?? '',
        count: asInt(json['count']),
      );
}

class RecentLead {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String stage;
  final String? priority;
  final DateTime assignedAt;
  final String? targetCountry;
  final String? serviceInterest;

  const RecentLead({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    required this.stage,
    this.priority,
    required this.assignedAt,
    this.targetCountry,
    this.serviceInterest,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory RecentLead.fromJson(Map<String, dynamic> json) => RecentLead(
        id: json['id'] as String,
        firstName: json['firstName'] as String? ?? '',
        lastName: json['lastName'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        stage: json['stage'] as String? ?? 'NEW',
        priority: asStringOrNull(json['priority']),
        assignedAt: parseApiDate(json['assignedAt']),
        targetCountry: asStringOrNull(json['targetCountry']),
        serviceInterest: asStringOrNull(json['serviceInterest']),
      );
}

/// GET /leads/my-stats — sidebar counters + SLA score.
class MySalesStats {
  final int assignedLeads;
  final int openFollowUps;
  final int overdueFollowUps;
  final int slaScore;

  const MySalesStats({
    required this.assignedLeads,
    required this.openFollowUps,
    required this.overdueFollowUps,
    required this.slaScore,
  });

  factory MySalesStats.fromJson(Map<String, dynamic> json) => MySalesStats(
        assignedLeads: asInt(json['assignedLeads']),
        openFollowUps: asInt(json['openFollowUps']),
        overdueFollowUps: asInt(json['overdueFollowUps']),
        slaScore: asInt(json['slaScore'], 100),
      );
}

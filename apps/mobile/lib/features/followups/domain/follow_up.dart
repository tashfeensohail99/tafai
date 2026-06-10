import '../../../core/util/parsers.dart';

const kFollowUpBuckets = ['overdue', 'today', 'upcoming'];

String followUpBucketLabel(String b) => switch (b) {
      'overdue' => 'Overdue',
      'today' => 'Today',
      'upcoming' => 'Upcoming',
      _ => b,
    };

String followUpPriorityLabel(String? p) => switch (p) {
      'URGENT' => 'Urgent',
      'HIGH' => 'High',
      'MEDIUM' => 'Medium',
      'LOW' => 'Low',
      _ => p ?? '',
    };

/// A sales follow-up task. Mirrors the backend `ApiFollowUp` shape.
class FollowUp {
  final String id;
  final String leadId;
  final String title;
  final String? description;
  final String? contactMethod; // CALL | WHATSAPP | EMAIL | IN_PERSON ...
  final DateTime dueAt;
  final String status; // OPEN | COMPLETED | CANCELLED
  final String? priority; // LOW | MEDIUM | HIGH | URGENT
  final String? outcomeNotes;
  final DateTime? completedAt;
  final FollowUpLead? lead;

  const FollowUp({
    required this.id,
    required this.leadId,
    required this.title,
    this.description,
    this.contactMethod,
    required this.dueAt,
    required this.status,
    this.priority,
    this.outcomeNotes,
    this.completedAt,
    this.lead,
  });

  bool get isOpen => status == 'OPEN';

  String get leadName {
    final n = lead?.fullName.trim() ?? '';
    return n.isEmpty ? 'Lead' : n;
  }

  factory FollowUp.fromJson(Map<String, dynamic> json) => FollowUp(
        id: json['id'] as String,
        leadId: json['leadId'] as String? ?? '',
        title: json['title'] as String? ?? 'Follow-up',
        description: asStringOrNull(json['description']),
        contactMethod: asStringOrNull(json['contactMethod']),
        dueAt: parseApiDate(json['dueAt']),
        status: json['status'] as String? ?? 'OPEN',
        priority: asStringOrNull(json['priority']),
        outcomeNotes: asStringOrNull(json['outcomeNotes']),
        completedAt: parseApiDateOrNull(json['completedAt']),
        lead: json['lead'] is Map<String, dynamic>
            ? FollowUpLead.fromJson(json['lead'] as Map<String, dynamic>)
            : null,
      );
}

class FollowUpLead {
  final String id;
  final String firstName;
  final String lastName;

  const FollowUpLead({
    required this.id,
    required this.firstName,
    required this.lastName,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory FollowUpLead.fromJson(Map<String, dynamic> json) => FollowUpLead(
        id: json['id'] as String? ?? '',
        firstName: json['firstName'] as String? ?? '',
        lastName: json['lastName'] as String? ?? '',
      );
}

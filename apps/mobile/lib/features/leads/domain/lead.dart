import '../../../core/util/parsers.dart';

/// Backend `LeadStatus` enum values (raw, on the wire).
const kLeadStatuses = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL_SENT',
  'FOLLOW_UP',
  'CONVERTED',
  'LOST',
];

/// Backend `LeadPriority` enum values.
const kLeadPriorities = ['HOT', 'WARM', 'COLD'];

String leadStatusLabel(String status) => switch (status) {
      'NEW' => 'New',
      'CONTACTED' => 'Contacted',
      'QUALIFIED' => 'Qualified',
      'PROPOSAL_SENT' => 'Proposal sent',
      'FOLLOW_UP' => 'Follow-up',
      'CONVERTED' => 'Converted',
      'LOST' => 'Lost',
      _ => status,
    };

String leadPriorityLabel(String? priority) => switch (priority) {
      'HOT' => 'Hot',
      'WARM' => 'Warm',
      'COLD' => 'Cold',
      _ => priority ?? '—',
    };

/// A sales lead. Mirrors the backend `ApiLead` shape (raw enums).
class Lead {
  final String id;
  final String? referenceCode;
  final String firstName;
  final String lastName;
  final String phone;
  final String? email;
  final bool emailVerified;
  final String? targetCountry;
  final String? serviceInterest;
  final String? sourceChannel;
  final String status; // LeadStatus
  final String? priority; // HOT | WARM | COLD
  final String? notes;
  final String? serviceFeeAmount; // decimal-as-string
  final String? serviceFeeCurrency;
  final LeadAssignee? assignedEmployee;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int appointmentsCount;

  const Lead({
    required this.id,
    this.referenceCode,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.email,
    required this.emailVerified,
    this.targetCountry,
    this.serviceInterest,
    this.sourceChannel,
    required this.status,
    this.priority,
    this.notes,
    this.serviceFeeAmount,
    this.serviceFeeCurrency,
    this.assignedEmployee,
    required this.createdAt,
    required this.updatedAt,
    this.appointmentsCount = 0,
  });

  String get fullName => '$firstName $lastName'.trim();
  String get statusLabel => leadStatusLabel(status);
  String get priorityLabel => leadPriorityLabel(priority);
  bool get isConverted => status == 'CONVERTED';
  bool get isLost => status == 'LOST';

  factory Lead.fromJson(Map<String, dynamic> json) {
    final count = json['_count'];
    return Lead(
      id: json['id'] as String,
      referenceCode: asStringOrNull(json['referenceCode']),
      firstName: json['firstName'] as String? ?? '',
      lastName: json['lastName'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      email: asStringOrNull(json['email']),
      emailVerified: json['emailVerified'] as bool? ?? false,
      targetCountry: asStringOrNull(json['targetCountry']),
      serviceInterest: asStringOrNull(json['serviceInterest']),
      sourceChannel: asStringOrNull(json['sourceChannel']),
      status: json['status'] as String? ?? 'NEW',
      priority: asStringOrNull(json['priority']),
      notes: asStringOrNull(json['notes']),
      serviceFeeAmount: asStringOrNull(json['serviceFeeAmount']),
      serviceFeeCurrency: asStringOrNull(json['serviceFeeCurrency']),
      assignedEmployee: json['assignedEmployee'] is Map<String, dynamic>
          ? LeadAssignee.fromJson(json['assignedEmployee'] as Map<String, dynamic>)
          : null,
      createdAt: parseApiDate(json['createdAt']),
      updatedAt: parseApiDate(json['updatedAt']),
      appointmentsCount:
          count is Map<String, dynamic> ? asInt(count['appointments']) : 0,
    );
  }
}

class LeadAssignee {
  final String id;
  final String firstName;
  final String lastName;

  const LeadAssignee({
    required this.id,
    required this.firstName,
    required this.lastName,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory LeadAssignee.fromJson(Map<String, dynamic> json) => LeadAssignee(
        id: json['id'] as String? ?? '',
        firstName: json['firstName'] as String? ?? '',
        lastName: json['lastName'] as String? ?? '',
      );
}

/// A file attached to a lead.
class LeadFile {
  final String id;
  final String leadId;
  final String fileName;
  final String? fileMimeType;
  final int? fileSizeBytes;
  final DateTime createdAt;

  const LeadFile({
    required this.id,
    required this.leadId,
    required this.fileName,
    this.fileMimeType,
    this.fileSizeBytes,
    required this.createdAt,
  });

  factory LeadFile.fromJson(Map<String, dynamic> json) => LeadFile(
        id: json['id'] as String,
        leadId: json['leadId'] as String? ?? '',
        fileName: json['fileName'] as String? ?? 'file',
        fileMimeType: asStringOrNull(json['fileMimeType']),
        fileSizeBytes:
            json['fileSizeBytes'] == null ? null : asInt(json['fileSizeBytes']),
        createdAt: parseApiDate(json['createdAt']),
      );
}

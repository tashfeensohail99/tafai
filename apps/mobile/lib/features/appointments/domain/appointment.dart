import '../../../core/util/parsers.dart';

/// Statuses that still represent a live future booking (reschedule/cancel ok).
const _activeStatuses = {'SCHEDULED', 'CONFIRMED', 'RESCHEDULED'};

/// Appointment types accepted by the backend (free-form string, max 60).
const kAppointmentTypes = <String>[
  'OFFICE_MEETING',
  'VIDEO_CALL',
  'PHONE_CONSULT',
  'OFFICE_VISIT',
];

String appointmentTypeLabel(String type) => switch (type.toUpperCase()) {
      'OFFICE_MEETING' => 'Office meeting',
      'VIDEO_CALL' => 'Video call',
      'PHONE_CONSULT' => 'Phone consult',
      'OFFICE_VISIT' => 'Office visit',
      _ => type,
    };

String appointmentStatusLabel(String status) => switch (status) {
      'SCHEDULED' => 'Scheduled',
      'CONFIRMED' => 'Confirmed',
      'COMPLETED' => 'Completed',
      'CANCELLED' => 'Cancelled',
      'NO_SHOW' => 'No-show',
      'RESCHEDULED' => 'Rescheduled',
      _ => status,
    };

/// The lead/client an appointment is with (subset selected by the API).
class AppointmentContact {
  final String id;
  final String firstName;
  final String lastName;
  final String? phone;

  const AppointmentContact({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.phone,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory AppointmentContact.fromJson(Map<String, dynamic> j) =>
      AppointmentContact(
        id: j['id'] as String? ?? '',
        firstName: j['firstName'] as String? ?? '',
        lastName: j['lastName'] as String? ?? '',
        phone: asStringOrNull(j['phone']),
      );
}

/// An appointment. Mirrors the backend `ApiAppointment` shape (raw enums).
class Appointment {
  final String id;
  final String? leadId;
  final String? clientId;
  final String? assignedEmployeeId;
  final String title;
  final String appointmentType;
  final String status;
  final DateTime scheduledAt;
  final int durationMinutes;
  final String? location;
  final String? meetingLink;
  final String? notes;
  final AppointmentContact? lead;
  final AppointmentContact? client;
  final String? caseNumber;

  const Appointment({
    required this.id,
    this.leadId,
    this.clientId,
    this.assignedEmployeeId,
    required this.title,
    required this.appointmentType,
    required this.status,
    required this.scheduledAt,
    required this.durationMinutes,
    this.location,
    this.meetingLink,
    this.notes,
    this.lead,
    this.client,
    this.caseNumber,
  });

  AppointmentContact? get contact => lead ?? client;
  String get contactName {
    final n = contact?.fullName ?? '';
    return n.isNotEmpty ? n : title;
  }

  String? get contactPhone => contact?.phone;
  DateTime get endsAt => scheduledAt.add(Duration(minutes: durationMinutes));
  bool get isActive => _activeStatuses.contains(status);
  bool get canReschedule => isActive;
  bool get canCancel => isActive;
  String get typeLabel => appointmentTypeLabel(appointmentType);
  String get statusLabel => appointmentStatusLabel(status);

  factory Appointment.fromJson(Map<String, dynamic> j) {
    final dur = asInt(j['durationMinutes']);
    final caseObj = j['case'];
    return Appointment(
      id: j['id'] as String,
      leadId: asStringOrNull(j['leadId']),
      clientId: asStringOrNull(j['clientId']),
      assignedEmployeeId: asStringOrNull(j['assignedEmployeeId']),
      title: j['title'] as String? ?? 'Appointment',
      appointmentType: j['appointmentType'] as String? ?? 'OFFICE_MEETING',
      status: j['status'] as String? ?? 'SCHEDULED',
      scheduledAt: parseApiDate(j['scheduledAt']),
      durationMinutes: dur > 0 ? dur : 30,
      location: asStringOrNull(j['location']),
      meetingLink: asStringOrNull(j['meetingLink']),
      notes: asStringOrNull(j['notes']),
      lead: j['lead'] is Map<String, dynamic>
          ? AppointmentContact.fromJson(j['lead'] as Map<String, dynamic>)
          : null,
      client: j['client'] is Map<String, dynamic>
          ? AppointmentContact.fromJson(j['client'] as Map<String, dynamic>)
          : null,
      caseNumber: caseObj is Map<String, dynamic>
          ? asStringOrNull(caseObj['caseNumber'])
          : null,
    );
  }
}

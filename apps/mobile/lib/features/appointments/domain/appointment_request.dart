import '../../../core/util/parsers.dart';

String modalityLabel(String? m) => switch ((m ?? '').toUpperCase()) {
      'CALL' => 'Phone call',
      'VIDEO' => 'Video call',
      'IN_PERSON' => 'Office visit',
      _ => 'Unspecified',
    };

/// The appointment type to pre-select when booking from a request's modality.
String appointmentTypeForModality(String? m) => switch ((m ?? '').toUpperCase()) {
      'CALL' => 'PHONE_CONSULT',
      'VIDEO' => 'VIDEO_CALL',
      'IN_PERSON' => 'OFFICE_VISIT',
      _ => 'OFFICE_MEETING',
    };

class AppointmentRequestLead {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String? assignedName;

  const AppointmentRequestLead({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.assignedName,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory AppointmentRequestLead.fromJson(Map<String, dynamic> j) {
    final ae = j['assignedEmployee'];
    String? assigned;
    if (ae is Map) {
      final n = '${ae['firstName'] ?? ''} ${ae['lastName'] ?? ''}'.trim();
      assigned = n.isEmpty ? null : n;
    }
    return AppointmentRequestLead(
      id: j['id'] as String? ?? '',
      firstName: j['firstName'] as String? ?? '',
      lastName: j['lastName'] as String? ?? '',
      phone: j['phone'] as String? ?? '',
      assignedName: assigned,
    );
  }
}

/// A bot-captured booking intent. Mirrors the backend `AppointmentRequest`.
class AppointmentRequest {
  final String id;
  final String leadId;
  final String? threadId;
  final String rawText;
  final String? preferredDay;
  final String? preferredTime;
  final String? modality;
  final String status;
  final DateTime createdAt;
  final AppointmentRequestLead? lead;

  const AppointmentRequest({
    required this.id,
    required this.leadId,
    this.threadId,
    required this.rawText,
    this.preferredDay,
    this.preferredTime,
    this.modality,
    required this.status,
    required this.createdAt,
    this.lead,
  });

  String get contactName {
    final n = lead?.fullName ?? '';
    return n.isNotEmpty ? n : 'Lead';
  }

  String get intent {
    final parts = [preferredDay, preferredTime]
        .where((x) => x != null && x.trim().isNotEmpty)
        .map((x) => x!.trim())
        .toList();
    return parts.isEmpty ? 'Time unspecified' : parts.join(' · ');
  }

  factory AppointmentRequest.fromJson(Map<String, dynamic> j) =>
      AppointmentRequest(
        id: j['id'] as String,
        leadId: j['leadId'] as String? ?? '',
        threadId: asStringOrNull(j['threadId']),
        rawText: j['rawText'] as String? ?? '',
        preferredDay: asStringOrNull(j['preferredDay']),
        preferredTime: asStringOrNull(j['preferredTime']),
        modality: asStringOrNull(j['modality']),
        status: j['status'] as String? ?? 'PENDING',
        createdAt: parseApiDate(j['createdAt']),
        lead: j['lead'] is Map<String, dynamic>
            ? AppointmentRequestLead.fromJson(j['lead'] as Map<String, dynamic>)
            : null,
      );
}

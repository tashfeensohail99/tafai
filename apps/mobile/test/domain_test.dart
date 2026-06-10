import 'package:flutter_test/flutter_test.dart';
import 'package:tafsheen_mobile/features/appointments/domain/appointment.dart';
import 'package:tafsheen_mobile/features/appointments/domain/appointment_request.dart';
import 'package:tafsheen_mobile/features/leads/domain/lead.dart';
import 'package:tafsheen_mobile/features/notifications/domain/app_notification.dart';
import 'package:tafsheen_mobile/features/whatsapp/domain/wa_stats.dart';
import 'package:tafsheen_mobile/features/whatsapp/domain/wa_thread.dart';

void main() {
  test('Lead.fromJson maps enums + computes fullName', () {
    final l = Lead.fromJson({
      'id': 'l1',
      'firstName': 'Jutt',
      'lastName': '',
      'phone': '923001234567',
      'status': 'CONTACTED',
      'priority': 'HOT',
      'emailVerified': false,
      'createdAt': '2026-06-10T00:00:00Z',
      'updatedAt': '2026-06-10T00:00:00Z',
    });
    expect(l.fullName, 'Jutt');
    expect(l.statusLabel, 'Contacted');
    expect(l.priorityLabel, 'Hot');
    expect(l.isConverted, isFalse);
  });

  test('Appointment.fromJson falls back duration + labels', () {
    final a = Appointment.fromJson({
      'id': 'a1',
      'title': 'Consultation',
      'appointmentType': 'OFFICE_MEETING',
      'status': 'SCHEDULED',
      'scheduledAt': '2026-06-10T04:00:00Z',
      'durationMinutes': 0,
      'lead': {'id': 'l1', 'firstName': 'Asim', 'lastName': 'Rasool', 'phone': 'x'},
    });
    expect(a.durationMinutes, 30); // 0 → default
    expect(a.contactName, 'Asim Rasool');
    expect(a.typeLabel, 'Office meeting');
    expect(a.canReschedule, isTrue); // SCHEDULED is active
  });

  test('WhatsappThread uncontacted + window flags', () {
    final uncontacted = WhatsappThread.fromJson({
      'id': 't1',
      'status': 'OPEN',
      'waContactId': '923001234567',
      'awaitingReply': true,
      'lastHumanReplyAt': null,
      'unreadCount': 3,
      'lastMessagePreview': 'hi',
      'windowExpiresAt': '2999-01-01T00:00:00Z',
      'lead': {
        'id': 'l1',
        'firstName': 'Abdul',
        'lastName': 'Ahad',
        'phone': '923001234567',
        'status': 'CONTACTED',
      },
    });
    expect(uncontacted.displayName, 'Abdul Ahad');
    expect(uncontacted.isUncontacted, isTrue);
    expect(uncontacted.windowOpen, isTrue);
    expect(uncontacted.unreadCount, 3);
    expect(uncontacted.leadId, 'l1');

    final contacted = WhatsappThread.fromJson({
      'id': 't2',
      'status': 'OPEN',
      'waContactId': 'x',
      'lastHumanReplyAt': '2026-06-10T00:00:00Z',
      'windowExpiresAt': '2000-01-01T00:00:00Z',
    });
    expect(contacted.isUncontacted, isFalse);
    expect(contacted.windowOpen, isFalse); // expired
    expect(contacted.displayName, 'x'); // falls back to waContactId
  });

  test('ThreadStats.open = total - uncontacted (clamped)', () {
    final s = ThreadStats.fromJson({
      'total': 657,
      'uncontacted': 210,
      'awaitingReply': 75,
      'followUpDue': 53,
      'unread': 12,
      'resolved': 4,
    });
    expect(s.open, 447);

    final weird = ThreadStats.fromJson({'total': 5, 'uncontacted': 10});
    expect(weird.open, 0); // clamped, never negative
  });

  test('AppNotification.fromJson', () {
    final n = AppNotification.fromJson({
      'id': 'n1',
      'type': 'FOLLOWUP_DUE',
      'title': 'Follow-up due',
      'body': 'Call Ali',
      'link': '/sales/follow-ups',
      'read': false,
      'createdAt': '2026-06-10T00:00:00Z',
    });
    expect(n.isUnread, isTrue);
    expect(n.link, '/sales/follow-ups');
    expect(n.title, 'Follow-up due');
  });

  test('AppointmentRequest.fromJson intent + modality + agent', () {
    final r = AppointmentRequest.fromJson({
      'id': 'r1',
      'leadId': 'l1',
      'rawText': 'kal subah call karna',
      'preferredDay': 'Monday',
      'preferredTime': 'morning',
      'modality': 'CALL',
      'status': 'PENDING',
      'createdAt': '2026-06-10T00:00:00Z',
      'lead': {
        'id': 'l1',
        'firstName': 'Ali',
        'lastName': 'Khan',
        'phone': '92300',
        'assignedEmployee': {'firstName': 'Iffat', 'lastName': 'Hanif'},
      },
    });
    expect(r.contactName, 'Ali Khan');
    expect(r.intent, 'Monday · morning');
    expect(modalityLabel(r.modality), 'Phone call');
    expect(appointmentTypeForModality(r.modality), 'PHONE_CONSULT');
    expect(r.lead?.assignedName, 'Iffat Hanif');
  });
}

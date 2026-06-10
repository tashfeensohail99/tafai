import '../../../core/util/parsers.dart';

/// An open 30-minute slot (UTC instants on the wire).
class TimeSlot {
  final DateTime start;
  final DateTime end;
  const TimeSlot(this.start, this.end);

  factory TimeSlot.fromJson(Map<String, dynamic> j) =>
      TimeSlot(parseApiDate(j['start']), parseApiDate(j['end']));
}

/// An existing booking blocking part of the day.
class BusyInterval {
  final String id;
  final String title;
  final DateTime start;
  final DateTime end;
  const BusyInterval({
    required this.id,
    required this.title,
    required this.start,
    required this.end,
  });

  factory BusyInterval.fromJson(Map<String, dynamic> j) => BusyInterval(
        id: j['id'] as String? ?? '',
        title: j['title'] as String? ?? 'Busy',
        start: parseApiDate(j['start']),
        end: parseApiDate(j['end']),
      );
}

/// GET /appointments/availability response — an agent's free/busy for a PKT day.
class AvailabilityDay {
  final DateTime workStart;
  final DateTime workEnd;
  final List<BusyInterval> busy;
  final List<TimeSlot> freeSlots;

  const AvailabilityDay({
    required this.workStart,
    required this.workEnd,
    required this.busy,
    required this.freeSlots,
  });

  factory AvailabilityDay.fromJson(Map<String, dynamic> j) => AvailabilityDay(
        workStart: parseApiDate(j['workStart']),
        workEnd: parseApiDate(j['workEnd']),
        busy: (j['busy'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(BusyInterval.fromJson)
            .toList(),
        freeSlots: (j['freeSlots'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(TimeSlot.fromJson)
            .toList(),
      );
}

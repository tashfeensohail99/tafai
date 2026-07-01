import 'package:intl/intl.dart';

/// Display formatters. All inputs are treated as UTC-on-the-wire and rendered
/// in the device's local time zone.

String formatDate(DateTime d) => DateFormat('d MMM yyyy').format(d.toLocal());

String formatDateTime(DateTime d) =>
    DateFormat('d MMM yyyy, h:mm a').format(d.toLocal());

String formatTime(DateTime d) => DateFormat('h:mm a').format(d.toLocal());

String formatDayLabel(DateTime d) => DateFormat('EEE, d MMM').format(d.toLocal());

/// Compact relative time ("just now", "5m ago", "3h ago", "2d ago", then date).
/// Handles future instants too ("in 10m") for upcoming reminders/appointments.
String relativeTime(DateTime d) {
  final local = d.toLocal();
  final now = DateTime.now();
  if (local.isAfter(now)) {
    final f = local.difference(now);
    if (f.inMinutes < 1) return 'now';
    if (f.inMinutes < 60) return 'in ${f.inMinutes}m';
    if (f.inHours < 24) return 'in ${f.inHours}h';
    if (f.inDays < 7) return 'in ${f.inDays}d';
    return formatDate(d);
  }
  final diff = now.difference(local);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return formatDate(d);
}

/// WhatsApp-style conversation-list timestamp: today → time ("3:45 PM"),
/// yesterday → "Yesterday", within the last week → weekday ("Monday"), older →
/// date ("21 Jun", or "21 Jun 2025" for a prior year). Rendered in local time.
/// Clearer than relativeTime ("2d ago") for the inbox list, matching WhatsApp.
String chatTimestamp(DateTime d) {
  final local = d.toLocal();
  final now = DateTime.now();
  final startToday = DateTime(now.year, now.month, now.day);
  final startThat = DateTime(local.year, local.month, local.day);
  final dayDiff = startToday.difference(startThat).inDays;
  if (dayDiff <= 0) return DateFormat('h:mm a').format(local); // today (or future)
  if (dayDiff == 1) return 'Yesterday';
  if (dayDiff < 7) return DateFormat('EEEE').format(local); // Monday…
  if (local.year == now.year) return DateFormat('d MMM').format(local); // 21 Jun
  return DateFormat('d MMM yyyy').format(local);
}

/// Local-calendar-day bucket key, for grouping messages into date sections in
/// the chat thread. Two instants share a key iff they fall on the same day.
String chatDayKey(DateTime d) {
  final l = d.toLocal();
  return '${l.year}-${l.month}-${l.day}';
}

/// WhatsApp-style day-separator label shown between message groups in the chat
/// thread: Today / Yesterday / weekday (last 7 days) / full date. Mirrors the
/// web chat panel's formatDaySeparator so both surfaces read identically.
String chatDaySeparator(DateTime d) {
  final local = d.toLocal();
  final now = DateTime.now();
  final startToday = DateTime(now.year, now.month, now.day);
  final startThat = DateTime(local.year, local.month, local.day);
  final dayDiff = startToday.difference(startThat).inDays;
  if (dayDiff <= 0) return 'Today';
  if (dayDiff == 1) return 'Yesterday';
  if (dayDiff < 7) return DateFormat('EEEE').format(local); // Monday…
  return DateFormat('d MMM yyyy').format(local);
}

// --- Pakistan Standard Time (UTC+5, no DST) --------------------------------
// Appointment office-hours, availability slots and business-day logic are all
// PKT on the backend. These render an instant in PKT wall-clock regardless of
// the device's own time zone, so the times always read as the office hours the
// sales team expects (a rep travelling abroad still sees 9:00 AM, not 4:00 AM).

DateTime _pktWall(DateTime d) {
  final p = d.toUtc().add(const Duration(hours: 5));
  // Re-wrap as a local-flagged DateTime carrying the PKT wall-clock fields so
  // intl formats those fields verbatim (no implicit toLocal() conversion).
  return DateTime(p.year, p.month, p.day, p.hour, p.minute, p.second);
}

/// "9:00 AM" — PKT wall-clock, timezone-independent.
String pktTime(DateTime d) {
  final p = _pktWall(d);
  final h12 = p.hour % 12 == 0 ? 12 : p.hour % 12;
  final ampm = p.hour < 12 ? 'AM' : 'PM';
  return '$h12:${p.minute.toString().padLeft(2, '0')} $ampm';
}

/// "Mon, 10 Jun" in PKT.
String pktDate(DateTime d) => DateFormat('EEE, d MMM').format(_pktWall(d));

/// "Mon, 10 Jun · 9:00 AM" in PKT.
String pktDateTime(DateTime d) => '${pktDate(d)} · ${pktTime(d)}';

/// Human file size: "2.4 MB", "812 KB".
String formatBytes(int? bytes) {
  if (bytes == null || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  var size = bytes.toDouble();
  var unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  final str = unit == 0 ? size.toStringAsFixed(0) : size.toStringAsFixed(1);
  return '$str ${units[unit]}';
}

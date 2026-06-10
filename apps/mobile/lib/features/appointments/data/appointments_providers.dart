import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/appointment.dart';
import '../domain/availability.dart';
import 'appointments_repository.dart';

/// Active upcoming appointments (now → future), soonest first. Cancelled /
/// completed / no-show rows are filtered out so this tab shows only live work.
final upcomingAppointmentsProvider =
    FutureProvider.autoDispose<List<Appointment>>((ref) async {
  final repo = ref.watch(appointmentsRepositoryProvider);
  final items = await repo.list(from: DateTime.now());
  final active = items.where((a) => a.isActive).toList()
    ..sort((a, b) => a.scheduledAt.compareTo(b.scheduledAt));
  return active;
});

/// Past / closed appointments, most recent first.
final pastAppointmentsProvider =
    FutureProvider.autoDispose<List<Appointment>>((ref) async {
  final repo = ref.watch(appointmentsRepositoryProvider);
  final items = await repo.list(to: DateTime.now());
  items.sort((a, b) => b.scheduledAt.compareTo(a.scheduledAt));
  return items;
});

/// Key for an availability lookup — equality is by (employeeId, calendar day)
/// so the family caches per day rather than per millisecond.
class AvailabilityArgs {
  final String employeeId;
  final DateTime day;
  const AvailabilityArgs(this.employeeId, this.day);

  @override
  bool operator ==(Object other) =>
      other is AvailabilityArgs &&
      other.employeeId == employeeId &&
      other.day.year == day.year &&
      other.day.month == day.month &&
      other.day.day == day.day;

  @override
  int get hashCode => Object.hash(employeeId, day.year, day.month, day.day);
}

/// Free/busy for an agent on a day — drives the slot picker.
final availabilityProvider = FutureProvider.autoDispose
    .family<AvailabilityDay, AvailabilityArgs>((ref, args) async {
  return ref
      .watch(appointmentsRepositoryProvider)
      .availability(args.employeeId, args.day);
});

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/appointments_providers.dart';

/// Opens the date + free-slot picker. Returns the chosen slot's start instant
/// (UTC), or null if dismissed. Office hours / slots come from the live
/// availability endpoint for [employeeId], so only conflict-free times show.
Future<DateTime?> showSlotPicker(
  BuildContext context, {
  required String employeeId,
  required String heading,
  DateTime? initialDay,
}) {
  return showModalBottomSheet<DateTime>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _SlotPickerSheet(
      employeeId: employeeId,
      heading: heading,
      initialDay: initialDay,
    ),
  );
}

class _SlotPickerSheet extends ConsumerStatefulWidget {
  final String employeeId;
  final String heading;
  final DateTime? initialDay;

  const _SlotPickerSheet({
    required this.employeeId,
    required this.heading,
    this.initialDay,
  });

  @override
  ConsumerState<_SlotPickerSheet> createState() => _SlotPickerSheetState();
}

class _SlotPickerSheetState extends ConsumerState<_SlotPickerSheet> {
  late DateTime _day;

  @override
  void initState() {
    super.initState();
    final base = widget.initialDay ?? DateTime.now();
    final today = DateTime.now();
    final floor = DateTime(today.year, today.month, today.day);
    var d = DateTime(base.year, base.month, base.day);
    if (d.isBefore(floor)) d = floor;
    _day = d;
  }

  bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final now = DateTime.now();
    final days = List.generate(14, (i) {
      final base = DateTime(now.year, now.month, now.day);
      return base.add(Duration(days: i));
    });
    final args = AvailabilityArgs(widget.employeeId, _day);
    final avail = ref.watch(availabilityProvider(args));

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space4, 0, AppTokens.space4, AppTokens.space1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.heading, style: t.titleMedium),
                  const SizedBox(height: 2),
                  Text('Pick a free 30-min slot · times in PKT',
                      style: t.bodySmall
                          ?.copyWith(color: AppTokens.textMutedLight)),
                ],
              ),
            ),
            SizedBox(
              height: 86,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                    horizontal: AppTokens.space4, vertical: AppTokens.space2),
                itemCount: days.length,
                itemBuilder: (_, i) => _dayChip(days[i]),
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: avail.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(AppTokens.space10),
                  child: LoadingView(),
                ),
                error: (e, _) => Padding(
                  padding: const EdgeInsets.all(AppTokens.space6),
                  child: ErrorView(
                    error: e,
                    onRetry: () =>
                        ref.invalidate(availabilityProvider(args)),
                  ),
                ),
                data: (a) {
                  final slots =
                      a.freeSlots.where((s) => s.start.isAfter(now)).toList();
                  if (slots.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.all(AppTokens.space8),
                      child: EmptyView(
                        icon: Icons.event_busy_outlined,
                        title: 'No open slots',
                        message: 'Fully booked — try another day.',
                      ),
                    );
                  }
                  return SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                        AppTokens.space3, AppTokens.space4, AppTokens.space6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${slots.length} open · ${a.busy.length} booked',
                          style: t.bodySmall
                              ?.copyWith(color: AppTokens.textMutedLight),
                        ),
                        const SizedBox(height: AppTokens.space3),
                        Wrap(
                          spacing: AppTokens.space2,
                          runSpacing: AppTokens.space2,
                          children: [
                            for (final s in slots)
                              ActionChip(
                                label: Text(pktTime(s.start)),
                                onPressed: () =>
                                    Navigator.of(context).pop(s.start),
                              ),
                          ],
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dayChip(DateTime day) {
    final selected = _sameDay(day, _day);
    return Padding(
      padding: const EdgeInsets.only(right: AppTokens.space2),
      child: InkWell(
        borderRadius: const BorderRadius.all(AppTokens.radiusLg),
        onTap: () => setState(() => _day = day),
        child: Container(
          width: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected
                ? AppTokens.primary600
                : AppTokens.surfaceSubtleLight,
            borderRadius: const BorderRadius.all(AppTokens.radiusLg),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                DateFormat('EEE').format(day),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: selected ? Colors.white70 : AppTokens.textMutedLight,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${day.day}',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color:
                      selected ? Colors.white : AppTokens.textPrimaryLight,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

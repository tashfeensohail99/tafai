import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/appointment_requests_repository.dart';
import '../data/appointments_providers.dart';
import '../data/appointments_repository.dart';
import '../domain/appointment_request.dart';
import 'slot_picker_sheet.dart';

/// Bot-captured booking intents — sales reviews, then books or rejects.
class AppointmentRequestsScreen extends ConsumerStatefulWidget {
  const AppointmentRequestsScreen({super.key});

  @override
  ConsumerState<AppointmentRequestsScreen> createState() =>
      _AppointmentRequestsScreenState();
}

class _AppointmentRequestsScreenState
    extends ConsumerState<AppointmentRequestsScreen> {
  bool _busy = false;

  Future<void> _book(AppointmentRequest r) async {
    final empId = ref.read(currentUserProvider)?.employee?.id;
    if (empId == null || empId.isEmpty) {
      _toast('Your employee profile is missing — can’t check availability.');
      return;
    }
    final slot = await showSlotPicker(
      context,
      employeeId: empId,
      heading: 'Book · ${r.contactName}',
    );
    if (slot == null || !mounted) return;
    await _create(r, slot);
  }

  Future<void> _create(AppointmentRequest r, DateTime slot) async {
    setState(() => _busy = true);
    try {
      await ref.read(appointmentsRepositoryProvider).create(
            leadId: r.leadId,
            title: 'Consultation — ${r.contactName}',
            appointmentType: appointmentTypeForModality(r.modality),
            scheduledAt: slot,
            appointmentRequestId: r.id,
          );
      ref.invalidate(pendingAppointmentRequestsProvider);
      ref.invalidate(upcomingAppointmentsProvider);
      _toast('Booked · ${pktDateTime(slot)}');
    } on ConflictError catch (e) {
      final s = e.suggestedAt;
      if (s != null && mounted) {
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('That slot was just taken'),
            content:
                Text('Next free slot is ${pktDateTime(s)}. Use it instead?'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Pick another')),
              FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Use it')),
            ],
          ),
        );
        if (ok == true) {
          await _create(r, s);
          return;
        }
      } else {
        _toast(e.message);
      }
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject(AppointmentRequest r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reject request'),
        content: Text('Decline the booking request from ${r.contactName}?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: AppTokens.statusDanger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Reject'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(appointmentRequestsRepositoryProvider).reject(r.id);
      ref.invalidate(pendingAppointmentRequestsProvider);
      _toast('Request rejected');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(pendingAppointmentRequestsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Booking requests')),
      body: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(pendingAppointmentRequestsProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const EmptyView(
              icon: Icons.event_available_outlined,
              title: 'No pending requests',
              message: 'Booking intents captured by the AI bot show up here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () =>
                ref.refresh(pendingAppointmentRequestsProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppTokens.space4),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) => _RequestCard(
                request: items[i],
                busy: _busy,
                onBook: () => _book(items[i]),
                onReject: () => _reject(items[i]),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  final AppointmentRequest request;
  final bool busy;
  final VoidCallback onBook;
  final VoidCallback onReject;

  const _RequestCard({
    required this.request,
    required this.busy,
    required this.onBook,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final r = request;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  radius: 18,
                  backgroundColor: AppTokens.primary50,
                  child: Icon(Icons.event_note_outlined,
                      size: 18, color: AppTokens.primary700),
                ),
                const SizedBox(width: AppTokens.space3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(r.contactName,
                          style: t.titleMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                      if (r.lead?.phone.isNotEmpty == true)
                        Text(r.lead!.phone,
                            style: t.bodySmall
                                ?.copyWith(color: AppTokens.textMutedLight)),
                    ],
                  ),
                ),
                Text(relativeTime(r.createdAt),
                    style: t.bodySmall?.copyWith(
                        color: AppTokens.textMutedLight, fontSize: 11)),
              ],
            ),
            const SizedBox(height: AppTokens.space3),
            Row(
              children: [
                const Icon(Icons.schedule,
                    size: 15, color: AppTokens.statusNeutral),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(r.intent,
                      style: t.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                ),
                if (r.modality != null && r.modality!.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 2),
                    decoration: const BoxDecoration(
                      color: AppTokens.statusInfoBg,
                      borderRadius: BorderRadius.all(AppTokens.radiusSm),
                    ),
                    child: Text(modalityLabel(r.modality),
                        style: const TextStyle(
                            color: AppTokens.statusInfo,
                            fontSize: 11,
                            fontWeight: FontWeight.w600)),
                  ),
              ],
            ),
            if (r.rawText.isNotEmpty) ...[
              const SizedBox(height: AppTokens.space2),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppTokens.space3),
                decoration: const BoxDecoration(
                  color: AppTokens.surfaceSubtleLight,
                  borderRadius: BorderRadius.all(AppTokens.radiusMd),
                ),
                child: Text('“${r.rawText}”',
                    style: t.bodySmall?.copyWith(
                        color: AppTokens.textSecondaryLight,
                        fontStyle: FontStyle.italic)),
              ),
            ],
            const SizedBox(height: AppTokens.space2),
            Row(
              children: [
                if (r.lead?.assignedName != null)
                  Expanded(
                    child: Text('Agent: ${r.lead!.assignedName}',
                        style: t.bodySmall
                            ?.copyWith(color: AppTokens.textMutedLight),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                  )
                else
                  const Spacer(),
                TextButton(
                  onPressed: busy ? null : onReject,
                  style: TextButton.styleFrom(
                      foregroundColor: AppTokens.statusDanger),
                  child: const Text('Reject'),
                ),
                const SizedBox(width: AppTokens.space2),
                FilledButton.icon(
                  onPressed: busy ? null : onBook,
                  icon: const Icon(Icons.event_available, size: 18),
                  label: const Text('Book'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

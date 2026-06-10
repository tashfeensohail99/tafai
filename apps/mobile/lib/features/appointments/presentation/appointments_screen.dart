import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../data/appointment_requests_repository.dart';
import '../data/appointments_providers.dart';
import '../data/appointments_repository.dart';
import '../domain/appointment.dart';
import 'appointment_requests_screen.dart';
import 'appointment_visuals.dart';
import 'lead_picker_sheet.dart';
import 'slot_picker_sheet.dart';

class AppointmentsScreen extends ConsumerStatefulWidget {
  const AppointmentsScreen({super.key});

  @override
  ConsumerState<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends ConsumerState<AppointmentsScreen> {
  bool _upcoming = true;
  bool _busy = false;

  void _refreshLists() {
    ref.invalidate(upcomingAppointmentsProvider);
    ref.invalidate(pastAppointmentsProvider);
  }

  Future<void> _openRequests() async {
    await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const AppointmentRequestsScreen()));
    if (!mounted) return;
    ref.invalidate(pendingAppointmentRequestsProvider);
    _refreshLists();
  }

  @override
  Widget build(BuildContext context) {
    final async = _upcoming
        ? ref.watch(upcomingAppointmentsProvider)
        : ref.watch(pastAppointmentsProvider);
    final pendingRequests =
        ref.watch(pendingAppointmentRequestsProvider).valueOrNull?.length ?? 0;

    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : _book,
        icon: const Icon(Icons.add),
        label: const Text('Book'),
      ),
      body: Column(
        children: [
          if (pendingRequests > 0)
            Material(
              color: AppTokens.statusInfoBg,
              child: InkWell(
                onTap: _openRequests,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppTokens.space4, vertical: AppTokens.space3),
                  child: Row(
                    children: [
                      const Icon(Icons.event_note_outlined,
                          color: AppTokens.statusInfo, size: 18),
                      const SizedBox(width: AppTokens.space2),
                      Expanded(
                        child: Text(
                          '$pendingRequests booking request${pendingRequests == 1 ? '' : 's'} from chats',
                          style: const TextStyle(
                              color: AppTokens.statusInfo,
                              fontWeight: FontWeight.w600),
                        ),
                      ),
                      const Icon(Icons.chevron_right,
                          color: AppTokens.statusInfo),
                    ],
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('Upcoming')),
                  ButtonSegment(value: false, label: Text('Past')),
                ],
                selected: {_upcoming},
                onSelectionChanged: (s) => setState(() => _upcoming = s.first),
                showSelectedIcon: false,
              ),
            ),
          ),
          const SizedBox(height: AppTokens.space3),
          Expanded(
            child: async.when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: _refreshLists),
              data: (items) => items.isEmpty
                  ? EmptyView(
                      icon: Icons.event_available_outlined,
                      title: _upcoming ? 'No upcoming appointments' : 'No past appointments',
                      message: _upcoming
                          ? 'Tap Book to schedule a consultation.'
                          : 'Completed and cancelled meetings show here.',
                    )
                  : RefreshIndicator(
                      onRefresh: () => ref.refresh((_upcoming
                              ? upcomingAppointmentsProvider
                              : pastAppointmentsProvider)
                          .future),
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                            AppTokens.space1, AppTokens.space4, AppTokens.space16),
                        itemCount: items.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: AppTokens.space3),
                        itemBuilder: (_, i) => _AppointmentCard(
                          appt: items[i],
                          busy: _busy,
                          onOpenLead: () {
                            final id = items[i].leadId;
                            if (id != null) context.push(AppRoutes.leadDetail(id));
                          },
                          onReschedule: () => _reschedule(items[i]),
                          onCancel: () => _cancel(items[i]),
                        ),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  // --- Book new ------------------------------------------------------------
  Future<void> _book() async {
    final empId = ref.read(currentUserProvider)?.employee?.id;
    if (empId == null || empId.isEmpty) {
      _toast('Your employee profile is missing — can’t check availability.');
      return;
    }
    final lead = await showLeadPicker(context);
    if (lead == null || !mounted) return;
    final created = await showModalBottomSheet<Appointment>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _NewAppointmentSheet(leadId: lead.id, leadName: lead.fullName, employeeId: empId),
    );
    if (created != null && mounted) {
      _refreshLists();
      _toast('Booked · ${pktDateTime(created.scheduledAt)}');
    }
  }

  // --- Reschedule ----------------------------------------------------------
  Future<void> _reschedule(Appointment a) async {
    final empId = a.assignedEmployeeId ?? ref.read(currentUserProvider)?.employee?.id;
    if (empId == null || empId.isEmpty) {
      _toast('No agent on this appointment — can’t check availability.');
      return;
    }
    final slot = await showSlotPicker(
      context,
      employeeId: empId,
      heading: 'Reschedule · ${a.contactName}',
      initialDay: a.scheduledAt.toLocal(),
    );
    if (slot == null || !mounted) return;
    await _runReschedule(a, slot);
  }

  Future<void> _runReschedule(Appointment a, DateTime slot) async {
    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentsRepositoryProvider)
          .reschedule(a.id, slot, durationMinutes: a.durationMinutes);
      _refreshLists();
      _toast('Rescheduled · ${pktDateTime(slot)}');
    } on ConflictError catch (e) {
      if (!mounted) return;
      final retry = await _offerSuggested(e);
      if (retry != null) await _runReschedule(a, retry);
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // --- Cancel --------------------------------------------------------------
  Future<void> _cancel(Appointment a) async {
    final ctrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel appointment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(a.contactName,
                style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(pktDateTime(a.scheduledAt),
                style: const TextStyle(color: AppTokens.textMutedLight)),
            const SizedBox(height: AppTokens.space3),
            TextField(
              controller: ctrl,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Reason (optional)',
                hintText: 'Why is it cancelled?',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Keep')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppTokens.statusDanger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Cancel it'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(appointmentsRepositoryProvider)
          .cancel(a.id, reason: ctrl.text.trim());
      _refreshLists();
      _toast('Appointment cancelled');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Shows the server's suggested next free slot on a 409; returns the instant
  /// to retry with, or null if the user declines.
  Future<DateTime?> _offerSuggested(ConflictError e) async {
    final s = e.suggestedAt;
    if (s == null) {
      _toast(e.message);
      return null;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('That slot was just taken'),
        content: Text('Next free slot is ${pktDateTime(s)}. Use it instead?'),
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
    return ok == true ? s : null;
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }
}

// ---------------------------------------------------------------------------

class _AppointmentCard extends StatelessWidget {
  final Appointment appt;
  final bool busy;
  final VoidCallback onOpenLead;
  final VoidCallback onReschedule;
  final VoidCallback onCancel;

  const _AppointmentCard({
    required this.appt,
    required this.busy,
    required this.onOpenLead,
    required this.onReschedule,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final a = appt;
    final statusColor = appointmentStatusColor(a.status);
    final showActions = a.canReschedule || a.canCancel;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: onOpenLead,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: AppTokens.primary50,
                    child: Icon(appointmentTypeIcon(a.appointmentType),
                        size: 18, color: AppTokens.primary700),
                  ),
                  const SizedBox(width: AppTokens.space3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(a.contactName,
                            style: t.titleMedium,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 1),
                        Text('${a.typeLabel} · ${a.durationMinutes} min',
                            style: t.bodySmall
                                ?.copyWith(color: AppTokens.textMutedLight)),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppTokens.space2),
                  StatusBadge(label: a.statusLabel, color: statusColor),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.space3),
            Row(
              children: [
                const Icon(Icons.schedule,
                    size: 15, color: AppTokens.textMutedLight),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(pktDateTime(a.scheduledAt),
                      style: t.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                ),
                Text(relativeTime(a.scheduledAt),
                    style: t.bodySmall
                        ?.copyWith(color: AppTokens.textMutedLight)),
              ],
            ),
            if (a.location != null && a.location!.isNotEmpty) ...[
              const SizedBox(height: 4),
              _MetaRow(icon: Icons.place_outlined, text: a.location!),
            ],
            if (a.meetingLink != null && a.meetingLink!.isNotEmpty) ...[
              const SizedBox(height: 4),
              _MetaRow(icon: Icons.link, text: a.meetingLink!),
            ],
            if (showActions) ...[
              const SizedBox(height: AppTokens.space2),
              Row(
                children: [
                  const Spacer(),
                  if (a.canReschedule)
                    TextButton(
                      onPressed: busy ? null : onReschedule,
                      child: const Text('Reschedule'),
                    ),
                  if (a.canCancel)
                    TextButton(
                      onPressed: busy ? null : onCancel,
                      style: TextButton.styleFrom(
                          foregroundColor: AppTokens.statusDanger),
                      child: const Text('Cancel'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 14, color: AppTokens.textMutedLight),
        const SizedBox(width: 6),
        Expanded(
          child: Text(text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: AppTokens.textSecondaryLight)),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------

class _NewAppointmentSheet extends ConsumerStatefulWidget {
  final String leadId;
  final String leadName;
  final String employeeId;

  const _NewAppointmentSheet({
    required this.leadId,
    required this.leadName,
    required this.employeeId,
  });

  @override
  ConsumerState<_NewAppointmentSheet> createState() =>
      _NewAppointmentSheetState();
}

class _NewAppointmentSheetState extends ConsumerState<_NewAppointmentSheet> {
  late final TextEditingController _titleCtrl;
  final _locationCtrl = TextEditingController();
  String _type = kAppointmentTypes.first;
  DateTime? _slot;
  bool _sendWhatsApp = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: 'Consultation');
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _locationCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickSlot() async {
    final slot = await showSlotPicker(
      context,
      employeeId: widget.employeeId,
      heading: 'Pick a time · ${widget.leadName}',
      initialDay: _slot?.toLocal(),
    );
    if (slot != null && mounted) setState(() => _slot = slot);
  }

  Future<void> _submit() async {
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) {
      setState(() => _error = 'Add a short title.');
      return;
    }
    if (_slot == null) {
      setState(() => _error = 'Choose a time slot.');
      return;
    }
    await _create(_slot!);
  }

  Future<void> _create(DateTime slot) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final created = await ref.read(appointmentsRepositoryProvider).create(
            leadId: widget.leadId,
            title: _titleCtrl.text.trim(),
            appointmentType: _type,
            scheduledAt: slot,
            location: _locationCtrl.text.trim(),
            sendWhatsAppConfirmation: _sendWhatsApp,
          );
      if (mounted) Navigator.of(context).pop(created);
    } on ConflictError catch (e) {
      final s = e.suggestedAt;
      if (!mounted) return;
      if (s == null) {
        setState(() => _error = e.message);
        return;
      }
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('That slot was just taken'),
          content: Text('Next free slot is ${pktDateTime(s)}. Use it instead?'),
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
        setState(() => _slot = s);
        await _create(s);
      }
    } on AppError catch (e) {
      if (mounted) setState(() => _error = messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(AppTokens.space4, 0,
              AppTokens.space4, AppTokens.space5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('New appointment', style: t.titleMedium),
              const SizedBox(height: 2),
              Text('With ${widget.leadName}',
                  style: t.bodySmall?.copyWith(color: AppTokens.textMutedLight)),
              const SizedBox(height: AppTokens.space4),
              Text('Type', style: t.labelLarge),
              const SizedBox(height: AppTokens.space2),
              Wrap(
                spacing: AppTokens.space2,
                runSpacing: AppTokens.space2,
                children: [
                  for (final ty in kAppointmentTypes)
                    ChoiceChip(
                      label: Text(appointmentTypeLabel(ty)),
                      selected: _type == ty,
                      onSelected: (_) => setState(() => _type = ty),
                    ),
                ],
              ),
              const SizedBox(height: AppTokens.space4),
              TextField(
                controller: _titleCtrl,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  hintText: 'e.g. Visa consultation',
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _locationCtrl,
                decoration: const InputDecoration(
                  labelText: 'Location / link (optional)',
                  hintText: 'Office, or a video-call link',
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              Card(
                margin: EdgeInsets.zero,
                child: ListTile(
                  leading: const Icon(Icons.schedule),
                  title: Text(_slot == null ? 'Choose a time' : pktDateTime(_slot!)),
                  subtitle: Text(_slot == null
                      ? 'Pick a free slot'
                      : 'Tap to change'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: _busy ? null : _pickSlot,
                ),
              ),
              const SizedBox(height: AppTokens.space1),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _sendWhatsApp,
                onChanged: _busy
                    ? null
                    : (v) => setState(() => _sendWhatsApp = v),
                title: const Text('Send WhatsApp confirmation'),
                subtitle: const Text('Only if the chat window is open'),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppTokens.space2),
                ErrorBanner(_error!),
              ],
              const SizedBox(height: AppTokens.space4),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const ButtonSpinner()
                      : const Text('Book appointment'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

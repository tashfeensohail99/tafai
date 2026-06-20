import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/portal_providers.dart';
import '../domain/portal_models.dart';
import 'portal_helpers.dart';

/// Appointments tab — upcoming + past, grouped. Read-only in Phase 1 (the
/// backend doesn't let clients self-schedule). A meeting link opens in the
/// external browser. Body widget (no Scaffold; lives in the shell).
class ClientAppointmentsTab extends ConsumerWidget {
  const ClientAppointmentsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(portalAppointmentsProvider);
    return async.when(
      loading: () => const SkeletonList(),
      error: (e, _) => ErrorView(
        error: e,
        onRetry: () => ref.invalidate(portalAppointmentsProvider),
      ),
      data: (appts) {
        if (appts.isEmpty) {
          return const EmptyView(
            icon: Icons.event_busy_outlined,
            title: 'No appointments',
            message:
                'When your consultant schedules a meeting, it will appear here.',
          );
        }
        final upcoming = appts.where((a) => a.isUpcoming).toList();
        final past = appts.where((a) => !a.isUpcoming).toList()
          ..sort((a, b) => (b.scheduledAt ?? DateTime(0))
              .compareTo(a.scheduledAt ?? DateTime(0)));

        return RefreshIndicator(
          color: AppTokens.brandNavy,
          onRefresh: () => ref.refresh(portalAppointmentsProvider.future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space4, AppTokens.space4, AppTokens.space16),
            children: [
              if (upcoming.isNotEmpty) ...[
                const SectionLabel('Upcoming'),
                const SizedBox(height: AppTokens.space2),
                for (final a in upcoming) ...[
                  _ApptCard(appt: a, isUpcoming: true),
                  const SizedBox(height: AppTokens.space3),
                ],
              ],
              if (past.isNotEmpty) ...[
                if (upcoming.isNotEmpty) const SizedBox(height: AppTokens.space2),
                const SectionLabel('Past'),
                const SizedBox(height: AppTokens.space2),
                for (final a in past) ...[
                  _ApptCard(appt: a, isUpcoming: false),
                  const SizedBox(height: AppTokens.space3),
                ],
              ],
            ],
          ),
        );
      },
    );
  }
}

class _ApptCard extends StatelessWidget {
  final PortalAppointment appt;
  final bool isUpcoming;
  const _ApptCard({required this.appt, required this.isUpcoming});

  @override
  Widget build(BuildContext context) {
    final s = apptStatusStyle(appt.status);
    return Opacity(
      opacity: isUpcoming ? 1 : 0.85,
      child: PremiumCard(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        appt.title,
                        style: const TextStyle(
                          fontSize: AppTokens.fontSizeBase,
                          fontWeight: FontWeight.w700,
                          color: AppTokens.textPrimaryLight,
                        ),
                      ),
                      if (appt.appointmentType.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            titleCaseEnum(appt.appointmentType),
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: AppTokens.textMutedLight,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: AppTokens.space2),
                PortalPill(label: s.label, fg: s.fg, bg: s.bg),
              ],
            ),
            const SizedBox(height: AppTokens.space3),
            if (appt.scheduledAt != null)
              _row(Icons.schedule, formatDateTime(appt.scheduledAt!)),
            if (appt.durationMinutes > 0)
              _row(Icons.timelapse_outlined, '${appt.durationMinutes} minutes'),
            if (appt.location != null && appt.location!.isNotEmpty)
              _row(Icons.location_on_outlined, appt.location!),
            if (appt.instructions != null && appt.instructions!.isNotEmpty)
              _row(Icons.info_outline, appt.instructions!),
            if (!isUpcoming &&
                appt.cancellationReason != null &&
                appt.cancellationReason!.isNotEmpty)
              _row(Icons.cancel_outlined, appt.cancellationReason!),
            if (appt.meetingLink != null && appt.meetingLink!.isNotEmpty) ...[
              const SizedBox(height: AppTokens.space3),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => openExternalUrl(appt.meetingLink!),
                  icon: const Icon(Icons.videocam_outlined, size: 18),
                  label: const Text('Join meeting'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTokens.brandNavy,
                    padding:
                        const EdgeInsets.symmetric(vertical: AppTokens.space2),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: AppTokens.textMutedLight),
          const SizedBox(width: AppTokens.space2),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: AppTokens.fontSizeSm,
                color: AppTokens.textSecondaryLight,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/portal_providers.dart';
import '../domain/portal_models.dart';

/// Case overview tab — the client's at-a-glance status: service, current phase,
/// progress stepper, what-to-do-next, assigned officer and key dates. Body
/// widget (no Scaffold; lives in the ClientShell IndexedStack).
class ClientCaseTab extends ConsumerWidget {
  final String? caseId;
  const ClientCaseTab({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = caseId;
    if (id == null) {
      return const EmptyView(
        icon: Icons.folder_open_outlined,
        title: 'No active application',
        message:
            'You don’t have an active case yet. Your consultant will set one up '
            'and it will appear here.',
      );
    }

    final async = ref.watch(portalCaseDetailProvider(id));
    return async.when(
      loading: () => const SkeletonList(),
      error: (e, _) => ErrorView(
        error: e,
        onRetry: () => ref.invalidate(portalCaseDetailProvider(id)),
      ),
      data: (c) => RefreshIndicator(
        color: AppTokens.brandNavy,
        onRefresh: () async {
          ref.invalidate(portalCasesProvider);
          ref.invalidate(portalCaseDetailProvider(id));
          await ref.read(portalCaseDetailProvider(id).future);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTokens.space4, AppTokens.space4,
              AppTokens.space4, AppTokens.space16),
          children: [
            _StatusHeader(detail: c),
            const SizedBox(height: AppTokens.space4),
            _JourneyStepper(stage: c.stage),
            const SizedBox(height: AppTokens.space4),
            _NextActionCard(stage: c.stage),
            const SizedBox(height: AppTokens.space4),
            _ProgressRow(detail: c),
            const SizedBox(height: AppTokens.space4),
            _DetailsCard(detail: c),
          ],
        ),
      ),
    );
  }
}

class _StatusHeader extends StatelessWidget {
  final PortalCaseDetail detail;
  const _StatusHeader({required this.detail});

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            titleCaseEnum(detail.service),
            style: const TextStyle(
              fontSize: AppTokens.fontSizeLg,
              fontWeight: FontWeight.w700,
              color: AppTokens.textPrimaryLight,
            ),
          ),
          if (detail.targetCountry != null &&
              detail.targetCountry!.isNotEmpty) ...[
            const SizedBox(height: 2),
            Row(
              children: [
                const Icon(Icons.public,
                    size: 14, color: AppTokens.textMutedLight),
                const SizedBox(width: 4),
                Text(
                  detail.targetCountry!,
                  style: const TextStyle(
                    fontSize: AppTokens.fontSizeSm,
                    color: AppTokens.textMutedLight,
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: AppTokens.space3),
          Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space3, vertical: AppTokens.space2),
            decoration: const BoxDecoration(
              color: AppTokens.statusInfoBg,
              borderRadius: BorderRadius.all(AppTokens.radiusMd),
            ),
            child: Row(
              children: [
                const Icon(Icons.flag_outlined,
                    size: 16, color: AppTokens.statusInfo),
                const SizedBox(width: AppTokens.space2),
                Expanded(
                  child: Text(
                    clientStageLabel(detail.stage),
                    style: const TextStyle(
                      fontSize: AppTokens.fontSizeSm,
                      fontWeight: FontWeight.w700,
                      color: AppTokens.statusInfo,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _JourneyStepper extends StatelessWidget {
  final String stage;
  const _JourneyStepper({required this.stage});

  @override
  Widget build(BuildContext context) {
    final current = clientJourneyPhase(stage);
    if (current < 0) {
      // Cancelled — no stepper.
      return const SizedBox.shrink();
    }
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionLabel('Your journey'),
          const SizedBox(height: AppTokens.space3),
          Row(
            children: [
              for (var i = 0; i < kClientJourneyPhases.length; i++) ...[
                _StepDot(
                  index: i,
                  done: i < current,
                  active: i == current,
                ),
                if (i < kClientJourneyPhases.length - 1)
                  Expanded(
                    child: Container(
                      height: 2,
                      color: i < current
                          ? AppTokens.statusSuccess
                          : AppTokens.borderLight,
                    ),
                  ),
              ],
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          Row(
            children: [
              for (var i = 0; i < kClientJourneyPhases.length; i++)
                Expanded(
                  child: Text(
                    kClientJourneyPhases[i],
                    textAlign: i == 0
                        ? TextAlign.start
                        : (i == kClientJourneyPhases.length - 1
                            ? TextAlign.end
                            : TextAlign.center),
                    style: TextStyle(
                      fontSize: 9.5,
                      height: 1.1,
                      fontWeight:
                          i == current ? FontWeight.w700 : FontWeight.w500,
                      color: i <= current
                          ? AppTokens.textSecondaryLight
                          : AppTokens.textDisabledLight,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StepDot extends StatelessWidget {
  final int index;
  final bool done;
  final bool active;
  const _StepDot({required this.index, required this.done, required this.active});

  @override
  Widget build(BuildContext context) {
    final Color bg;
    final Widget child;
    if (done) {
      bg = AppTokens.statusSuccess;
      child = const Icon(Icons.check, size: 13, color: Colors.white);
    } else if (active) {
      bg = AppTokens.brandNavy;
      child = Text('${index + 1}',
          style: const TextStyle(
              color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700));
    } else {
      bg = AppTokens.borderLight;
      child = Text('${index + 1}',
          style: const TextStyle(
              color: AppTokens.textMutedLight,
              fontSize: 11,
              fontWeight: FontWeight.w700));
    }
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: child,
    );
  }
}

class _NextActionCard extends StatelessWidget {
  final String stage;
  const _NextActionCard({required this.stage});

  @override
  Widget build(BuildContext context) {
    final text = clientNextAction(stage);
    if (text.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(AppTokens.space4),
      decoration: BoxDecoration(
        color: AppTokens.primary50,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        border: Border.all(color: AppTokens.primary100),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lightbulb_outline,
              size: 18, color: AppTokens.primary700),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'What happens next',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppTokens.primary700,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  text,
                  style: const TextStyle(
                    fontSize: AppTokens.fontSizeSm,
                    height: 1.4,
                    color: AppTokens.textSecondaryLight,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressRow extends StatelessWidget {
  final PortalCaseDetail detail;
  const _ProgressRow({required this.detail});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: MetricCard(
            icon: Icons.check_circle_outline,
            value: '${detail.docsAccepted}/${detail.docsTotal}',
            label: 'Documents accepted',
            accentColor: AppTokens.statusSuccess,
          ),
        ),
        const SizedBox(width: AppTokens.space3),
        Expanded(
          child: MetricCard(
            icon: Icons.pending_actions_outlined,
            value: '${detail.docsActionRequired}',
            label: 'Need your action',
            accentColor: detail.docsActionRequired > 0
                ? AppTokens.statusWarning
                : AppTokens.statusNeutral,
          ),
        ),
      ],
    );
  }
}

class _DetailsCard extends StatelessWidget {
  final PortalCaseDetail detail;
  const _DetailsCard({required this.detail});

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      padding: const EdgeInsets.all(AppTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionLabel('Details'),
          const SizedBox(height: AppTokens.space2),
          _row(Icons.person_outline, 'Assigned officer',
              detail.assignedOfficerName ?? 'To be assigned'),
          if (detail.createdAt != null)
            _row(Icons.event_available_outlined, 'Case opened',
                formatDate(detail.createdAt!)),
          if (detail.slaDueAt != null)
            _row(Icons.flag_outlined, 'Target date',
                formatDate(detail.slaDueAt!)),
        ],
      ),
    );
  }

  Widget _row(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.space2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppTokens.textMutedLight),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: AppTokens.fontSizeSm,
                color: AppTokens.textMutedLight,
              ),
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(
                fontSize: AppTokens.fontSizeSm,
                fontWeight: FontWeight.w600,
                color: AppTokens.textPrimaryLight,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

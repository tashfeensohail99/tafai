import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../data/processing_providers.dart';
import '../domain/processing_models.dart';
import 'case_action_sheets.dart';
import 'processing_ui.dart';
import 'submission_package_panel.dart';
import 'tabs/communications_tab.dart';
import 'tabs/documents_tab.dart';
import 'tabs/history_tab.dart';
import 'tabs/notes_tab.dart';
import 'tabs/tasks_tab.dart';
import 'tabs/timeline_tab.dart';
import 'tabs/whatsapp_tab.dart';

/// Case Workspace — pushed via Navigator.push from the case lists. Header card
/// (stage / priority / time-in-stage) + a HORIZONTALLY-SCROLLABLE TabBar.
/// Manager actions (Reassign / Cancel) gate on processing_manager; Change-stage
/// is available to everyone (the backend enforces who can transition).
class CaseWorkspaceScreen extends ConsumerWidget {
  final String caseId;
  const CaseWorkspaceScreen({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseDetailProvider(caseId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: async.maybeWhen(
          data: (c) => Text(c.personName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.w600)),
          orElse: () => const Text('Case',
              style: TextStyle(color: Colors.white)),
        ),
      ),
      body: async.when(
        loading: () => const LoadingView(label: 'Loading case…'),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(AppTokens.space6),
          child: ErrorView(
            error: e,
            onRetry: () => ref.invalidate(caseDetailProvider(caseId)),
          ),
        ),
        data: (c) => _Workspace(caseRecord: c),
      ),
    );
  }
}

class _Workspace extends ConsumerWidget {
  final ProcessingCaseDetail caseRecord;
  const _Workspace({required this.caseRecord});

  static const _tabs = <({String label, IconData icon})>[
    (label: 'Documents', icon: Icons.fact_check_outlined),
    (label: 'Notes', icon: Icons.sticky_note_2_outlined),
    (label: 'Tasks', icon: Icons.checklist_outlined),
    (label: 'WhatsApp', icon: Icons.chat_bubble_outline),
    (label: 'Comms', icon: Icons.mail_outline),
    (label: 'Timeline', icon: Icons.history),
    (label: 'History', icon: Icons.headset_mic_outlined),
  ];

  Future<void> _afterMutation(WidgetRef ref) async {
    ref.invalidate(caseDetailProvider(caseRecord.id));
    ref.invalidate(submissionReadinessProvider(caseRecord.id));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = caseRecord;
    final isManager = ref.watch(isProcessingManagerProvider);
    final canAssign = ref.watch(canAssignCasesProvider);

    return DefaultTabController(
      length: _tabs.length,
      child: Column(
        children: [
          // Header card: stage / priority / time-in-stage + actions.
          Container(
            color: AppTokens.surfaceLight,
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space3, AppTokens.space4, AppTokens.space3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${labelForServiceCode(c.service)} · ${c.targetCountry}',
                  style: const TextStyle(
                      fontSize: 13, color: AppTokens.textMutedLight),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    const Icon(Icons.person_outline,
                        size: 13, color: AppTokens.textMutedLight),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        c.assignedOfficer?.display ?? 'Unassigned',
                        style: const TextStyle(
                            fontSize: 12.5, color: AppTokens.textMutedLight),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppTokens.space3),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    stagePill(c.stage),
                    priorityPill(c.priority),
                    _timeInStage(c),
                  ],
                ),
                const SizedBox(height: AppTokens.space3),
                // Actions: Change stage (all), Reassign + Cancel (manager).
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: AppTokens.primary600,
                          padding:
                              const EdgeInsets.symmetric(vertical: 10),
                        ),
                        onPressed: () async {
                          final ok = await showStageChangeSheet(context, ref,
                              caseRecord: c);
                          if (ok == true) await _afterMutation(ref);
                        },
                        icon: const Icon(Icons.layers_outlined, size: 16),
                        label: const Text('Change stage'),
                      ),
                    ),
                    if (canAssign) ...[
                      const SizedBox(width: AppTokens.space2),
                      _IconAction(
                        icon: Icons.person_add_alt_1_outlined,
                        tooltip: 'Reassign',
                        onPressed: () async {
                          final ok = await showReassignSheet(context, ref,
                              caseRecord: c);
                          if (ok == true) await _afterMutation(ref);
                        },
                      ),
                    ],
                    if (isManager && !c.isTerminal) ...[
                      const SizedBox(width: AppTokens.space2),
                      _IconAction(
                        icon: Icons.delete_sweep_outlined,
                        tooltip: 'Mark as junk',
                        onPressed: () async {
                          final ok = await showJunkSheet(context, ref,
                              caseRecord: c);
                          if (ok == true) await _afterMutation(ref);
                        },
                      ),
                      const SizedBox(width: AppTokens.space2),
                      _IconAction(
                        icon: Icons.cancel_outlined,
                        tooltip: 'Cancel case',
                        danger: true,
                        onPressed: () async {
                          final ok = await showCancelSheet(context, ref,
                              caseRecord: c);
                          if (ok == true) await _afterMutation(ref);
                        },
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          // Horizontally-scrollable TabBar.
          Container(
            color: AppTokens.surfaceLight,
            child: TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              labelColor: AppTokens.primary700,
              unselectedLabelColor: AppTokens.textMutedLight,
              indicatorColor: AppTokens.primary600,
              indicatorWeight: 2.5,
              labelStyle: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w700),
              unselectedLabelStyle: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w500),
              tabs: _tabs
                  .map((t) => Tab(
                        height: 46,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(t.icon, size: 15),
                            const SizedBox(width: 6),
                            Text(t.label),
                          ],
                        ),
                      ))
                  .toList(),
            ),
          ),
          const Divider(height: 1, color: AppTokens.borderLight),
          Expanded(
            child: TabBarView(
              children: [
                // Documents tab: submission-package panel scrolls above the
                // review queue (passed as the list header).
                CaseDocumentsTab(
                  caseId: c.id,
                  header: SubmissionPackagePanel(
                    caseId: c.id,
                    caseStage: c.stage,
                  ),
                ),
                CaseNotesTab(caseId: c.id),
                CaseTasksTab(caseId: c.id),
                CaseWhatsAppTab(caseId: c.id),
                CaseCommunicationsTab(caseId: c.id),
                CaseTimelineTab(caseId: c.id),
                CaseHistoryTab(caseId: c.id),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _timeInStage(ProcessingCaseDetail c) {
    final days = c.daysInCurrentStage;
    final overdue = days >= 5;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(overdue ? Icons.warning_amber_rounded : Icons.schedule,
            size: 14,
            color: overdue
                ? AppTokens.statusWarning
                : AppTokens.textMutedLight),
        const SizedBox(width: 4),
        Text('${days}d in stage',
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: overdue
                    ? AppTokens.statusWarning
                    : AppTokens.textSecondaryLight)),
      ],
    );
  }
}

class _IconAction extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  final bool danger;
  const _IconAction({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.danger = false,
  });

  @override
  Widget build(BuildContext context) {
    final color =
        danger ? AppTokens.statusDanger : AppTokens.textSecondaryLight;
    return Tooltip(
      message: tooltip,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(
              color: danger
                  ? AppTokens.statusDanger.withValues(alpha: 0.5)
                  : AppTokens.borderStrongLight),
          padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space3, vertical: 10),
          minimumSize: const Size(0, 40),
        ),
        child: Icon(icon, size: 18),
      ),
    );
  }
}

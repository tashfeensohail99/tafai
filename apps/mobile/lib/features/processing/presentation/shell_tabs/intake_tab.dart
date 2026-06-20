import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../data/processing_repository.dart';
import '../../domain/processing_models.dart';
import '../case_workspace_screen.dart';
import '../processing_ui.dart';

/// Manager Intake — finance-handover cases awaiting acknowledge + assign.
/// Manager-only (gated in the shell on processing_manager). The acknowledge
/// sheet confirms the case category and picks a processing associate.
class IntakeTab extends ConsumerWidget {
  const IntakeTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(intakeQueueProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(intakeQueueProvider.future),
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(
              error: e,
              onRetry: () => ref.invalidate(intakeQueueProvider),
            ),
          ),
        ]),
        data: (queue) {
          if (queue.isEmpty) {
            return ListView(children: const [
              Padding(
                padding: EdgeInsets.only(top: 80),
                child: EmptyView(
                  icon: Icons.inbox_outlined,
                  title: 'Queue is clear',
                  message: 'No new cases from Finance pending review.',
                ),
              ),
            ]);
          }
          return ListView.separated(
            padding: const EdgeInsets.all(AppTokens.space4),
            itemCount: queue.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AppTokens.space3),
            itemBuilder: (_, i) => _IntakeCard(item: queue[i]),
          );
        },
      ),
    );
  }
}

class _IntakeCard extends ConsumerWidget {
  final IntakeCaseItem item;
  const _IntakeCard({required this.item});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = item.base;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              priorityPill(c.priority),
              const Spacer(),
              Text('Received ${relativeTime(c.createdAt)}',
                  style: const TextStyle(
                      fontSize: 11, color: AppTokens.textMutedLight)),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          Text(c.personName,
              style: const TextStyle(
                  fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text('${labelForServiceCode(c.service)} · ${c.targetCountry}',
              style: const TextStyle(
                  fontSize: 13, color: AppTokens.textMutedLight)),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.phone_outlined,
                  size: 13, color: AppTokens.textMutedLight),
              const SizedBox(width: 4),
              Text(c.personPhone,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppTokens.textMutedLight)),
              if (item.financeHandover != null) ...[
                  const SizedBox(width: AppTokens.space3),
                const Icon(Icons.account_balance_wallet_outlined,
                    size: 13, color: AppTokens.textMutedLight),
                const SizedBox(width: 4),
                Text(
                  '${item.financeHandover!.submittedAmount.toStringAsFixed(0)} ${item.financeHandover!.currency}',
                  style: const TextStyle(
                      fontSize: 12.5, color: AppTokens.textMutedLight),
                ),
              ],
            ],
          ),
          if (item.financeHandoverNote != null &&
              item.financeHandoverNote!.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            Container(
              padding: const EdgeInsets.all(AppTokens.space2),
              decoration: const BoxDecoration(
                color: AppTokens.statusInfoBg,
                borderRadius: BorderRadius.all(AppTokens.radiusMd),
              ),
              child: Text('Finance note: ${item.financeHandoverNote}',
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.textSecondaryLight)),
            ),
          ],
          const SizedBox(height: AppTokens.space3),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTokens.primary600,
                  ),
                  onPressed: () => _acknowledge(context, ref, item),
                  icon: const Icon(Icons.check_circle_outline, size: 16),
                  label: const Text('Acknowledge & assign'),
                ),
              ),
              const SizedBox(width: AppTokens.space2),
              OutlinedButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CaseWorkspaceScreen(caseId: c.id),
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 40),
                  side: const BorderSide(color: AppTokens.borderStrongLight),
                ),
                child: const Text('Preview'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _acknowledge(
      BuildContext context, WidgetRef ref, IntakeCaseItem item) async {
    final officers = await ref.read(processingOfficersProvider.future).catchError(
          (_) => <ProcessingOfficer>[],
        );
    if (!context.mounted) return;
    final result = await showModalBottomSheet<({String officerId, String service})>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AcknowledgeSheet(item: item, officers: officers),
    );
    if (result == null) return;
    try {
      await ref.read(processingRepositoryProvider).acknowledgeIntake(
            item.base.id,
            assignOfficerId: result.officerId,
            service: result.service,
          );
      ref.invalidate(intakeQueueProvider);
      ref.invalidate(processingDashboardProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Case acknowledged & assigned')),
        );
      }
    } on AppError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }
}

class _AcknowledgeSheet extends StatefulWidget {
  final IntakeCaseItem item;
  final List<ProcessingOfficer> officers;
  const _AcknowledgeSheet({required this.item, required this.officers});

  @override
  State<_AcknowledgeSheet> createState() => _AcknowledgeSheetState();
}

class _AcknowledgeSheetState extends State<_AcknowledgeSheet> {
  String? _serviceCode;
  String? _officerId;

  @override
  void initState() {
    super.initState();
    final incoming = widget.item.base.service;
    _serviceCode = isCanonicalServiceCode(incoming) ? incoming : null;
    final associates =
        widget.officers.where((o) => o.primaryRole == 'processing').toList();
    if (associates.length == 1) _officerId = associates.first.id;
  }

  @override
  Widget build(BuildContext context) {
    final incoming = widget.item.base.service;
    final incomingCanonical = isCanonicalServiceCode(incoming);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85),
        decoration: const BoxDecoration(
          color: AppTokens.surfaceLight,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(AppTokens.space5),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTokens.borderStrongLight,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: AppTokens.space4),
              Text('Acknowledge & assign',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(widget.item.base.personName,
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w600)),
              const SizedBox(height: AppTokens.space4),
              const SectionLabel('Confirm case category'),
              const SizedBox(height: AppTokens.space2),
              DropdownButtonFormField<String>(
                initialValue: _serviceCode,
                isExpanded: true,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  isDense: true,
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                ),
                hint: const Text('Choose a case category…'),
                items: kServiceTypes
                    .map((e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(e.value,
                              overflow: TextOverflow.ellipsis),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _serviceCode = v),
              ),
              if (!incomingCanonical)
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Text(
                    'This lead arrived with a free-text service — pick the matching category so the right checklist attaches.',
                    style: TextStyle(
                        fontSize: 11.5, color: AppTokens.statusWarning),
                  ),
                ),
              const SizedBox(height: AppTokens.space4),
              const SectionLabel('Assign to processing associate'),
              const SizedBox(height: AppTokens.space2),
              if (widget.officers.isEmpty)
                const Text('No processing associates configured.',
                    style: TextStyle(
                        fontSize: 12.5, color: AppTokens.statusDanger))
              else
                DropdownButtonFormField<String>(
                  initialValue: _officerId,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    isDense: true,
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                  hint: const Text('Choose an associate…'),
                  items: widget.officers
                      .map((o) => DropdownMenuItem(
                            value: o.id,
                            child: Text(
                              o.primaryRole == 'processing_manager'
                                  ? '${o.name} (Manager)'
                                  : o.name,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _officerId = v),
                ),
              const SizedBox(height: AppTokens.space4),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTokens.primary600,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: (_serviceCode != null && _officerId != null)
                      ? () => Navigator.of(context).pop((
                            officerId: _officerId!,
                            service: _serviceCode!,
                          ))
                      : null,
                  child: const Text('Acknowledge & assign'),
                ),
              ),
              const SizedBox(height: AppTokens.space2),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';
import '../processing_ui.dart';

/// History tab — read-only cross-department background: Sales + Finance notes
/// and the call history (with transcripts). Recordings are not played in-app on
/// mobile; the transcript + metadata give the context the officer needs.
class CaseHistoryTab extends ConsumerWidget {
  final String caseId;
  const CaseHistoryTab({super.key, required this.caseId});

  String _fmtDuration(int? s) {
    if (s == null || s <= 0) return '—';
    final m = s ~/ 60;
    final sec = s % 60;
    return m > 0 ? '${m}m ${sec}s' : '${sec}s';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseBackgroundProvider(caseId));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(caseBackgroundProvider(caseId).future),
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(
              error: e,
              onRetry: () => ref.invalidate(caseBackgroundProvider(caseId)),
            ),
          ),
        ]),
        data: (bg) {
          final notes = [...bg.salesNotes, ...bg.financeNotes];
          return ListView(
            padding: const EdgeInsets.all(AppTokens.space4),
            children: [
              const SectionLabel('Sales & Finance notes'),
              const SizedBox(height: AppTokens.space2),
              if (notes.isEmpty)
                const SectionCard(
                  child: EmptyView(
                    icon: Icons.sticky_note_2_outlined,
                    title: 'No sales or finance notes',
                    message:
                        'Notes from other teams appear here, read-only, for context.',
                  ),
                )
              else
                ...notes.map((n) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppTokens.space3),
                      child: _NoteCard(note: n),
                    )),
              const SizedBox(height: AppTokens.space4),
              SectionLabel(
                  'Call history${bg.calls.isNotEmpty ? ' (${bg.calls.length})' : ''}'),
              const SizedBox(height: AppTokens.space2),
              if (bg.calls.isEmpty)
                const SectionCard(
                  child: EmptyView(
                    icon: Icons.phone_outlined,
                    title: 'No calls',
                    message:
                        'Inbound and outbound calls with this client appear here.',
                  ),
                )
              else
                ...bg.calls.map((c) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppTokens.space3),
                      child: _CallCard(call: c, durationText: _fmtDuration),
                    )),
            ],
          );
        },
      ),
    );
  }
}

class _NoteCard extends StatelessWidget {
  final CrossDeptNote note;
  const _NoteCard({required this.note});

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              StatusPill(label: note.label, tone: docStatusTone('SUBMITTED')),
              const Spacer(),
              if (note.at != null)
                Text(relativeTime(note.at!),
                    style: const TextStyle(
                        fontSize: 11, color: AppTokens.textMutedLight)),
            ],
          ),
          if (note.author != null) ...[
            const SizedBox(height: 4),
            Text(note.author!,
                style: const TextStyle(
                    fontSize: 11.5, color: AppTokens.textMutedLight)),
          ],
          const SizedBox(height: AppTokens.space2),
          Text(note.text,
              style: const TextStyle(fontSize: 13.5, height: 1.5)),
        ],
      ),
    );
  }
}

class _CallCard extends StatefulWidget {
  final CaseCall call;
  final String Function(int?) durationText;
  const _CallCard({required this.call, required this.durationText});

  @override
  State<_CallCard> createState() => _CallCardState();
}

class _CallCardState extends State<_CallCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.call;
    final missed = c.status == 'MISSED' || c.status == 'FAILED';
    final icon = missed
        ? Icons.phone_missed
        : c.direction == 'OUTBOUND'
            ? Icons.call_made
            : Icons.call_received;
    final color = missed
        ? AppTokens.statusDanger
        : c.direction == 'OUTBOUND'
            ? AppTokens.primary600
            : AppTokens.statusSuccess;
    final hasBody = (c.transcript != null && c.transcript!.isNotEmpty) ||
        c.transcriptStatus == 'PENDING';
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: hasBody ? () => setState(() => _open = !_open) : null,
            child: Row(
              children: [
                Icon(icon, size: 16, color: color),
                const SizedBox(width: AppTokens.space2),
                Expanded(
                  child: Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                          c.direction == 'OUTBOUND'
                              ? 'Outbound call'
                              : 'Inbound call',
                          style: const TextStyle(
                              fontSize: 13.5, fontWeight: FontWeight.w600)),
                      Text(widget.durationText(c.durationSeconds),
                          style: const TextStyle(
                              fontSize: 12,
                              color: AppTokens.textMutedLight)),
                      if (c.rep != null)
                        Text('· ${c.rep}',
                            style: const TextStyle(
                                fontSize: 12,
                                color: AppTokens.textMutedLight)),
                    ],
                  ),
                ),
                Text(relativeTime(c.at),
                    style: const TextStyle(
                        fontSize: 11, color: AppTokens.textMutedLight)),
                if (hasBody)
                  Icon(_open ? Icons.expand_less : Icons.expand_more,
                      size: 18, color: AppTokens.textMutedLight),
              ],
            ),
          ),
          if (_open && hasBody) ...[
            const Divider(height: AppTokens.space5),
            const SectionLabel('Transcript'),
            const SizedBox(height: 4),
            Text(
              c.transcript ??
                  (c.transcriptStatus == 'PENDING'
                      ? 'Transcribing…'
                      : 'No transcript available.'),
              style: TextStyle(
                fontSize: 13,
                height: 1.5,
                fontStyle: c.transcript == null
                    ? FontStyle.italic
                    : FontStyle.normal,
                color: c.transcript == null
                    ? AppTokens.textMutedLight
                    : AppTokens.textPrimaryLight,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

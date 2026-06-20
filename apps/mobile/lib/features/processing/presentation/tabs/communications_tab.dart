import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_error.dart';
import '../../../../core/theme/tokens.dart';
import '../../../../core/util/format.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../data/processing_repository.dart';
import '../../domain/processing_models.dart';
import '../processing_ui.dart';

/// Communications tab — log + send a client message across PORTAL / WHATSAPP /
/// EMAIL channels. The row is saved regardless; delivery warnings surface which
/// channels didn't actually transmit (mirrors the web CommunicationsTab).
class CaseCommunicationsTab extends ConsumerWidget {
  final String caseId;
  const CaseCommunicationsTab({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseCommunicationsProvider(caseId));
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTokens.primary600,
        onPressed: () => _send(context, ref),
        icon: const Icon(Icons.send),
        label: const Text('New message'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(caseCommunicationsProvider(caseId).future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () =>
                    ref.invalidate(caseCommunicationsProvider(caseId)),
              ),
            ),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: EmptyView(
                    icon: Icons.mail_outline,
                    title: 'No communications yet',
                    message:
                        'Send a portal note, WhatsApp, or email and it logs here.',
                  ),
                ),
              ]);
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                  AppTokens.space4, AppTokens.space4, AppTokens.space4, 88),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTokens.space3),
              itemBuilder: (_, i) => _CommCard(m: items[i]),
            );
          },
        ),
      ),
    );
  }

  Future<void> _send(BuildContext context, WidgetRef ref) async {
    final result = await showModalBottomSheet<
        ({String subject, String content, List<String> channels})>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _SendSheet(),
    );
    if (result == null) return;
    try {
      final res = await ref.read(processingRepositoryProvider).sendCommunication(
            caseId,
            subject: result.subject,
            content: result.content,
            channelsSent: result.channels,
          );
      ref.invalidate(caseCommunicationsProvider(caseId));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(res.deliveryWarnings.isEmpty
              ? 'Message sent.'
              : 'Saved — ${res.deliveryWarnings.join('; ')}'),
        ));
      }
    } on AppError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }
}

class _CommCard extends StatelessWidget {
  final CaseCommunication m;
  const _CommCard({required this.m});

  @override
  Widget build(BuildContext context) {
    final author = m.sentBy?.display ?? (m.isInbound ? 'Client' : 'Officer');
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(m.isInbound ? Icons.south_west : Icons.north_east,
                  size: 14,
                  color: m.isInbound
                      ? AppTokens.statusSuccess
                      : AppTokens.primary600),
              const SizedBox(width: AppTokens.space2),
              if (m.subject != null && m.subject!.isNotEmpty)
                Expanded(
                  child: Text(m.subject!,
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w600)),
                )
              else
                const Spacer(),
              Text('$author · ${relativeTime(m.createdAt)}',
                  style: const TextStyle(
                      fontSize: 11, color: AppTokens.textMutedLight)),
            ],
          ),
          if (m.channelsSent.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 6,
              children: m.channelsSent
                  .map((c) => StatusPill(
                        label: c,
                        tone: docStatusTone(
                            c.toUpperCase() == 'WHATSAPP' ? 'ACCEPTED' : 'SUBMITTED'),
                      ))
                  .toList(),
            ),
          ],
          const SizedBox(height: AppTokens.space2),
          Text(m.content,
              style: const TextStyle(fontSize: 13, height: 1.5)),
        ],
      ),
    );
  }
}

class _SendSheet extends StatefulWidget {
  const _SendSheet();

  @override
  State<_SendSheet> createState() => _SendSheetState();
}

class _SendSheetState extends State<_SendSheet> {
  final _subject = TextEditingController();
  final _content = TextEditingController();
  final Set<String> _channels = {'PORTAL'};

  static const _channelOptions = [
    ('PORTAL', 'Portal note'),
    ('WHATSAPP', 'WhatsApp'),
    ('EMAIL', 'Email'),
  ];

  @override
  void dispose() {
    _subject.dispose();
    _content.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canSend = _subject.text.trim().isNotEmpty &&
        _content.text.trim().isNotEmpty &&
        _channels.isNotEmpty;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
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
              Text('New message',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _subject,
                onChanged: (_) => setState(() {}),
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Subject',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _content,
                maxLines: 4,
                onChanged: (_) => setState(() {}),
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Message to the client',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              const SectionLabel('Send via'),
              const SizedBox(height: AppTokens.space2),
              Wrap(
                spacing: 6,
                children: _channelOptions.map((c) {
                  final on = _channels.contains(c.$1);
                  return FilterChip(
                    label: Text(c.$2, style: const TextStyle(fontSize: 12)),
                    selected: on,
                    onSelected: (_) => setState(() {
                      on ? _channels.remove(c.$1) : _channels.add(c.$1);
                    }),
                    selectedColor: AppTokens.primary100,
                  );
                }).toList(),
              ),
              const SizedBox(height: AppTokens.space4),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTokens.primary600,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: canSend
                      ? () => Navigator.of(context).pop((
                            subject: _subject.text.trim(),
                            content: _content.text.trim(),
                            channels: _channels.toList(),
                          ))
                      : null,
                  child: const Text('Send'),
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

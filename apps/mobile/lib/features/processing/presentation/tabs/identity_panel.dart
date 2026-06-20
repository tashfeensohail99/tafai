import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';
import '../processing_ui.dart';

/// Read-only identity reconciliation panel (cross-document + CRM agreement).
/// Flag-only — surfaces a verdict and the per-field rows; never mutates. Mounted
/// at the top of the Documents tab, mirroring the web DocumentChecklistTab.
class IdentityPanel extends ConsumerWidget {
  final String caseId;
  const IdentityPanel({super.key, required this.caseId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(caseIdentityProvider(caseId));
    return async.when(
      loading: () => const SizedBox.shrink(),
      // Identity is best-effort context — never block the Documents tab on it.
      error: (_, __) => const SizedBox.shrink(),
      data: (data) {
        if (data.documentCount == 0 && data.fields.isEmpty) {
          return const SizedBox.shrink();
        }
        final (tone, label, icon) = switch (data.overall) {
          'ok' => (
              docStatusTone('ACCEPTED'),
              'All documents match',
              Icons.verified_user_outlined
            ),
          'review' => (
              docStatusTone('EXPIRING_SOON'),
              'Some need a look',
              Icons.gpp_maybe_outlined
            ),
          _ => (
              docStatusTone('NOT_SUBMITTED'),
              'No data yet',
              Icons.help_outline
            ),
        };
        return SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 16, color: tone.fg),
                  const SizedBox(width: AppTokens.space2),
                  const Text('Identity check',
                      style: TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w700)),
                  const Spacer(),
                  StatusPill(label: label, tone: tone),
                ],
              ),
              if (data.referenceDocumentName != null) ...[
                const SizedBox(height: AppTokens.space2),
                Text('Reference: ${data.referenceDocumentName}',
                    style: const TextStyle(
                        fontSize: 11.5, color: AppTokens.textMutedLight)),
              ],
              const SizedBox(height: AppTokens.space3),
              ...data.fields.map(_fieldRow),
            ],
          ),
        );
      },
    );
  }

  Widget _fieldRow(IdentityFieldRow f) {
    final (tone, icon) = switch (f.status) {
      'agree' => (docStatusTone('ACCEPTED'), Icons.check_circle_outline),
      'conflict' => (docStatusTone('REJECTED'), Icons.error_outline),
      _ => (docStatusTone('NOT_SUBMITTED'), Icons.remove_circle_outline),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: tone.fg),
          const SizedBox(width: AppTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(f.label,
                    style: const TextStyle(
                        fontSize: 12.5, fontWeight: FontWeight.w600)),
                if (f.referenceValue != null && f.referenceValue!.isNotEmpty)
                  Text(f.referenceValue!,
                      style: const TextStyle(
                          fontSize: 12, color: AppTokens.textMutedLight)),
              ],
            ),
          ),
          StatusPill(
            label: f.status == 'agree'
                ? 'Match'
                : f.status == 'conflict'
                    ? 'Conflict'
                    : 'No data',
            tone: tone,
          ),
        ],
      ),
    );
  }
}

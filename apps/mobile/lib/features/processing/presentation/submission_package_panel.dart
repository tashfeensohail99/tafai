import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../data/processing_providers.dart';
import '../data/processing_repository.dart';
import 'processing_ui.dart';

/// Submission-readiness gate banner + signed submission-package download.
/// Shown on the Documents tab header for cases at READY_FOR_SUBMISSION or later.
/// The assembled PDF opens in the external browser via its signed URL (never an
/// in-app PDF viewer).
const Set<String> _packageRelevantStages = {
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'UNDER_AUTHORITY_REVIEW',
  'ADDITIONAL_INFO_REQUESTED',
  'DECISION_RECEIVED',
  'APPROVED',
  'COMPLETED',
};

class SubmissionPackagePanel extends ConsumerStatefulWidget {
  final String caseId;
  final String caseStage;
  const SubmissionPackagePanel({
    super.key,
    required this.caseId,
    required this.caseStage,
  });

  @override
  ConsumerState<SubmissionPackagePanel> createState() =>
      _SubmissionPackagePanelState();
}

class _SubmissionPackagePanelState
    extends ConsumerState<SubmissionPackagePanel> {
  bool _assembling = false;
  String? _error;

  ProcessingRepository get _repo => ref.read(processingRepositoryProvider);

  Future<void> _assemble() async {
    setState(() {
      _assembling = true;
      _error = null;
    });
    try {
      await _repo.assembleSubmissionPackage(widget.caseId);
      ref.invalidate(submissionPackageProvider(widget.caseId));
    } on AppError catch (e) {
      setState(() => _error = messageForError(e));
    } finally {
      if (mounted) setState(() => _assembling = false);
    }
  }

  Future<void> _download(String url) async {
    final ok = await openExternalUrl(url);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open the package.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_packageRelevantStages.contains(widget.caseStage)) {
      return const SizedBox.shrink();
    }
    final async = ref.watch(submissionPackageProvider(widget.caseId));
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [
            Icon(Icons.inventory_2_outlined,
                size: 16, color: AppTokens.primary600),
            SizedBox(width: AppTokens.space2),
            Text('Submission package',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          ]),
          const SizedBox(height: AppTokens.space3),
          async.when(
            loading: () => const Text('Loading package info…',
                style:
                    TextStyle(fontSize: 12.5, color: AppTokens.textMutedLight)),
            error: (_, __) => _assembleButton('Assemble package'),
            data: (pkg) {
              if (!pkg.exists) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Merge all accepted documents into a single ordered PDF for authority submission.',
                      style: TextStyle(
                          fontSize: 12.5, color: AppTokens.textSecondaryLight),
                    ),
                    const SizedBox(height: AppTokens.space3),
                    _assembleButton('Assemble package'),
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(AppTokens.space3),
                    decoration: BoxDecoration(
                      color: AppTokens.statusSuccessBg,
                      borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                      border: Border.all(
                          color:
                              AppTokens.statusSuccess.withValues(alpha: 0.3)),
                    ),
                    child: Row(children: [
                      const Icon(Icons.check_circle_outline,
                          size: 16, color: AppTokens.statusSuccess),
                      const SizedBox(width: AppTokens.space2),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${pkg.documentCount ?? 0} document${(pkg.documentCount ?? 0) != 1 ? 's' : ''} merged into one PDF',
                              style: const TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w600,
                                  color: AppTokens.statusSuccess),
                            ),
                            if (pkg.assembledAt != null)
                              Text('Assembled ${formatDateTime(pkg.assembledAt!)}',
                                  style: const TextStyle(
                                      fontSize: 11,
                                      color: AppTokens.textMutedLight)),
                          ],
                        ),
                      ),
                    ]),
                  ),
                  const SizedBox(height: AppTokens.space3),
                  Row(children: [
                    if (pkg.signedUrl != null)
                      FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: AppTokens.primary600,
                        ),
                        onPressed: () => _download(pkg.signedUrl!),
                        icon: const Icon(Icons.download, size: 16),
                        label: const Text('Download PDF'),
                      ),
                    const SizedBox(width: AppTokens.space2),
                    OutlinedButton.icon(
                      onPressed: _assembling ? null : _assemble,
                      icon: _assembling
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.refresh, size: 16),
                      label: const Text('Re-assemble'),
                    ),
                  ]),
                ],
              );
            },
          ),
          if (_error != null) ...[
            const SizedBox(height: AppTokens.space3),
            Container(
              padding: const EdgeInsets.all(AppTokens.space3),
              decoration: BoxDecoration(
                color: AppTokens.statusDangerBg,
                borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                border: Border.all(
                    color: AppTokens.statusDanger.withValues(alpha: 0.3)),
              ),
              child: Text(_error!,
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.statusDanger)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _assembleButton(String label) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(backgroundColor: AppTokens.primary600),
      onPressed: _assembling ? null : _assemble,
      icon: _assembling
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.inventory_2_outlined, size: 16),
      label: Text(_assembling ? 'Assembling…' : label),
    );
  }
}

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/portal_providers.dart';
import '../data/portal_repository.dart';
import '../domain/portal_models.dart';
import 'portal_helpers.dart';

/// Documents tab — the required/uploaded checklist. The client can upload a
/// file for any NOT_SUBMITTED / REJECTED item (→ status SUBMITTED), view what
/// they uploaded via a signed URL opened in the external browser (never an
/// in-app PDF viewer), and add an extra "additional" document.
class ClientDocumentsTab extends ConsumerStatefulWidget {
  final String? caseId;
  const ClientDocumentsTab({super.key, required this.caseId});

  @override
  ConsumerState<ClientDocumentsTab> createState() => _ClientDocumentsTabState();
}

class _ClientDocumentsTabState extends ConsumerState<ClientDocumentsTab> {
  // Item ids with an upload in flight, so we can show a spinner per-row.
  final Set<String> _uploading = {};
  bool _addingExtra = false;

  // file_picker accepts the formats the backend allows (PDF/JPG/PNG/HEIC).
  static const _allowedExt = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif'];

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  Future<PlatformFile?> _pickFile() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: _allowedExt,
      allowMultiple: false,
    );
    if (res == null || res.files.isEmpty) return null;
    final f = res.files.first;
    if (f.path == null) {
      _toast('Could not access that file.');
      return null;
    }
    return f;
  }

  Future<void> _uploadFor(PortalDocumentItem item) async {
    final caseId = widget.caseId;
    if (caseId == null || _uploading.contains(item.id)) return;
    final picked = await _pickFile();
    if (picked == null) return;
    setState(() => _uploading.add(item.id));
    try {
      await ref.read(portalRepositoryProvider).uploadDocument(
            caseId,
            item.id,
            filePath: picked.path!,
            fileName: picked.name,
          );
      _toast('Uploaded — your officer will review it shortly.');
      ref.invalidate(portalDocumentsProvider(caseId));
      ref.invalidate(portalCaseDetailProvider(caseId));
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _uploading.remove(item.id));
    }
  }

  Future<void> _addAdditional() async {
    final caseId = widget.caseId;
    if (caseId == null || _addingExtra) return;
    final picked = await _pickFile();
    if (picked == null || !mounted) return;
    final note = await _askNote();
    if (!mounted) return;
    setState(() => _addingExtra = true);
    try {
      await ref.read(portalRepositoryProvider).uploadAdditionalDocument(
            caseId,
            filePath: picked.path!,
            fileName: picked.name,
            note: note,
          );
      _toast('Added — thank you. Your officer will file it.');
      ref.invalidate(portalDocumentsProvider(caseId));
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _addingExtra = false);
    }
  }

  /// Optional one-line description for an additional document.
  Future<String?> _askNote() async {
    final ctrl = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Describe this document'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            hintText: 'e.g. Father’s bank statement (optional)',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(''),
            child: const Text('Skip'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    return result;
  }

  Future<void> _view(PortalDocumentItem item) async {
    final caseId = widget.caseId;
    if (caseId == null) return;
    try {
      final url =
          await ref.read(portalRepositoryProvider).documentSignedUrl(caseId, item.id);
      final ok = await openExternalUrl(url);
      if (!ok) _toast('Could not open the document.');
    } on AppError catch (e) {
      _toast(messageForError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final caseId = widget.caseId;
    if (caseId == null) {
      return const EmptyView(
        icon: Icons.description_outlined,
        title: 'No documents yet',
        message: 'Your document checklist appears here once your case is open.',
      );
    }

    final async = ref.watch(portalDocumentsProvider(caseId));
    return async.when(
      loading: () => const SkeletonList(),
      error: (e, _) => ErrorView(
        error: e,
        onRetry: () => ref.invalidate(portalDocumentsProvider(caseId)),
      ),
      data: (items) {
        final required = items.where((d) => !d.isAdditional).toList();
        final additional = items.where((d) => d.isAdditional).toList();
        return RefreshIndicator(
          color: AppTokens.brandNavy,
          onRefresh: () => ref.refresh(portalDocumentsProvider(caseId).future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space4, AppTokens.space4, AppTokens.space16),
            children: [
              if (required.isEmpty && additional.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: AppTokens.space12),
                  child: EmptyView(
                    icon: Icons.task_alt,
                    title: 'No documents requested yet',
                    message:
                        'Your officer will request the documents needed for your '
                        'application here.',
                  ),
                )
              else ...[
                const SectionLabel('Required documents'),
                const SizedBox(height: AppTokens.space2),
                for (final d in required) ...[
                  _DocCard(
                    item: d,
                    uploading: _uploading.contains(d.id),
                    onUpload: () => _uploadFor(d),
                    onView: () => _view(d),
                  ),
                  const SizedBox(height: AppTokens.space3),
                ],
                const SizedBox(height: AppTokens.space2),
                const SectionLabel('Additional documents'),
                const SizedBox(height: AppTokens.space2),
                for (final d in additional) ...[
                  _DocCard(
                    item: d,
                    uploading: _uploading.contains(d.id),
                    onUpload: () => _uploadFor(d),
                    onView: () => _view(d),
                  ),
                  const SizedBox(height: AppTokens.space3),
                ],
                OutlinedButton.icon(
                  onPressed: _addingExtra ? null : _addAdditional,
                  icon: _addingExtra
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.add, size: 18),
                  label: Text(_addingExtra ? 'Uploading…' : 'Add another document'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTokens.brandNavy,
                    side: const BorderSide(color: AppTokens.borderStrongLight),
                    padding: const EdgeInsets.symmetric(vertical: AppTokens.space3),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _DocCard extends StatelessWidget {
  final PortalDocumentItem item;
  final bool uploading;
  final VoidCallback onUpload;
  final VoidCallback onView;

  const _DocCard({
    required this.item,
    required this.uploading,
    required this.onUpload,
    required this.onView,
  });

  @override
  Widget build(BuildContext context) {
    final s = docStatusStyle(item.status);
    final hasUpload = item.latestVersion != null;
    return PremiumCard(
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
                      item.documentName,
                      style: const TextStyle(
                        fontSize: AppTokens.fontSizeBase,
                        fontWeight: FontWeight.w700,
                        color: AppTokens.textPrimaryLight,
                      ),
                    ),
                    if (item.criticality == 'CRITICAL' ||
                        item.criticality == 'REQUIRED')
                      const Padding(
                        padding: EdgeInsets.only(top: 2),
                        child: Text(
                          'Required',
                          style: TextStyle(
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
          if (item.description != null && item.description!.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            Text(
              item.description!,
              style: const TextStyle(
                fontSize: AppTokens.fontSizeSm,
                color: AppTokens.textSecondaryLight,
                height: 1.35,
              ),
            ),
          ],
          // Client-safe rejection reasons (backend-translated).
          if (item.isRejected && item.latestRejectionMessages.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space3),
            Container(
              padding: const EdgeInsets.all(AppTokens.space3),
              decoration: BoxDecoration(
                color: AppTokens.statusDangerBg,
                borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                border: Border.all(
                    color: AppTokens.statusDanger.withValues(alpha: 0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final r in item.latestRejectionMessages)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('• ',
                              style: TextStyle(color: AppTokens.statusDanger)),
                          Expanded(
                            child: Text(
                              r.clientMessage,
                              style: const TextStyle(
                                fontSize: AppTokens.fontSizeSm,
                                color: AppTokens.statusDanger,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (hasUpload) ...[
            const SizedBox(height: AppTokens.space3),
            Row(
              children: [
                const Icon(Icons.insert_drive_file_outlined,
                    size: 16, color: AppTokens.textMutedLight),
                const SizedBox(width: AppTokens.space2),
                Expanded(
                  child: Text(
                    item.latestVersion!.fileName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: AppTokens.fontSizeSm,
                      color: AppTokens.textSecondaryLight,
                    ),
                  ),
                ),
                if (item.latestVersion!.uploadedAt != null)
                  Text(
                    relativeTime(item.latestVersion!.uploadedAt!),
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTokens.textMutedLight,
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: AppTokens.space3),
          Row(
            children: [
              if (hasUpload)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onView,
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('View'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTokens.brandNavy,
                      side: const BorderSide(color: AppTokens.borderStrongLight),
                      padding:
                          const EdgeInsets.symmetric(vertical: AppTokens.space2),
                    ),
                  ),
                ),
              if (hasUpload && item.canUpload)
                const SizedBox(width: AppTokens.space2),
              if (item.canUpload)
                Expanded(
                  child: FilledButton.icon(
                    onPressed: uploading ? null : onUpload,
                    icon: uploading
                        ? const ButtonSpinner()
                        : Icon(item.isRejected
                            ? Icons.refresh
                            : Icons.upload_outlined),
                    label: Text(uploading
                        ? 'Uploading…'
                        : (item.isRejected ? 'Re-upload' : 'Upload')),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTokens.brandNavy,
                      padding:
                          const EdgeInsets.symmetric(vertical: AppTokens.space2),
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

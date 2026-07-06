import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/util/launchers.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/badges.dart';
import '../../agreements/presentation/agreements_screen.dart';
import '../../followups/presentation/followup_form_sheet.dart';
import '../../whatsapp/data/whatsapp_repository.dart';
import '../../whatsapp/domain/wa_thread.dart';
import '../../whatsapp/presentation/thread_screen.dart';
import '../data/employees_repository.dart';
import '../data/leads_providers.dart';
import '../data/leads_repository.dart';
import '../domain/lead.dart';
import 'lead_form_sheet.dart';
import 'lead_visuals.dart';

class LeadDetailScreen extends ConsumerStatefulWidget {
  final String leadId;
  const LeadDetailScreen({super.key, required this.leadId});

  @override
  ConsumerState<LeadDetailScreen> createState() => _LeadDetailScreenState();
}

class _LeadDetailScreenState extends ConsumerState<LeadDetailScreen> {
  bool _busy = false;
  bool _filesExpanded = false;
  List<LeadFile>? _files;
  bool _filesLoading = false;

  @override
  void initState() {
    super.initState();
    _loadFiles();
  }

  Future<void> _loadFiles() async {
    setState(() => _filesLoading = true);
    try {
      final list = await ref.read(leadsRepositoryProvider).files(widget.leadId);
      if (mounted) setState(() => _files = list);
    } catch (_) {
      if (mounted) setState(() => _files = []);
    } finally {
      if (mounted) setState(() => _filesLoading = false);
    }
  }

  Future<void> _uploadFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final picked = result.files.first;
    final path = picked.path;
    if (path == null) {
      _toast('Could not access file path.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).uploadFile(
            widget.leadId,
            filePath: path,
            fileName: picked.name,
          );
      _toast('File uploaded: ${picked.name}');
      await _loadFiles();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteFile(LeadFile f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete file?'),
        content: Text('Remove "${f.fileName}" from this lead?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: AppTokens.statusDanger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).deleteFile(widget.leadId, f.id);
      _toast('File deleted');
      await _loadFiles();
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openFile(LeadFile f) async {
    setState(() => _busy = true);
    try {
      final url = await ref
          .read(leadsRepositoryProvider)
          .fileUrl(widget.leadId, f.id);
      final ok = await openExternalUrl(url);
      if (!ok) _toast('No browser app available.');
    } catch (_) {
      _toast('Could not open file.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendVerification(Lead lead) async {
    setState(() => _busy = true);
    try {
      final sent =
          await ref.read(leadsRepositoryProvider).sendEmailVerification(lead.id);
      _toast(sent
          ? 'Verification email sent.'
          : 'Could not send — check the email address.');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeStatus(Lead lead) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(AppTokens.space4),
              child: Text('Change status',
                  style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            for (final s in kLeadStatuses)
              ListTile(
                title: Text(leadStatusLabel(s)),
                trailing: s == lead.status
                    ? const Icon(Icons.check, color: AppTokens.primary600)
                    : null,
                onTap: () => Navigator.of(ctx).pop(s),
              ),
            const SizedBox(height: AppTokens.space2),
          ],
        ),
      ),
    );
    if (picked == null || picked == lead.status) return;

    // Marking LOST requires a reason — that's the data that tells us WHY
    // leads die. Stored as a timestamped entry in the lead's notes so it's
    // visible on web and mobile alike.
    String? notesWithReason;
    if (picked == 'LOST') {
      final reason = await _promptText(
        title: 'Why was this lead lost?',
        hint: 'e.g. Chose another consultant, budget, not eligible…',
        confirmLabel: 'Mark lost',
      );
      if (reason == null || reason.trim().isEmpty) return; // cancelled
      notesWithReason = _appendNote(lead.notes, 'Lost: ${reason.trim()}');
    }

    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).update(
            lead.id,
            status: picked,
            notes: notesWithReason,
          );
      ref.invalidate(leadDetailProvider(lead.id));
      ref.invalidate(leadsListProvider);
      _toast('Status updated to ${leadStatusLabel(picked)}');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Append a timestamped entry to the lead's free-text notes.
  String _appendNote(String? existing, String entry) {
    final now = DateTime.now();
    final stamp =
        '${now.day}/${now.month}/${now.year} ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final prior = (existing ?? '').trim();
    return prior.isEmpty ? '[$stamp] $entry' : '$prior\n\n[$stamp] $entry';
  }

  /// Simple one-field text prompt. Returns null on cancel.
  Future<String?> _promptText({
    required String title,
    required String hint,
    String confirmLabel = 'Save',
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return result;
  }

  Future<void> _addNote(Lead lead) async {
    final text = await _promptText(
      title: 'Add note',
      hint: 'What happened? (visible to the whole team)',
      confirmLabel: 'Add note',
    );
    if (text == null || text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).update(
            lead.id,
            notes: _appendNote(lead.notes, text.trim()),
          );
      ref.invalidate(leadDetailProvider(lead.id));
      _toast('Note added');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _newFollowUp(Lead lead) async {
    final created = await showFollowUpForm(
      context,
      leadId: lead.id,
      leadName: lead.fullName,
    );
    if (created == true) _toast('Follow-up created');
  }

  Future<void> _edit(Lead lead) async {
    final saved = await showLeadForm(context, existing: lead);
    if (saved != null && mounted) {
      ref.invalidate(leadDetailProvider(lead.id));
      ref.invalidate(leadsListProvider);
      _toast('Lead updated');
    }
  }

  Future<void> _reassign(Lead lead) async {
    // Load employees list (cached in provider).
    final employees = await showModalBottomSheet<Employee>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => _ReassignSheet(
        currentEmployeeId: lead.assignedEmployee?.id,
      ),
    );
    if (employees == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).assign(lead.id, employees.id);
      ref.invalidate(leadDetailProvider(lead.id));
      ref.invalidate(leadsListProvider);
      _toast('Reassigned to ${employees.fullName}');
    } on AppError catch (e) {
      _toast(messageForError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _convert(Lead lead) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Convert to client'),
        content: Text(
            'Convert ${lead.fullName} into a client? This starts the finance & processing workflow.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Convert')),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).convert(lead.id);
      ref.invalidate(leadDetailProvider(lead.id));
      ref.invalidate(leadsListProvider);
      _toast('${lead.fullName} converted to client');
    } on AppError catch (e) {
      if (!mounted) return;
      if (lead.email != null && !lead.emailVerified) {
        final send = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Verified email needed'),
            content: Text(
                '${messageForError(e)}\n\nSend a verification email to ${lead.email} now?'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Not now')),
              FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Send')),
            ],
          ),
        );
        if (send == true) await _sendVerification(lead);
      } else {
        _toast(messageForError(e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _call(String phone) async {
    try {
      final ok = await callNumber(phone);
      if (!ok) _toast('No dialer app available.');
    } catch (_) {
      _toast('Could not open the dialer.');
    }
  }

  bool _waOpening = false;

  /// Open the CRM WhatsApp conversation for this lead IN-APP so the rep replies
  /// from the business number without hunting through the inbox. When the lead
  /// has no CRM conversation yet, offer to start one by sending an approved
  /// template from the business number (Meta requires a template for the first
  /// message), then land in the freshly-created chat.
  Future<void> _whatsapp(Lead lead) async {
    if (_waOpening) return;
    _waOpening = true;
    try {
      // 1) Resolve the lead's CRM thread.
      WhatsappThread? thread;
      _showWaSpinner();
      try {
        thread =
            await ref.read(whatsappRepositoryProvider).byLead(widget.leadId);
      } catch (_) {
        // ignore — the no-thread path below handles it
      }
      _dismissWaSpinner();
      if (!mounted) return;

      // 2) Existing conversation → open it in-app.
      if (thread != null) {
        final t = thread;
        await Navigator.of(context)
            .push(MaterialPageRoute(builder: (_) => ThreadScreen(thread: t)));
        return;
      }

      // 3) No conversation yet → offer to start one on the CRM number.
      final start = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Start WhatsApp chat'),
          content: Text(
            'No CRM WhatsApp conversation with ${lead.firstName} yet. Send the '
            'welcome template from the business number to start one?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Send template'),
            ),
          ],
        ),
      );
      if (start != true || !mounted) return;

      // 4) Send the template (creates the thread), then open the new chat.
      _showWaSpinner();
      try {
        final repo = ref.read(whatsappRepositoryProvider);
        final threadId = await repo.sendTemplateToLead(widget.leadId);
        final started = await repo.getThread(threadId);
        _dismissWaSpinner();
        if (!mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ThreadScreen(thread: started)),
        );
      } on AppError catch (e) {
        _dismissWaSpinner();
        if (mounted) _toast(messageForError(e));
      } catch (_) {
        _dismissWaSpinner();
        if (mounted) _toast('Could not start the WhatsApp chat.');
      }
    } finally {
      _waOpening = false;
    }
  }

  void _showWaSpinner() {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PopScope(
        canPop: false,
        child: Center(child: CircularProgressIndicator()),
      ),
    );
  }

  void _dismissWaSpinner() {
    if (mounted) Navigator.of(context, rootNavigator: true).pop();
  }

  Future<void> _emailLead(String email) async {
    try {
      final ok = await sendEmail(email);
      if (!ok) _toast('No email app available.');
    } catch (_) {
      _toast('Could not open the mail app.');
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(leadDetailProvider(widget.leadId));
    final lead = async.valueOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lead'),
        actions: [
          if (lead != null) ...[
            IconButton(
              tooltip: 'Edit',
              icon: const Icon(Icons.edit_outlined),
              onPressed: _busy ? null : () => _edit(lead),
            ),
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'reassign') _reassign(lead);
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'reassign',
                  child: Row(
                    children: [
                      Icon(Icons.swap_horiz, size: 18),
                      SizedBox(width: 10),
                      Text('Reassign'),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(leadDetailProvider(widget.leadId)),
        ),
        data: _body,
      ),
    );
  }

  Widget _body(Lead lead) {
    final t = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        Text(lead.fullName.isEmpty ? '(no name)' : lead.fullName,
            style: t.titleLarge),
        if (lead.referenceCode != null) ...[
          const SizedBox(height: 2),
          Text(lead.referenceCode!, style: t.bodySmall),
        ],
        const SizedBox(height: AppTokens.space3),
        Wrap(
          spacing: AppTokens.space2,
          runSpacing: AppTokens.space2,
          children: [
            StatusBadge(
                label: lead.statusLabel, color: leadStatusColor(lead.status)),
            if (lead.priority != null)
              StatusBadge(
                  label: lead.priorityLabel,
                  color: leadPriorityColor(lead.priority)),
            StatusBadge(
              label: lead.emailVerified ? 'Email verified' : 'Email unverified',
              color: lead.emailVerified
                  ? AppTokens.statusSuccess
                  : AppTokens.statusNeutral,
              icon: lead.emailVerified
                  ? Icons.verified_outlined
                  : Icons.mark_email_unread_outlined,
            ),
          ],
        ),
        const SizedBox(height: AppTokens.space4),
        // ── Quick actions ────────────────────────────────────────────────────
        Row(
          children: [
            Expanded(
              child: _QuickAction(
                icon: Icons.call,
                label: 'Call',
                onTap: lead.phone.isNotEmpty ? () => _call(lead.phone) : null,
              ),
            ),
            const SizedBox(width: AppTokens.space2),
            Expanded(
              child: _QuickAction(
                icon: Icons.chat_outlined,
                label: 'WhatsApp',
                onTap: lead.phone.isNotEmpty ? () => _whatsapp(lead) : null,
              ),
            ),
            const SizedBox(width: AppTokens.space2),
            Expanded(
              child: _QuickAction(
                icon: Icons.email_outlined,
                label: 'Email',
                onTap: (lead.email != null && lead.email!.isNotEmpty)
                    ? () => _emailLead(lead.email!)
                    : null,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTokens.space5),
        // ── Contact ──────────────────────────────────────────────────────────
        _section('Contact', [
          _row(Icons.phone_outlined, 'Phone', lead.phone),
          if (lead.email != null) _row(Icons.email_outlined, 'Email', lead.email!),
        ]),
        if (lead.email != null && !lead.emailVerified) ...[
          const SizedBox(height: AppTokens.space2),
          OutlinedButton.icon(
            onPressed: _busy ? null : () => _sendVerification(lead),
            icon: const Icon(Icons.send_outlined, size: 18),
            label: const Text('Send email verification'),
          ),
        ],
        const SizedBox(height: AppTokens.space5),
        // ── Details ──────────────────────────────────────────────────────────
        _section('Details', [
          _row(Icons.work_outline, 'Service', lead.serviceInterest ?? '—'),
          _row(Icons.public, 'Target country', lead.targetCountry ?? '—'),
          _row(Icons.campaign_outlined, 'Source', lead.sourceChannel ?? '—'),
          if (lead.serviceFeeAmount != null)
            _row(Icons.payments_outlined, 'Service fee',
                '${lead.serviceFeeCurrency ?? ''} ${lead.serviceFeeAmount}'.trim()),
          _row(Icons.person_outline, 'Assigned',
              lead.assignedEmployee?.fullName ?? 'Unassigned'),
          _row(Icons.schedule, 'Created', formatDateTime(lead.createdAt)),
        ]),
        if (lead.notes != null && lead.notes!.trim().isNotEmpty) ...[
          const SizedBox(height: AppTokens.space5),
          _section('Notes', [Text(lead.notes!, style: t.bodyMedium)]),
        ],
        // ── Agreements ───────────────────────────────────────────────────────
        const SizedBox(height: AppTokens.space5),
        Card(
          margin: EdgeInsets.zero,
          child: ListTile(
            leading: const CircleAvatar(
              radius: 16,
              backgroundColor: AppTokens.primary50,
              child: Icon(Icons.description_outlined,
                  size: 16, color: AppTokens.primary700),
            ),
            title: const Text('Agreements',
                style: TextStyle(fontWeight: FontWeight.w600)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => AgreementsScreen(leadId: lead.id),
              ),
            ),
          ),
        ),
        // ── Files ────────────────────────────────────────────────────────────
        const SizedBox(height: AppTokens.space5),
        _filesSection(lead),
        const SizedBox(height: AppTokens.space6),
        // ── Actions ──────────────────────────────────────────────────────────
        if (!lead.isConverted && !lead.isLost)
          FilledButton.icon(
            onPressed: _busy ? null : () => _convert(lead),
            icon: const Icon(Icons.how_to_reg_outlined),
            label: const Text('Convert to client'),
          ),
        if (lead.isConverted)
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: AppTokens.space2),
              child: Text('Converted to client',
                  style: TextStyle(
                      color: AppTokens.statusSuccess,
                      fontWeight: FontWeight.w600)),
            ),
          ),
        const SizedBox(height: AppTokens.space3),
        Row(
          children: [
            Expanded(
              child: FilledButton.tonalIcon(
                onPressed: _busy ? null : () => _addNote(lead),
                icon: const Icon(Icons.note_add_outlined),
                label: const Text('Add note'),
              ),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: FilledButton.tonalIcon(
                onPressed: _busy ? null : () => _newFollowUp(lead),
                icon: const Icon(Icons.add_task),
                label: const Text('Follow-up'),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTokens.space3),
        FilledButton.tonalIcon(
          onPressed: _busy ? null : () => _changeStatus(lead),
          icon: const Icon(Icons.swap_horiz),
          label: const Text('Change status'),
        ),
        const SizedBox(height: AppTokens.space8),
      ],
    );
  }

  Widget _filesSection(Lead lead) {
    final fileList = _files ?? [];
    return Card(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          ListTile(
            leading: const CircleAvatar(
              radius: 16,
              backgroundColor: AppTokens.primary50,
              child: Icon(Icons.attach_file, size: 16, color: AppTokens.primary700),
            ),
            title: Row(
              children: [
                const Text('Files',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                if (!_filesLoading && _files != null && _files!.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTokens.primary100,
                      borderRadius: const BorderRadius.all(Radius.circular(10)),
                    ),
                    child: Text('${_files!.length}',
                        style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: AppTokens.primary700)),
                  ),
                ],
              ],
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!_busy)
                  IconButton(
                    tooltip: 'Upload file',
                    icon: const Icon(Icons.upload_outlined, size: 20),
                    onPressed: _uploadFile,
                  ),
                Icon(_filesExpanded
                    ? Icons.expand_less
                    : Icons.expand_more),
              ],
            ),
            onTap: () => setState(() => _filesExpanded = !_filesExpanded),
          ),
          if (_filesExpanded) ...[
            const Divider(height: 1),
            if (_filesLoading)
              const Padding(
                padding: EdgeInsets.all(AppTokens.space4),
                child: Center(
                    child: SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2))),
              )
            else if (fileList.isEmpty)
              const Padding(
                padding: EdgeInsets.all(AppTokens.space4),
                child: Text('No files attached yet.',
                    style: TextStyle(color: AppTokens.textMutedLight)),
              )
            else
              for (final f in fileList)
                ListTile(
                  dense: true,
                  leading: Icon(
                    _mimeIcon(f.fileMimeType),
                    size: 20,
                    color: AppTokens.primary600,
                  ),
                  title: Text(f.fileName,
                      maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: f.fileSizeBytes != null
                      ? Text(_formatBytes(f.fileSizeBytes!),
                          style: const TextStyle(
                              fontSize: AppTokens.fontSizeXs))
                      : null,
                  trailing: IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline,
                        size: 18, color: AppTokens.statusDanger),
                    onPressed: _busy ? null : () => _deleteFile(f),
                  ),
                  onTap: _busy ? null : () => _openFile(f),
                ),
          ],
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: AppTokens.fontSizeXs,
                fontWeight: FontWeight.w700,
                color: AppTokens.statusNeutral,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: AppTokens.space3),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.space3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppTokens.statusNeutral),
          const SizedBox(width: AppTokens.space3),
          SizedBox(
            width: 96,
            child: Text(label,
                style: const TextStyle(
                    color: AppTokens.statusNeutral,
                    fontSize: AppTokens.fontSizeSm)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(
                    fontSize: AppTokens.fontSizeSm,
                    fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }
}

// ── Employee reassign bottom sheet ────────────────────────────────────────────

class _ReassignSheet extends ConsumerWidget {
  final String? currentEmployeeId;
  const _ReassignSheet({this.currentEmployeeId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(employeesListProvider);
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      minChildSize: 0.4,
      expand: false,
      builder: (_, ctrl) => Column(
        children: [
          const SizedBox(height: AppTokens.space2),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppTokens.borderLight,
              borderRadius: const BorderRadius.all(Radius.circular(2)),
            ),
          ),
          const SizedBox(height: AppTokens.space3),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppTokens.space4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Reassign lead',
                  style: TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w700)),
            ),
          ),
          const Divider(height: AppTokens.space4),
          Expanded(
            child: async.when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(
                error: e,
                onRetry: () => ref.invalidate(employeesListProvider),
              ),
              data: (employees) {
                if (employees.isEmpty) {
                  return const EmptyView(
                    icon: Icons.people_outline,
                    title: 'No employees found',
                    message: 'No employees available to assign.',
                  );
                }
                return ListView.separated(
                  controller: ctrl,
                  itemCount: employees.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final e = employees[i];
                    final isCurrent = e.id == currentEmployeeId;
                    return ListTile(
                      leading: CircleAvatar(
                        radius: 18,
                        backgroundColor: AppTokens.primary100,
                        child: Text(
                          _initials(e.fullName),
                          style: const TextStyle(
                              color: AppTokens.primary700,
                              fontWeight: FontWeight.w700,
                              fontSize: 12),
                        ),
                      ),
                      title: Text(e.fullName),
                      subtitle: e.code != null ? Text(e.code!) : null,
                      trailing: isCurrent
                          ? const Icon(Icons.check_circle,
                              color: AppTokens.primary600)
                          : null,
                      onTap: () => Navigator.of(context).pop(e),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

String _initials(String name) {
  final parts = name.trim().split(' ');
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts[0][0].toUpperCase();
  return '${parts[0][0]}${parts[parts.length - 1][0]}'.toUpperCase();
}

// ── Quick action tile ─────────────────────────────────────────────────────────

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  const _QuickAction({required this.icon, required this.label, this.onTap});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final color =
        enabled ? AppTokens.primary700 : AppTokens.textDisabledLight;
    return Material(
      color: AppTokens.primary50,
      borderRadius: const BorderRadius.all(AppTokens.radiusLg),
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(AppTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTokens.space3),
          child: Column(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(height: 4),
              Text(label,
                  style: TextStyle(
                      color: color,
                      fontSize: AppTokens.fontSizeSm,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

IconData _mimeIcon(String? mime) {
  if (mime == null) return Icons.insert_drive_file_outlined;
  if (mime.startsWith('image/')) return Icons.image_outlined;
  if (mime == 'application/pdf') return Icons.picture_as_pdf_outlined;
  if (mime.contains('word') || mime.contains('document')) {
    return Icons.description_outlined;
  }
  if (mime.contains('sheet') || mime.contains('excel')) {
    return Icons.table_chart_outlined;
  }
  return Icons.insert_drive_file_outlined;
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

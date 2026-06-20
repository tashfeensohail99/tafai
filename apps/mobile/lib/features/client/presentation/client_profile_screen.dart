import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/portal_providers.dart';
import '../data/portal_repository.dart';
import '../domain/portal_models.dart';

/// Read-only client profile, opened from the client shell menu. Clients can't
/// edit fields directly in Phase 1 — the "Request an update" action sends the
/// requested change to their consultant as a message
/// (POST /portal/profile/update-request).
class ClientProfileScreen extends ConsumerWidget {
  const ClientProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(portalProfileProvider);
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: const Text('My profile',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
      body: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorView(
          error: e,
          onRetry: () => ref.invalidate(portalProfileProvider),
        ),
        data: (p) => RefreshIndicator(
          color: AppTokens.brandNavy,
          onRefresh: () async {
            ref.invalidate(portalProfileProvider);
            await ref.read(portalProfileProvider.future);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                AppTokens.space4, AppTokens.space4, AppTokens.space16),
            children: [
              PremiumCard(
                padding: const EdgeInsets.all(AppTokens.space4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p.fullName.isEmpty ? '—' : p.fullName,
                      style: const TextStyle(
                          fontSize: AppTokens.fontSizeLg,
                          fontWeight: FontWeight.w700,
                          color: AppTokens.textPrimaryLight),
                    ),
                    if (p.status != null && p.status!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(titleCaseEnum(p.status!),
                          style: const TextStyle(
                              fontSize: AppTokens.fontSizeSm,
                              color: AppTokens.textMutedLight)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppTokens.space4),
              _group('Contact', [
                _row('Email', p.email),
                _row('Phone', p.phone),
                _row('Alternate phone', p.alternatePhone),
                _row('Address', p.address),
              ]),
              const SizedBox(height: AppTokens.space4),
              _group('Identity', [
                _row('Nationality', p.nationality),
                _row('Date of birth',
                    p.dateOfBirth != null ? formatDate(p.dateOfBirth!) : null),
                _row('Passport #', p.passportNumberMasked),
                _row('National ID / CNIC', p.cnicMasked),
              ]),
              const SizedBox(height: AppTokens.space4),
              _group('Your case', [
                _row(
                    'Service',
                    p.serviceType != null
                        ? titleCaseEnum(p.serviceType!)
                        : null),
                _row('Destination', p.targetCountry),
                _row('Consultant', p.assignedSalesPersonName),
              ]),
              const SizedBox(height: AppTokens.space5),
              Container(
                padding: const EdgeInsets.all(AppTokens.space4),
                decoration: BoxDecoration(
                  color: AppTokens.primary50,
                  borderRadius: const BorderRadius.all(AppTokens.radiusCard),
                  border: Border.all(color: AppTokens.primary100),
                ),
                child: const Text(
                  'Need to correct something? Send your consultant an update '
                  'request and they’ll make the change for you.',
                  style: TextStyle(
                      fontSize: AppTokens.fontSizeSm,
                      height: 1.4,
                      color: AppTokens.textSecondaryLight),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              SizedBox(
                height: 50,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                      backgroundColor: AppTokens.primary600),
                  onPressed: () => _requestUpdate(context, ref),
                  icon: const Icon(Icons.edit_note_outlined, size: 20),
                  label: const Text('Request an update'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _group(String label, List<Widget> rows) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionLabel(label),
          const SizedBox(height: AppTokens.space2),
          PremiumCard(
            padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space4, vertical: AppTokens.space2),
            child: Column(children: rows),
          ),
        ],
      );

  Widget _row(String label, String? value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: AppTokens.space2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 124,
              child: Text(label,
                  style: const TextStyle(
                      fontSize: AppTokens.fontSizeSm,
                      color: AppTokens.textMutedLight)),
            ),
            const SizedBox(width: AppTokens.space2),
            Expanded(
              child: Text(
                (value == null || value.trim().isEmpty) ? '—' : value,
                style: const TextStyle(
                    fontSize: AppTokens.fontSizeSm,
                    fontWeight: FontWeight.w600,
                    color: AppTokens.textPrimaryLight),
              ),
            ),
          ],
        ),
      );

  Future<void> _requestUpdate(BuildContext context, WidgetRef ref) async {
    final text = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _RequestUpdateSheet(),
    );
    if (text == null) return;
    try {
      await ref.read(portalRepositoryProvider).requestProfileUpdate(
            content: text,
            subject: 'Profile update request',
          );
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Update request sent to your consultant.')));
      }
    } on AppError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }
}

class _RequestUpdateSheet extends StatefulWidget {
  const _RequestUpdateSheet();

  @override
  State<_RequestUpdateSheet> createState() => _RequestUpdateSheetState();
}

class _RequestUpdateSheetState extends State<_RequestUpdateSheet> {
  final _ctrl = TextEditingController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canSend = _ctrl.text.trim().isNotEmpty;
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
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
              Text('Request a profile update',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              const Text(
                'Tell your consultant what to change (name, phone, email, '
                'address, etc.) and they’ll update it for you.',
                style:
                    TextStyle(fontSize: 13, color: AppTokens.textMutedLight),
              ),
              const SizedBox(height: AppTokens.space4),
              TextField(
                controller: _ctrl,
                maxLines: 4,
                autofocus: true,
                onChanged: (_) => setState(() {}),
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'What should we update?',
                  border: OutlineInputBorder(),
                ),
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
                      ? () => Navigator.of(context).pop(_ctrl.text.trim())
                      : null,
                  child: const Text('Send request'),
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

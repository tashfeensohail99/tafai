import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/country_picker.dart';
import '../data/processing_providers.dart';
import '../data/processing_repository.dart';
import '../domain/processing_models.dart';
import 'case_workspace_screen.dart';
import 'processing_ui.dart';

/// New-client form — a Processing Manager's manual on-ramp (POST
/// /processing/clients). Creates a Lead → Client (with a provisioned portal
/// login) → an INTAKE_PENDING case, optionally with a finance snapshot.
/// Manager-only: reached from the Manager dashboard and server-gated on
/// `processing.intake.acknowledge`. On success it shows a "done" state with the
/// portal-login + finance outcomes and a button to open the case or reset.
class NewClientScreen extends ConsumerStatefulWidget {
  const NewClientScreen({super.key});

  @override
  ConsumerState<NewClientScreen> createState() => _NewClientScreenState();
}

class _NewClientScreenState extends ConsumerState<NewClientScreen> {
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _nationality = TextEditingController();

  String _service = kServiceTypes.first.key;
  String? _targetCountry;
  String _priority = 'NORMAL';

  // Finance (optional).
  bool _addFinance = false;
  final _totalFee = TextEditingController();
  String _currency = 'PKR';
  final _amountReceived = TextEditingController();
  String _paymentMethod = 'Bank transfer';
  DateTime? _paidAt;
  final _transactionRef = TextEditingController();

  bool _busy = false;
  CreatedClientResult? _created;

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _email.dispose();
    _phone.dispose();
    _nationality.dispose();
    _totalFee.dispose();
    _amountReceived.dispose();
    _transactionRef.dispose();
    super.dispose();
  }

  static final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  bool get _emailValid => _emailRe.hasMatch(_email.text.trim());

  double? get _feeAmount => double.tryParse(_totalFee.text.trim());
  double? get _receivedAmount =>
      _amountReceived.text.trim().isEmpty
          ? 0
          : double.tryParse(_amountReceived.text.trim());

  String? get _financeError {
    if (!_addFinance) return null;
    final fee = _feeAmount;
    if (fee == null || fee <= 0) return 'Total service fee must be a positive number.';
    final received = _receivedAmount;
    if (received == null || received < 0) {
      return 'Amount received must be zero or a positive number.';
    }
    if (received > fee + 0.01) {
      return 'Amount received cannot exceed the total service fee.';
    }
    return null;
  }

  bool get _canSubmit =>
      _firstName.text.trim().isNotEmpty &&
      _lastName.text.trim().isNotEmpty &&
      _emailValid &&
      _targetCountry != null &&
      _targetCountry!.isNotEmpty &&
      (!_addFinance || _financeError == null);

  Future<void> _pickPaidAt() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _paidAt ?? DateTime.now(),
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _paidAt = picked);
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() => _busy = true);
    try {
      ManualClientFinanceInput? finance;
      if (_addFinance) {
        final paid = _paidAt;
        finance = ManualClientFinanceInput(
          totalFee: _totalFee.text.trim(),
          currency: _currency,
          amountReceived: _amountReceived.text.trim().isEmpty
              ? null
              : _amountReceived.text.trim(),
          paymentMethod:
              _amountReceived.text.trim().isEmpty ? null : _paymentMethod,
          paidAt: paid == null
              ? null
              : '${paid.year.toString().padLeft(4, '0')}-${paid.month.toString().padLeft(2, '0')}-${paid.day.toString().padLeft(2, '0')}',
          transactionRef: _transactionRef.text.trim().isEmpty
              ? null
              : _transactionRef.text.trim(),
        );
      }
      final result = await ref.read(processingRepositoryProvider).createClient(
            firstName: _firstName.text.trim(),
            lastName: _lastName.text.trim(),
            email: _email.text.trim(),
            phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
            service: _service,
            targetCountry: _targetCountry!,
            nationality: _nationality.text.trim().isEmpty
                ? null
                : _nationality.text.trim(),
            priority: _priority,
            finance: finance,
          );
      // The new case lands in the intake queue + admin overview — refresh both.
      ref.invalidate(intakeQueueProvider);
      ref.invalidate(processingAdminOverviewProvider);
      if (mounted) setState(() => _created = result);
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _reset() {
    _firstName.clear();
    _lastName.clear();
    _email.clear();
    _phone.clear();
    _nationality.clear();
    _totalFee.clear();
    _amountReceived.clear();
    _transactionRef.clear();
    setState(() {
      _service = kServiceTypes.first.key;
      _targetCountry = null;
      _priority = 'NORMAL';
      _addFinance = false;
      _currency = 'PKR';
      _paymentMethod = 'Bank transfer';
      _paidAt = null;
      _created = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: const Text('New client',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
      body: _created != null
          ? _DoneView(result: _created!, onReset: _reset)
          : _form(),
    );
  }

  Widget _form() {
    final financeErr = _financeError;
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        const SectionLabel('Client details'),
        const SizedBox(height: AppTokens.space2),
        SectionCard(
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _firstName,
                      maxLength: 120,
                      textCapitalization: TextCapitalization.words,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'First name *',
                        border: OutlineInputBorder(),
                        counterText: '',
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTokens.space3),
                  Expanded(
                    child: TextField(
                      controller: _lastName,
                      maxLength: 120,
                      textCapitalization: TextCapitalization.words,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Last name *',
                        border: OutlineInputBorder(),
                        counterText: '',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _email,
                maxLength: 160,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'Email *',
                  helperText: 'Portal login details are emailed here',
                  errorText: _email.text.trim().isEmpty || _emailValid
                      ? null
                      : 'Enter a valid email',
                  border: const OutlineInputBorder(),
                  counterText: '',
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _phone,
                maxLength: 40,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone',
                  helperText: 'Optional — add later for WhatsApp',
                  border: OutlineInputBorder(),
                  counterText: '',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.space5),
        const SectionLabel('Service & destination'),
        const SizedBox(height: AppTokens.space2),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _service,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Service *',
                  border: OutlineInputBorder(),
                ),
                items: kServiceTypes
                    .map((e) => DropdownMenuItem(
                        value: e.key, child: Text(e.value)))
                    .toList(),
                onChanged: (v) => setState(() => _service = v ?? _service),
              ),
              const SizedBox(height: AppTokens.space3),
              InkWell(
                onTap: () async {
                  final picked = await showCountryPicker(context,
                      current: _targetCountry);
                  if (picked != null) setState(() => _targetCountry = picked);
                },
                borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Target country *',
                    border: OutlineInputBorder(),
                  ),
                  child: Text(
                    _targetCountry ?? 'Select destination country…',
                    style: TextStyle(
                      fontSize: 14,
                      color: _targetCountry == null
                          ? AppTokens.textMutedLight
                          : AppTokens.textPrimaryLight,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              TextField(
                controller: _nationality,
                maxLength: 80,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Nationality',
                  helperText: 'Optional',
                  border: OutlineInputBorder(),
                  counterText: '',
                ),
              ),
              const SizedBox(height: AppTokens.space3),
              const SectionLabel('Priority'),
              const SizedBox(height: AppTokens.space2),
              Wrap(
                spacing: AppTokens.space2,
                runSpacing: AppTokens.space2,
                children: [
                  for (final p in kProcessingPriorities)
                    ChoiceChip(
                      label: Text(priorityLabel(p)),
                      selected: _priority == p,
                      onSelected: (_) => setState(() => _priority = p),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTokens.space5),
        const SectionLabel('Finance (optional)'),
        const SizedBox(height: AppTokens.space2),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SwitchListTile(
                value: _addFinance,
                dense: true,
                contentPadding: EdgeInsets.zero,
                activeThumbColor: AppTokens.primary600,
                title: const Text('Add finance details',
                    style: TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w600)),
                subtitle: const Text(
                    'Record the agreed fee + any payment received',
                    style: TextStyle(fontSize: 11.5)),
                onChanged: (v) => setState(() => _addFinance = v),
              ),
              if (_addFinance) ...[
                const SizedBox(height: AppTokens.space2),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 96,
                      child: DropdownButtonFormField<String>(
                        initialValue: _currency,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Currency',
                          border: OutlineInputBorder(),
                        ),
                        items: kManualClientCurrencies
                            .map((c) =>
                                DropdownMenuItem(value: c, child: Text(c)))
                            .toList(),
                        onChanged: (v) =>
                            setState(() => _currency = v ?? _currency),
                      ),
                    ),
                    const SizedBox(width: AppTokens.space3),
                    Expanded(
                      child: TextField(
                        controller: _totalFee,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: 'Total service fee *',
                          helperText: 'Agreed fee in $_currency',
                          border: const OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppTokens.space3),
                TextField(
                  controller: _amountReceived,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Amount received',
                    helperText: 'Leave blank if nothing paid yet',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: AppTokens.space3),
                DropdownButtonFormField<String>(
                  initialValue: _paymentMethod,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Payment method',
                    border: OutlineInputBorder(),
                  ),
                  items: kManualClientPaymentMethods
                      .map((m) => DropdownMenuItem(value: m, child: Text(m)))
                      .toList(),
                  // Method only matters when something was received.
                  onChanged: _amountReceived.text.trim().isEmpty
                      ? null
                      : (v) =>
                          setState(() => _paymentMethod = v ?? _paymentMethod),
                ),
                const SizedBox(height: AppTokens.space3),
                InkWell(
                  onTap: _pickPaidAt,
                  borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Payment date',
                      helperText: 'Optional — defaults to today',
                      border: OutlineInputBorder(),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.calendar_today_outlined,
                            size: 16, color: AppTokens.textMutedLight),
                        const SizedBox(width: AppTokens.space2),
                        Text(
                          _paidAt == null
                              ? 'Today'
                              : '${_paidAt!.year}-${_paidAt!.month.toString().padLeft(2, '0')}-${_paidAt!.day.toString().padLeft(2, '0')}',
                          style: const TextStyle(fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppTokens.space3),
                TextField(
                  controller: _transactionRef,
                  maxLength: 120,
                  decoration: const InputDecoration(
                    labelText: 'Transaction ref',
                    border: OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
                if (financeErr != null) ...[
                  const SizedBox(height: AppTokens.space2),
                  Text(financeErr,
                      style: const TextStyle(
                          fontSize: 12, color: AppTokens.statusDanger)),
                ],
                const SizedBox(height: AppTokens.space2),
                const Text(
                  'Recorded as a real invoice. The firm books in CAD — amounts '
                  'convert at today\'s rate. When an amount received is entered, '
                  'the payment is verified and a receipt is issued automatically.',
                  style: TextStyle(
                      fontSize: 11.5, color: AppTokens.textMutedLight),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppTokens.space5),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: _canSubmit && !_busy ? _submit : null,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Create client'),
          ),
        ),
        const SizedBox(height: AppTokens.space4),
      ],
    );
  }
}

/// Success "done" state — created client/case summary + portal-login and
/// finance outcome chips, with actions to open the case or create another.
class _DoneView extends StatelessWidget {
  final CreatedClientResult result;
  final VoidCallback onReset;
  const _DoneView({required this.result, required this.onReset});

  @override
  Widget build(BuildContext context) {
    final login = result.portalLogin;
    final finance = result.finance;
    return ListView(
      padding: const EdgeInsets.all(AppTokens.space4),
      children: [
        const SizedBox(height: AppTokens.space4),
        const Center(
          child: Icon(Icons.check_circle_outline,
              size: 56, color: AppTokens.statusSuccess),
        ),
        const SizedBox(height: AppTokens.space3),
        Center(
          child: Text('Client created',
              style: Theme.of(context).textTheme.titleLarge),
        ),
        const SizedBox(height: AppTokens.space2),
        Center(
          child: Text(
            '${result.personName} has been added with a ready document '
            'checklist, and a case is now in the intake queue. Acknowledge it '
            'to assign an associate.',
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 13, color: AppTokens.textMutedLight, height: 1.5),
          ),
        ),
        if (result.referenceCode != null) ...[
          const SizedBox(height: AppTokens.space2),
          Center(
            child: StatusPill(
              label: 'Ref ${result.referenceCode}',
              tone: const ToneColors(
                  AppTokens.statusInfo, AppTokens.statusInfoBg),
            ),
          ),
        ],
        const SizedBox(height: AppTokens.space5),
        _OutcomeCard(
          icon: Icons.vpn_key_outlined,
          tone: login.provisioned
              ? const ToneColors(
                  AppTokens.statusInfo, AppTokens.statusInfoBg)
              : login.alreadyHadLogin
                  ? const ToneColors(
                      AppTokens.statusNeutral, AppTokens.statusNeutralBg)
                  : const ToneColors(
                      AppTokens.statusWarning, AppTokens.statusWarningBg),
          title: 'Portal login',
          message: login.provisioned
              ? 'Portal login created — credentials emailed to ${login.email ?? 'the client'}.'
              : login.alreadyHadLogin
                  ? 'This person already had a portal login — no new email was sent.'
                  : 'Portal login could not be created (client role missing) — contact an admin.',
        ),
        if (finance != null) ...[
          const SizedBox(height: AppTokens.space3),
          _OutcomeCard(
            icon: Icons.account_balance_wallet_outlined,
            tone: finance.recorded
                ? const ToneColors(
                    AppTokens.statusSuccess, AppTokens.statusSuccessBg)
                : const ToneColors(
                    AppTokens.statusWarning, AppTokens.statusWarningBg),
            title: 'Finance',
            message: finance.recorded
                ? _financeMessage(finance)
                : 'Fee could not be recorded automatically — record it in Finance.',
          ),
        ],
        const SizedBox(height: AppTokens.space6),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: result.caseId.isEmpty
                ? null
                : () => Navigator.of(context).pushReplacement(
                      MaterialPageRoute(
                        builder: (_) =>
                            CaseWorkspaceScreen(caseId: result.caseId),
                      ),
                    ),
            icon: const Icon(Icons.folder_open_outlined),
            label: const Text('Open case'),
          ),
        ),
        const SizedBox(height: AppTokens.space3),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: onReset,
            icon: const Icon(Icons.add),
            label: const Text('Create another'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTokens.primary600,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ),
      ],
    );
  }

  String _financeMessage(CreatedClientFinance f) {
    final cur = f.currency ?? '';
    final fee = f.feeAmount;
    final received = f.receivedAmount;
    final parts = <String>[];
    if (fee != null) {
      parts.add('Fee recorded: ${fee.toStringAsFixed(0)} $cur'
          '${f.invoiceNumber != null ? ' (invoice ${f.invoiceNumber})' : ''}.');
    }
    if (received != null && received > 0) {
      parts.add('Received ${received.toStringAsFixed(0)} $cur'
          '${f.receiptNumber != null ? ' — receipt ${f.receiptNumber}' : ''}.');
    } else {
      parts.add('No payment recorded yet.');
    }
    return parts.join(' ');
  }
}

class _OutcomeCard extends StatelessWidget {
  final IconData icon;
  final ToneColors tone;
  final String title;
  final String message;
  const _OutcomeCard({
    required this.icon,
    required this.tone,
    required this.title,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: tone.bg,
              borderRadius: const BorderRadius.all(AppTokens.radiusMd),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 18, color: tone.fg),
          ),
          const SizedBox(width: AppTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(message,
                    style: const TextStyle(
                        fontSize: 12.5,
                        color: AppTokens.textSecondaryLight,
                        height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

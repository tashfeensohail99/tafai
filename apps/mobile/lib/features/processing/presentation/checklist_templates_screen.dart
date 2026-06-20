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
import 'processing_ui.dart';

/// Checklist templates admin — manager-only CRUD over the per-(service,
/// country) document requirement templates (GET/POST/PATCH/DELETE
/// /processing/checklist-templates). Reached from the Manager dashboard and
/// server-gated on `processing.checklist.manage`. List with client-side
/// service/country filters, create + edit (full-screen form), and a
/// confirm-gated deactivate (soft delete).
class ChecklistTemplatesScreen extends ConsumerStatefulWidget {
  const ChecklistTemplatesScreen({super.key});

  @override
  ConsumerState<ChecklistTemplatesScreen> createState() =>
      _ChecklistTemplatesScreenState();
}

class _ChecklistTemplatesScreenState
    extends ConsumerState<ChecklistTemplatesScreen> {
  String? _serviceFilter;
  String? _countryFilter;

  Future<void> _openForm({ChecklistTemplate? existing}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _TemplateFormScreen(existing: existing),
      ),
    );
    if (saved == true) ref.invalidate(checklistTemplatesProvider);
  }

  Future<void> _deactivate(ChecklistTemplate t) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Deactivate template?'),
        content: Text(
            'Deactivate "${t.documentName}" for ${labelForServiceCode(t.service)} → ${t.targetCountry}? '
            'It will no longer be added to new cases. Existing cases keep their copy.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppTokens.statusDanger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Deactivate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(processingRepositoryProvider)
          .deactivateChecklistTemplate(t.id);
      ref.invalidate(checklistTemplatesProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Template deactivated.')),
        );
      }
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(checklistTemplatesProvider);
    return Scaffold(
      backgroundColor: AppTokens.pageBackground,
      appBar: AppBar(
        backgroundColor: AppTokens.brandNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: const Text('Checklist Templates',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTokens.primary600,
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add),
        label: const Text('New template'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(checklistTemplatesProvider.future),
        child: async.when(
          loading: () => const SkeletonList(),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(AppTokens.space6),
              child: ErrorView(
                error: e,
                onRetry: () => ref.invalidate(checklistTemplatesProvider),
              ),
            ),
          ]),
          data: (all) {
            if (all.isEmpty) {
              return ListView(children: const [
                Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: EmptyView(
                    icon: Icons.checklist_outlined,
                    title: 'No templates yet',
                    message:
                        'Create your first template, or rely on the seeded '
                        'GLOBAL templates per service.',
                  ),
                ),
              ]);
            }
            final services = (all.map((t) => t.service).toSet().toList())
              ..sort();
            final countries = (all.map((t) => t.targetCountry).toSet().toList())
              ..sort();
            final filtered = all.where((t) {
              if (_serviceFilter != null && t.service != _serviceFilter) {
                return false;
              }
              if (_countryFilter != null &&
                  t.targetCountry != _countryFilter) {
                return false;
              }
              return true;
            }).toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                  AppTokens.space4, AppTokens.space4, 88),
              children: [
                _filterRow(services, countries, filtered.length),
                const SizedBox(height: AppTokens.space4),
                if (filtered.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: EmptyView(
                      icon: Icons.filter_alt_off_outlined,
                      title: 'No templates match this filter',
                      message: 'Adjust the filters or create a new template.',
                    ),
                  )
                else
                  for (final t in filtered) ...[
                    _TemplateCard(
                      template: t,
                      onEdit: () => _openForm(existing: t),
                      onDeactivate: () => _deactivate(t),
                    ),
                    const SizedBox(height: AppTokens.space3),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _filterRow(List<String> services, List<String> countries, int count) {
    return Row(
      children: [
        Expanded(
          child: DropdownButtonFormField<String?>(
            initialValue: _serviceFilter,
            isExpanded: true,
            isDense: true,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              isDense: true,
            ),
            hint: const Text('All services', style: TextStyle(fontSize: 13)),
            items: [
              const DropdownMenuItem<String?>(
                  value: null, child: Text('All services')),
              for (final s in services)
                DropdownMenuItem<String?>(
                    value: s, child: Text(labelForServiceCode(s))),
            ],
            onChanged: (v) => setState(() => _serviceFilter = v),
          ),
        ),
        const SizedBox(width: AppTokens.space2),
        Expanded(
          child: DropdownButtonFormField<String?>(
            initialValue: _countryFilter,
            isExpanded: true,
            isDense: true,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              isDense: true,
            ),
            hint: const Text('All countries', style: TextStyle(fontSize: 13)),
            items: [
              const DropdownMenuItem<String?>(
                  value: null, child: Text('All countries')),
              for (final c in countries)
                DropdownMenuItem<String?>(value: c, child: Text(c)),
            ],
            onChanged: (v) => setState(() => _countryFilter = v),
          ),
        ),
      ],
    );
  }
}

class _TemplateCard extends StatelessWidget {
  final ChecklistTemplate template;
  final VoidCallback onEdit;
  final VoidCallback onDeactivate;
  const _TemplateCard({
    required this.template,
    required this.onEdit,
    required this.onDeactivate,
  });

  @override
  Widget build(BuildContext context) {
    final t = template;
    final validity = kValidityRuleShort[t.validityRule] ?? t.validityRule;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(t.documentName,
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w600)),
              ),
              StatusPill(
                label: criticalityLabel(t.criticality),
                tone: criticalityTone(t.criticality),
              ),
            ],
          ),
          if (t.description != null && t.description!.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(t.description!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 12, color: AppTokens.textMutedLight)),
          ],
          const SizedBox(height: AppTokens.space2),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.public,
                      size: 13, color: AppTokens.textMutedLight),
                  const SizedBox(width: 4),
                  Text(
                    '${labelForServiceCode(t.service)} · ${t.targetCountry}',
                    style: const TextStyle(
                        fontSize: 12, color: AppTokens.textMutedLight),
                  ),
                ],
              ),
              Text(
                t.validityRule == 'MUST_BE_VALID_FOR_N_MONTHS' &&
                        t.validityMonths != null
                    ? '$validity (${t.validityMonths}m)'
                    : validity,
                style: const TextStyle(
                    fontSize: 12, color: AppTokens.textMutedLight),
              ),
              Text('Order ${t.sortOrder}',
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.textMutedLight)),
            ],
          ),
          const SizedBox(height: AppTokens.space3),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined, size: 15),
                label: const Text('Edit'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTokens.textSecondaryLight,
                  visualDensity: VisualDensity.compact,
                ),
              ),
              const SizedBox(width: AppTokens.space2),
              OutlinedButton.icon(
                onPressed: onDeactivate,
                icon: const Icon(Icons.block_outlined, size: 15),
                label: const Text('Deactivate'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTokens.statusDanger,
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Create / edit form (full-screen — the field set is long). On create, service
// + target country are editable; on edit they're locked (immutable server-side).
// Pops `true` after a successful save so the list invalidates.
// ---------------------------------------------------------------------------

class _TemplateFormScreen extends ConsumerStatefulWidget {
  final ChecklistTemplate? existing;
  const _TemplateFormScreen({this.existing});

  @override
  ConsumerState<_TemplateFormScreen> createState() =>
      _TemplateFormScreenState();
}

class _TemplateFormScreenState extends ConsumerState<_TemplateFormScreen> {
  late final TextEditingController _documentName;
  late final TextEditingController _description;
  late final TextEditingController _maxFileSize;
  late final TextEditingController _validityMonths;
  late final TextEditingController _bufferDays;
  late final TextEditingController _guidanceUrl;
  late final TextEditingController _sortOrder;

  late String _service;
  String? _targetCountry;
  late String _criticality;
  late String _validityRule;
  late Set<String> _formats;

  bool _busy = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _documentName = TextEditingController(text: e?.documentName ?? '');
    _description = TextEditingController(text: e?.description ?? '');
    _maxFileSize = TextEditingController(
        text: e?.maxFileSizeMb != null ? '${e!.maxFileSizeMb}' : '');
    _validityMonths = TextEditingController(
        text: e?.validityMonths != null ? '${e!.validityMonths}' : '');
    _bufferDays = TextEditingController(
        text: e?.validityBufferDays != null ? '${e!.validityBufferDays}' : '');
    _guidanceUrl = TextEditingController(text: e?.guidanceUrl ?? '');
    _sortOrder = TextEditingController(text: '${e?.sortOrder ?? 0}');
    _service = e?.service ?? kServiceTypes.first.key;
    _targetCountry = e?.targetCountry;
    _criticality = e?.criticality ?? 'REQUIRED';
    _validityRule = e?.validityRule ?? 'NONE';
    _formats = {...(e?.expectedFormats ?? const ['PDF'])};
  }

  @override
  void dispose() {
    _documentName.dispose();
    _description.dispose();
    _maxFileSize.dispose();
    _validityMonths.dispose();
    _bufferDays.dispose();
    _guidanceUrl.dispose();
    _sortOrder.dispose();
    super.dispose();
  }

  bool get _needsMonths => _validityRule == 'MUST_BE_VALID_FOR_N_MONTHS';

  bool get _canSave =>
      _documentName.text.trim().isNotEmpty &&
      _targetCountry != null &&
      _targetCountry!.isNotEmpty &&
      (!_needsMonths || (int.tryParse(_validityMonths.text.trim()) ?? 0) >= 1);

  Future<void> _save() async {
    if (!_canSave) return;
    setState(() => _busy = true);
    final repo = ref.read(processingRepositoryProvider);
    final months =
        _needsMonths ? int.tryParse(_validityMonths.text.trim()) : null;
    final buffer = int.tryParse(_bufferDays.text.trim());
    final maxMb = int.tryParse(_maxFileSize.text.trim());
    final order = int.tryParse(_sortOrder.text.trim());
    try {
      if (_isEdit) {
        await repo.updateChecklistTemplate(
          widget.existing!.id,
          documentName: _documentName.text.trim(),
          description: _description.text.trim(),
          criticality: _criticality,
          expectedFormats: _formats.toList(),
          maxFileSizeMb: maxMb,
          validityRule: _validityRule,
          validityMonths: months,
          validityBufferDays: buffer,
          guidanceUrl: _guidanceUrl.text.trim(),
          sortOrder: order,
        );
      } else {
        await repo.createChecklistTemplate(
          service: _service,
          targetCountry: _targetCountry!,
          documentName: _documentName.text.trim(),
          description: _description.text.trim().isEmpty
              ? null
              : _description.text.trim(),
          criticality: _criticality,
          expectedFormats: _formats.toList(),
          maxFileSizeMb: maxMb,
          validityRule: _validityRule,
          validityMonths: months,
          validityBufferDays: buffer,
          guidanceUrl: _guidanceUrl.text.trim().isEmpty
              ? null
              : _guidanceUrl.text.trim(),
          sortOrder: order,
        );
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_isEdit ? 'Template updated.' : 'Template created.')),
        );
        Navigator.of(context).pop(true);
      }
    } on AppError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(messageForError(e))));
        setState(() => _busy = false);
      }
    }
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
        title: Text(_isEdit ? 'Edit template' : 'New template',
            style: const TextStyle(
                color: Colors.white, fontWeight: FontWeight.w600)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppTokens.space4),
        children: [
          const SectionLabel('Scope'),
          const SizedBox(height: AppTokens.space2),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _service,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: 'Service *',
                    border: const OutlineInputBorder(),
                    helperText: _isEdit ? 'Locked after creation' : null,
                  ),
                  items: kServiceTypes
                      .map((e) =>
                          DropdownMenuItem(value: e.key, child: Text(e.value)))
                      .toList(),
                  // Service is immutable once a template exists.
                  onChanged: _isEdit
                      ? null
                      : (v) => setState(() => _service = v ?? _service),
                ),
                const SizedBox(height: AppTokens.space3),
                InkWell(
                  onTap: _isEdit
                      ? null
                      : () async {
                          final picked = await showCountryPicker(context,
                              current: _targetCountry);
                          if (picked != null) {
                            setState(() => _targetCountry = picked);
                          }
                        },
                  borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: 'Target country *',
                      border: const OutlineInputBorder(),
                      helperText: _isEdit ? 'Locked after creation' : null,
                      enabled: !_isEdit,
                    ),
                    child: Text(
                      _targetCountry ?? 'Select country…',
                      style: TextStyle(
                        fontSize: 14,
                        color: _targetCountry == null
                            ? AppTokens.textMutedLight
                            : (_isEdit
                                ? AppTokens.textMutedLight
                                : AppTokens.textPrimaryLight),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTokens.space5),
          const SectionLabel('Document'),
          const SizedBox(height: AppTokens.space2),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _documentName,
                  maxLength: 200,
                  textCapitalization: TextCapitalization.words,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Document name *',
                    hintText: 'e.g. Police Clearance Certificate',
                    border: OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
                const SizedBox(height: AppTokens.space3),
                TextField(
                  controller: _description,
                  maxLines: 2,
                  maxLength: 1000,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    hintText: 'Brief description of this requirement…',
                    border: OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
                const SizedBox(height: AppTokens.space3),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _criticality,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Criticality *',
                          border: OutlineInputBorder(),
                        ),
                        items: kCriticalityOptions
                            .map((e) => DropdownMenuItem(
                                value: e.key, child: Text(e.value)))
                            .toList(),
                        onChanged: (v) =>
                            setState(() => _criticality = v ?? _criticality),
                      ),
                    ),
                    const SizedBox(width: AppTokens.space3),
                    SizedBox(
                      width: 96,
                      child: TextField(
                        controller: _sortOrder,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Order',
                          helperText: 'Lower first',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTokens.space5),
          const SectionLabel('Validity'),
          const SizedBox(height: AppTokens.space2),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _validityRule,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Validity rule *',
                    border: OutlineInputBorder(),
                  ),
                  items: kValidityRuleOptions
                      .map((e) =>
                          DropdownMenuItem(value: e.key, child: Text(e.value)))
                      .toList(),
                  onChanged: (v) =>
                      setState(() => _validityRule = v ?? _validityRule),
                ),
                if (_needsMonths) ...[
                  const SizedBox(height: AppTokens.space3),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _validityMonths,
                          keyboardType: TextInputType.number,
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(
                            labelText: 'Valid for (months) *',
                            hintText: 'e.g. 6',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppTokens.space3),
                      Expanded(
                        child: TextField(
                          controller: _bufferDays,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Buffer days',
                            hintText: 'e.g. 30',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppTokens.space5),
          const SectionLabel('Upload constraints'),
          const SizedBox(height: AppTokens.space2),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Accepted file formats',
                    style: TextStyle(
                        fontSize: 12.5, color: AppTokens.textMutedLight)),
                const SizedBox(height: AppTokens.space2),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final f in kTemplateFormats)
                      FilterChip(
                        label: Text(f),
                        selected: _formats.contains(f),
                        onSelected: (sel) => setState(() {
                          if (sel) {
                            _formats.add(f);
                          } else {
                            _formats.remove(f);
                          }
                        }),
                      ),
                  ],
                ),
                const SizedBox(height: AppTokens.space3),
                TextField(
                  controller: _maxFileSize,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Max file size (MB)',
                    hintText: 'e.g. 10',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: AppTokens.space3),
                TextField(
                  controller: _guidanceUrl,
                  keyboardType: TextInputType.url,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Guidance URL',
                    hintText: 'https://…',
                    border: OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
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
              onPressed: _canSave && !_busy ? _save : null,
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text(_isEdit ? 'Save changes' : 'Create template'),
            ),
          ),
          const SizedBox(height: AppTokens.space4),
        ],
      ),
    );
  }
}

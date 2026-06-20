import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/processing_providers.dart';
import '../domain/processing_models.dart';
import 'processing_ui.dart';

/// Processing reports — five read-only manager views (workload, throughput,
/// document quality, SLA, expiry risk) behind a TabBar, sharing one date-range
/// + officer filter. All read-only; no mutations. Reached from the Manager
/// dashboard and server-gated on `processing.report.view`.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  DateTime? _from;
  DateTime? _to;
  String? _officerId;

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  ReportFilter get _filter => ReportFilter(
        dateFrom: _from == null ? null : _iso(_from!),
        dateTo: _to == null ? null : _iso(_to!),
        officerId: _officerId,
      );

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2018),
      lastDate: now.add(const Duration(days: 1)),
      initialDateRange: (_from != null && _to != null)
          ? DateTimeRange(start: _from!, end: _to!)
          : null,
    );
    if (picked != null) {
      setState(() {
        _from = picked.start;
        _to = picked.end;
      });
    }
  }

  void _clearRange() => setState(() {
        _from = null;
        _to = null;
      });

  @override
  Widget build(BuildContext context) {
    final officersAsync = ref.watch(processingOfficersProvider);
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        backgroundColor: AppTokens.pageBackground,
        appBar: AppBar(
          backgroundColor: AppTokens.brandNavy,
          foregroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          systemOverlayStyle: SystemUiOverlayStyle.light,
          title: const Text('Reports',
              style:
                  TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
          bottom: const TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: Colors.white,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white70,
            tabs: [
              Tab(text: 'Workload'),
              Tab(text: 'Throughput'),
              Tab(text: 'Doc quality'),
              Tab(text: 'SLA'),
              Tab(text: 'Expiry risk'),
            ],
          ),
        ),
        body: Column(
          children: [
            _filterBar(officersAsync.valueOrNull ?? const []),
            Expanded(
              child: TabBarView(
                children: [
                  _WorkloadView(filter: _filter),
                  _ThroughputView(filter: _filter),
                  _DocQualityView(filter: _filter),
                  _SlaView(filter: _filter),
                  _ExpiryRiskView(filter: _filter),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _filterBar(List<ProcessingOfficer> officers) {
    final rangeLabel = (_from != null && _to != null)
        ? '${formatDate(_from!)} – ${formatDate(_to!)}'
        : 'Default range';
    return Container(
      color: AppTokens.surfaceLight,
      padding: const EdgeInsets.fromLTRB(
          AppTokens.space4, AppTokens.space3, AppTokens.space4, AppTokens.space3),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _pickRange,
              icon: const Icon(Icons.date_range_outlined, size: 16),
              label: Text(rangeLabel,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTokens.textSecondaryLight,
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
          if (_from != null || _to != null)
            IconButton(
              tooltip: 'Clear range',
              icon: const Icon(Icons.close, size: 18),
              onPressed: () {
                _clearRange();
              },
            ),
          const SizedBox(width: AppTokens.space2),
          Expanded(
            child: DropdownButtonFormField<String?>(
              initialValue: _officerId,
              isExpanded: true,
              isDense: true,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                isDense: true,
              ),
              hint: const Text('All officers', style: TextStyle(fontSize: 13)),
              items: [
                const DropdownMenuItem<String?>(
                    value: null, child: Text('All officers')),
                for (final o in officers)
                  DropdownMenuItem<String?>(value: o.id, child: Text(o.name)),
              ],
              onChanged: (v) => setState(() => _officerId = v),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared scaffolding
// ---------------------------------------------------------------------------

/// Common .when() body wrapper — a refreshable scrollable that shows a
/// skeleton / error / empty / data state. [empty] short-circuits to EmptyView.
class _ReportBody extends StatelessWidget {
  final AsyncValue<dynamic> async;
  final Future<void> Function() onRefresh;
  final VoidCallback onRetry;
  final bool Function(dynamic data) isEmpty;
  final String emptyTitle;
  final String emptyMessage;
  final List<Widget> Function(dynamic data) children;
  const _ReportBody({
    required this.async,
    required this.onRefresh,
    required this.onRetry,
    required this.isEmpty,
    required this.emptyTitle,
    required this.emptyMessage,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: async.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ListView(children: [
          Padding(
            padding: const EdgeInsets.all(AppTokens.space6),
            child: ErrorView(error: e, onRetry: onRetry),
          ),
        ]),
        data: (data) {
          if (isEmpty(data)) {
            return ListView(children: [
              Padding(
                padding: const EdgeInsets.only(top: 80),
                child: EmptyView(
                  icon: Icons.insights_outlined,
                  title: emptyTitle,
                  message: emptyMessage,
                ),
              ),
            ]);
          }
          return ListView(
            padding: const EdgeInsets.all(AppTokens.space4),
            children: children(data),
          );
        },
      ),
    );
  }
}

/// A small metric tile (value over label) used in the report summary rows.
class _MetricTile extends StatelessWidget {
  final String value;
  final String label;
  final ToneColors tone;
  const _MetricTile(
      {required this.value, required this.label, required this.tone});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          vertical: AppTokens.space3, horizontal: AppTokens.space2),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: const BorderRadius.all(AppTokens.radiusMd),
      ),
      child: Column(
        children: [
          Text(value,
              style: TextStyle(
                  fontSize: 20, fontWeight: FontWeight.w700, color: tone.fg)),
          const SizedBox(height: 2),
          Text(label,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 11, color: AppTokens.textMutedLight)),
        ],
      ),
    );
  }
}

Widget _summaryRow(List<Widget> tiles) => Row(
      children: [
        for (var i = 0; i < tiles.length; i++) ...[
          Expanded(child: tiles[i]),
          if (i != tiles.length - 1) const SizedBox(width: AppTokens.space2),
        ],
      ],
    );

Widget _kv(String k, String v, {Color? valueColor}) => Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(k,
                style: const TextStyle(
                    fontSize: 12, color: AppTokens.textMutedLight)),
          ),
          Expanded(
            child: Text(v,
                style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: valueColor)),
          ),
        ],
      ),
    );

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

class _WorkloadView extends ConsumerWidget {
  final ReportFilter filter;
  const _WorkloadView({required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(workloadReportProvider(filter));
    return _ReportBody(
      async: async,
      onRefresh: () => ref.refresh(workloadReportProvider(filter).future),
      onRetry: () => ref.invalidate(workloadReportProvider(filter)),
      isEmpty: (d) => (d as WorkloadReport).rows.isEmpty,
      emptyTitle: 'No workload data',
      emptyMessage: 'No cases were created in the selected range.',
      children: (d) {
        final r = d as WorkloadReport;
        return [
          for (final row in r.rows) ...[
            _workloadCard(row),
            const SizedBox(height: AppTokens.space3),
          ],
        ];
      },
    );
  }

  Widget _workloadCard(WorkloadRow row) {
    final stages = row.stageCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(row.officerName,
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w600)),
              ),
              StatusPill(
                label: '${row.caseCount} cases',
                tone: const ToneColors(
                    AppTokens.statusInfo, AppTokens.statusInfoBg),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          _kv('Avg days open', '${row.avgDaysOpen}'),
          if (stages.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final s in stages)
                  StatusPill(
                    label: '${stageLabel(s.key)} · ${s.value}',
                    tone: stageTone(s.key),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Throughput
// ---------------------------------------------------------------------------

class _ThroughputView extends ConsumerWidget {
  final ReportFilter filter;
  const _ThroughputView({required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(throughputReportProvider(filter));
    return _ReportBody(
      async: async,
      onRefresh: () => ref.refresh(throughputReportProvider(filter).future),
      onRetry: () => ref.invalidate(throughputReportProvider(filter)),
      isEmpty: (d) => (d as ThroughputReport).weeks.isEmpty,
      emptyTitle: 'No closed cases',
      emptyMessage: 'No cases were completed, cancelled or rejected in range.',
      children: (d) {
        final r = d as ThroughputReport;
        return [
          _summaryRow([
            _MetricTile(
                value: '${r.totalClosed}',
                label: 'Total closed',
                tone: const ToneColors(
                    AppTokens.statusInfo, AppTokens.statusInfoBg)),
            _MetricTile(
                value: '${r.weeks.fold<int>(0, (s, w) => s + w.completed)}',
                label: 'Completed',
                tone: const ToneColors(
                    AppTokens.statusSuccess, AppTokens.statusSuccessBg)),
            _MetricTile(
                value: '${r.weeks.fold<int>(0, (s, w) => s + w.rejected)}',
                label: 'Rejected',
                tone: const ToneColors(
                    AppTokens.statusDanger, AppTokens.statusDangerBg)),
          ]),
          const SizedBox(height: AppTokens.space4),
          const SectionLabel('By week'),
          const SizedBox(height: AppTokens.space2),
          for (final w in r.weeks) ...[
            SectionCard(
              child: Row(
                children: [
                  SizedBox(
                    width: 76,
                    child: Text(w.week,
                        style: const TextStyle(
                            fontSize: 12.5, fontWeight: FontWeight.w600)),
                  ),
                  Expanded(
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      alignment: WrapAlignment.end,
                      children: [
                        StatusPill(
                            label: '${w.completed} done',
                            tone: const ToneColors(AppTokens.statusSuccess,
                                AppTokens.statusSuccessBg)),
                        StatusPill(
                            label: '${w.cancelled} cancelled',
                            tone: const ToneColors(AppTokens.statusNeutral,
                                AppTokens.statusNeutralBg)),
                        StatusPill(
                            label: '${w.rejected} rejected',
                            tone: const ToneColors(AppTokens.statusDanger,
                                AppTokens.statusDangerBg)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.space3),
          ],
        ];
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Document quality
// ---------------------------------------------------------------------------

class _DocQualityView extends ConsumerWidget {
  final ReportFilter filter;
  const _DocQualityView({required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(docQualityReportProvider(filter));
    return _ReportBody(
      async: async,
      onRefresh: () => ref.refresh(docQualityReportProvider(filter).future),
      onRetry: () => ref.invalidate(docQualityReportProvider(filter)),
      isEmpty: (d) => (d as DocQualityReport).documents.isEmpty,
      emptyTitle: 'No review data',
      emptyMessage: 'No document review decisions were made in the range.',
      children: (d) {
        final r = d as DocQualityReport;
        return [
          if (r.topReasonCodes.isNotEmpty) ...[
            const SectionLabel('Top rejection reasons'),
            const SizedBox(height: AppTokens.space2),
            SectionCard(
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final c in r.topReasonCodes)
                    StatusPill(
                      label:
                          '${kRejectionReasonLabel[c.code] ?? c.code} · ${c.count}',
                      tone: const ToneColors(
                          AppTokens.statusWarning, AppTokens.statusWarningBg),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.space4),
          ],
          const SectionLabel('By document'),
          const SizedBox(height: AppTokens.space2),
          for (final doc in r.documents) ...[
            _docCard(doc),
            const SizedBox(height: AppTokens.space3),
          ],
        ];
      },
    );
  }

  Widget _docCard(DocQualityRow doc) {
    final tone = doc.rejectionRate >= 50
        ? const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg)
        : doc.rejectionRate >= 20
            ? const ToneColors(
                AppTokens.statusWarning, AppTokens.statusWarningBg)
            : const ToneColors(
                AppTokens.statusSuccess, AppTokens.statusSuccessBg);
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(doc.documentName,
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w600)),
              ),
              StatusPill(label: '${doc.rejectionRate}% rejected', tone: tone),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          _kv('Reviewed', '${doc.total}'),
          _kv('Accepted', '${doc.accepted}'),
          _kv('Rejected', '${doc.rejected}'),
          if (doc.topReasonCodes.isNotEmpty) ...[
            const SizedBox(height: AppTokens.space2),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                for (final c in doc.topReasonCodes)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTokens.surfaceSubtleLight,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '${kRejectionReasonLabel[c.code] ?? c.code} (${c.count})',
                      style: const TextStyle(
                          fontSize: 10.5, color: AppTokens.textMutedLight),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

class _SlaView extends ConsumerWidget {
  final ReportFilter filter;
  const _SlaView({required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(slaReportProvider(filter));
    return _ReportBody(
      async: async,
      onRefresh: () => ref.refresh(slaReportProvider(filter).future),
      onRetry: () => ref.invalidate(slaReportProvider(filter)),
      isEmpty: (d) {
        final r = d as SlaReport;
        return r.overdueCorrections.isEmpty && r.agingCases.isEmpty;
      },
      emptyTitle: 'SLA clear',
      emptyMessage: 'No overdue corrections and no cases aging past 30 days.',
      children: (d) {
        final r = d as SlaReport;
        return [
          _summaryRow([
            _MetricTile(
                value: '${r.overdueCount}',
                label: 'Overdue',
                tone: const ToneColors(
                    AppTokens.statusDanger, AppTokens.statusDangerBg)),
            _MetricTile(
                value: '${r.aging30to60}',
                label: '30–60d',
                tone: const ToneColors(
                    AppTokens.statusWarning, AppTokens.statusWarningBg)),
            _MetricTile(
                value: '${r.aging60to90}',
                label: '60–90d',
                tone: const ToneColors(
                    AppTokens.statusWarning, AppTokens.statusWarningBg)),
            _MetricTile(
                value: '${r.aging90plus}',
                label: '90d+',
                tone: const ToneColors(
                    AppTokens.statusDanger, AppTokens.statusDangerBg)),
          ]),
          const SizedBox(height: AppTokens.space4),
          if (r.overdueCorrections.isNotEmpty) ...[
            const SectionLabel('Overdue corrections'),
            const SizedBox(height: AppTokens.space2),
            for (final c in r.overdueCorrections) ...[
              SectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(c.subject,
                              style: const TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w600)),
                        ),
                        if (c.hoursOverdue != null)
                          StatusPill(
                            label: '${c.hoursOverdue}h overdue',
                            tone: const ToneColors(AppTokens.statusDanger,
                                AppTokens.statusDangerBg),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppTokens.space2),
                    _kv('Raised by', c.raisedByName),
                    if (c.slaDueAt != null)
                      _kv('Due', formatDateTime(c.slaDueAt!)),
                  ],
                ),
              ),
              const SizedBox(height: AppTokens.space3),
            ],
          ],
          if (r.agingCases.isNotEmpty) ...[
            const SectionLabel('Aging cases'),
            const SizedBox(height: AppTokens.space2),
            for (final a in r.agingCases) ...[
              SectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${labelForServiceCode(a.service)} · ${a.targetCountry}',
                            style: const TextStyle(
                                fontSize: 13.5, fontWeight: FontWeight.w600),
                          ),
                        ),
                        StatusPill(
                          label: '${a.daysOpen}d (${a.bucket})',
                          tone: a.bucket == '90+'
                              ? const ToneColors(AppTokens.statusDanger,
                                  AppTokens.statusDangerBg)
                              : const ToneColors(AppTokens.statusWarning,
                                  AppTokens.statusWarningBg),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppTokens.space2),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        stagePill(a.stage),
                        priorityPill(a.priority),
                        Text(a.officerName,
                            style: const TextStyle(
                                fontSize: 12,
                                color: AppTokens.textMutedLight)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTokens.space3),
            ],
          ],
        ];
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Expiry risk
// ---------------------------------------------------------------------------

class _ExpiryRiskView extends ConsumerWidget {
  final ReportFilter filter;
  const _ExpiryRiskView({required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(expiryRiskReportProvider(filter));
    return _ReportBody(
      async: async,
      onRefresh: () => ref.refresh(expiryRiskReportProvider(filter).future),
      onRetry: () => ref.invalidate(expiryRiskReportProvider(filter)),
      isEmpty: (d) => (d as ExpiryRiskReport).rows.isEmpty,
      emptyTitle: 'No expiry risk',
      emptyMessage: 'No document items expire within the next 90 days.',
      children: (d) {
        final r = d as ExpiryRiskReport;
        return [
          _summaryRow([
            _MetricTile(
                value: '${r.expired}',
                label: 'Expired',
                tone: const ToneColors(
                    AppTokens.statusDanger, AppTokens.statusDangerBg)),
            _MetricTile(
                value: '${r.within30}',
                label: '≤30d',
                tone: const ToneColors(
                    AppTokens.statusWarning, AppTokens.statusWarningBg)),
            _MetricTile(
                value: '${r.within60}',
                label: '31–60d',
                tone: const ToneColors(
                    AppTokens.statusInfo, AppTokens.statusInfoBg)),
            _MetricTile(
                value: '${r.within90}',
                label: '61–90d',
                tone: const ToneColors(
                    AppTokens.statusNeutral, AppTokens.statusNeutralBg)),
          ]),
          const SizedBox(height: AppTokens.space4),
          const SectionLabel('Documents at risk'),
          const SizedBox(height: AppTokens.space2),
          for (final row in r.rows) ...[
            _expiryCard(row),
            const SizedBox(height: AppTokens.space3),
          ],
        ];
      },
    );
  }

  Widget _expiryCard(ExpiryRiskRow row) {
    final tone = row.bucket == 'expired'
        ? const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg)
        : row.bucket == '0-30'
            ? const ToneColors(
                AppTokens.statusWarning, AppTokens.statusWarningBg)
            : const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    final daysLabel = row.daysUntilExpiry == null
        ? 'Unknown'
        : row.daysUntilExpiry! < 0
            ? 'Expired ${-row.daysUntilExpiry!}d ago'
            : '${row.daysUntilExpiry}d left';
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(row.documentName,
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w600)),
              ),
              StatusPill(label: daysLabel, tone: tone),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          if (row.validityExpiryDate != null)
            _kv('Expires', formatDate(row.validityExpiryDate!)),
          const SizedBox(height: AppTokens.space1),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusPill(
                  label: row.criticality, tone: criticalityTone(row.criticality)),
              Text(
                '${labelForServiceCode(row.service)} · ${row.targetCountry}',
                style: const TextStyle(
                    fontSize: 12, color: AppTokens.textMutedLight),
              ),
              Text(row.officerName,
                  style: const TextStyle(
                      fontSize: 12, color: AppTokens.textMutedLight)),
            ],
          ),
        ],
      ),
    );
  }
}

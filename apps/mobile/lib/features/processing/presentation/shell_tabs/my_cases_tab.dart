import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../../../core/widgets/app_states.dart';
import '../../data/processing_providers.dart';
import '../../domain/processing_models.dart';
import 'dashboard_tab.dart' show CaseListCard;

/// My Cases tab — search + stage filter, single-column case cards. Associates
/// see only their own cases (server-scoped); managers see all.
class MyCasesTab extends ConsumerStatefulWidget {
  const MyCasesTab({super.key});

  @override
  ConsumerState<MyCasesTab> createState() => _MyCasesTabState();
}

class _MyCasesTabState extends ConsumerState<MyCasesTab> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  String _search = '';
  final Set<String> _stages = {};

  // Stage filter chips — the common working stages.
  static const _filterStages = [
    'INTAKE_PENDING',
    'DOCUMENTS_COLLECTION',
    'DOCUMENTS_UNDER_REVIEW',
    'DOCUMENTS_INCOMPLETE',
    'READY_FOR_SUBMISSION',
    'SUBMITTED',
    'UNDER_AUTHORITY_REVIEW',
    'APPROVED',
    'REJECTED',
  ];

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) setState(() => _search = v.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final query = CasesQuery(
      search: _search.isEmpty ? null : _search,
      stages: _stages.isEmpty ? null : _stages.toList(),
    );
    final async = ref.watch(processingCasesProvider(query));

    return Column(
      children: [
        // Search bar (full width, above filters).
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTokens.space4,
              AppTokens.space4, AppTokens.space4, AppTokens.space2),
          child: TextField(
            controller: _searchCtrl,
            onChanged: _onSearch,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search cases…',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _searchCtrl.clear();
                        setState(() => _search = '');
                      },
                    )
                  : null,
              isDense: true,
              filled: true,
              fillColor: AppTokens.surfaceLight,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppTokens.borderLight),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppTokens.borderLight),
              ),
            ),
          ),
        ),
        // Stage filter chips.
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppTokens.space4),
            children: _filterStages.map((s) {
              final on = _stages.contains(s);
              return Padding(
                padding: const EdgeInsets.only(right: 6),
                child: FilterChip(
                  label: Text(stageLabel(s),
                      style: const TextStyle(fontSize: 12)),
                  selected: on,
                  onSelected: (_) => setState(() {
                    on ? _stages.remove(s) : _stages.add(s);
                  }),
                  selectedColor: AppTokens.primary100,
                  showCheckmark: false,
                  backgroundColor: AppTokens.surfaceLight,
                  side: const BorderSide(color: AppTokens.borderLight),
                ),
              );
            }).toList(),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.refresh(processingCasesProvider(query).future),
            child: async.when(
              loading: () => const SkeletonList(),
              error: (e, _) => ListView(children: [
                Padding(
                  padding: const EdgeInsets.all(AppTokens.space6),
                  child: ErrorView(
                    error: e,
                    onRetry: () =>
                        ref.invalidate(processingCasesProvider(query)),
                  ),
                ),
              ]),
              data: (res) {
                if (res.cases.isEmpty) {
                  return ListView(children: const [
                    Padding(
                      padding: EdgeInsets.only(top: 80),
                      child: EmptyView(
                        icon: Icons.folder_open_outlined,
                        title: 'No cases match',
                        message: 'Try clearing the search or filters.',
                      ),
                    ),
                  ]);
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(AppTokens.space4),
                  itemCount: res.cases.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppTokens.space3),
                  itemBuilder: (_, i) =>
                      CaseListCard(caseItem: res.cases[i]),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

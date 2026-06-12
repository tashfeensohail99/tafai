import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/leads_providers.dart';
import '../domain/lead.dart';
import 'lead_form_sheet.dart';
import 'widgets/lead_card.dart';

/// The "Leads" tab body (lives inside the app shell — no Scaffold of its own).
class LeadsListScreen extends ConsumerStatefulWidget {
  const LeadsListScreen({super.key});

  @override
  ConsumerState<LeadsListScreen> createState() => _LeadsListScreenState();
}

class _LeadsListScreenState extends ConsumerState<LeadsListScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      ref.read(leadsFilterProvider.notifier).update((f) => f.withSearch(value));
    });
  }

  void _setStatus(String? status) {
    ref.read(leadsFilterProvider.notifier).update((f) => f.withStatus(status));
  }

  Future<void> _newLead() async {
    final created = await showLeadForm(context);
    if (created != null && mounted) {
      ref.invalidate(leadsListProvider);
      context.push(AppRoutes.leadDetail(created.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(leadsListProvider);
    final filter = ref.watch(leadsFilterProvider);

    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newLead,
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('New lead'),
      ),
      body: Column(
        children: [
          // ── premium search bar ────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
            child: PremiumSearchBar(
              controller: _searchController,
              hint: 'Search name, phone, email…',
              onChanged: _onSearchChanged,
            ),
          ),
          const SizedBox(height: AppTokens.space3),
          // ── status filter chips ───────────────────────────────────────────
          _StatusFilterBar(selected: filter.status, onSelect: _setStatus),
          const SizedBox(height: AppTokens.space2),
          Expanded(
            child: async.when(
              loading: () => const SkeletonList(),
              error: (e, _) => ErrorView(
                error: e,
                onRetry: () => ref.invalidate(leadsListProvider),
              ),
              data: (leads) {
                if (leads.isEmpty) {
                  final filtered = filter.search.isNotEmpty || filter.hasFilters;
                  return EmptyView(
                    icon: filtered ? Icons.search_off : Icons.people_outline,
                    title: filtered ? 'No matching leads' : 'No leads yet',
                    message: filtered
                        ? 'Try a different search or clear the filters.'
                        : 'Leads assigned to you will appear here.',
                  );
                }
                return RefreshIndicator(
                  color: AppTokens.brandNavy,
                  onRefresh: () => ref.refresh(leadsListProvider.future),
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(AppTokens.space4,
                        AppTokens.space1, AppTokens.space4, AppTokens.space16),
                    itemCount: leads.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: AppTokens.space3),
                    itemBuilder: (_, i) => LeadCard(
                      lead: leads[i],
                      onTap: () => context.push(AppRoutes.leadDetail(leads[i].id)),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ── Status filter strip ───────────────────────────────────────────────────────

class _StatusFilterBar extends StatelessWidget {
  final String? selected;
  final ValueChanged<String?> onSelect;

  const _StatusFilterBar({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppTokens.space4),
      clipBehavior: Clip.none,
      child: Row(
        children: [
          CrmFilterChip(
            label: 'All',
            selected: selected == null,
            onTap: () => onSelect(null),
          ),
          for (final s in kLeadStatuses) ...[
            const SizedBox(width: AppTokens.space2),
            CrmFilterChip(
              label: leadStatusLabel(s),
              selected: selected == s,
              onTap: () => onSelect(s),
            ),
          ],
        ],
      ),
    );
  }
}

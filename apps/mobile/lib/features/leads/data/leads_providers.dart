import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/lead.dart';
import 'leads_repository.dart';

/// Active list filters (search box + status/priority chips).
class LeadsFilter {
  final String search;
  final String? status;
  final String? priority;

  const LeadsFilter({this.search = '', this.status, this.priority});

  LeadsFilter withSearch(String s) =>
      LeadsFilter(search: s, status: status, priority: priority);
  LeadsFilter withStatus(String? s) =>
      LeadsFilter(search: search, status: s, priority: priority);
  LeadsFilter withPriority(String? p) =>
      LeadsFilter(search: search, status: status, priority: p);

  bool get hasFilters => status != null || priority != null;
}

final leadsFilterProvider =
    StateProvider<LeadsFilter>((ref) => const LeadsFilter());

/// The scoped lead list for the current filters.
final leadsListProvider = FutureProvider.autoDispose<List<Lead>>((ref) async {
  final f = ref.watch(leadsFilterProvider);
  final repo = ref.watch(leadsRepositoryProvider);
  return repo.list(
    search: f.search.trim().isEmpty ? null : f.search.trim(),
    status: f.status,
    priority: f.priority,
  );
});

/// A single lead's detail, by id.
final leadDetailProvider =
    FutureProvider.autoDispose.family<Lead, String>((ref, id) async {
  return ref.watch(leadsRepositoryProvider).get(id);
});

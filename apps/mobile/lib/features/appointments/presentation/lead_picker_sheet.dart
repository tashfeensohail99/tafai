import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_states.dart';
import '../../leads/data/leads_repository.dart';
import '../../leads/domain/lead.dart';

/// Server-side lead search for the picker (scoped to the rep's own leads).
final _leadSearchProvider =
    FutureProvider.autoDispose.family<List<Lead>, String>((ref, q) async {
  final query = q.trim();
  return ref
      .watch(leadsRepositoryProvider)
      .list(search: query.isEmpty ? null : query, limit: 25);
});

/// Opens a searchable lead picker. Returns the chosen [Lead] or null.
Future<Lead?> showLeadPicker(BuildContext context) {
  return showModalBottomSheet<Lead>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _LeadPickerSheet(),
  );
}

class _LeadPickerSheet extends ConsumerStatefulWidget {
  const _LeadPickerSheet();

  @override
  ConsumerState<_LeadPickerSheet> createState() => _LeadPickerSheetState();
}

class _LeadPickerSheetState extends ConsumerState<_LeadPickerSheet> {
  final _ctrl = TextEditingController();
  Timer? _debounce;
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _query = v);
    });
  }

  @override
  Widget build(BuildContext context) {
    final leads = ref.watch(_leadSearchProvider(_query));
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppTokens.space4, 0,
                    AppTokens.space4, AppTokens.space3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Choose a lead',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: AppTokens.space3),
                    TextField(
                      controller: _ctrl,
                      autofocus: true,
                      textInputAction: TextInputAction.search,
                      onChanged: _onChanged,
                      decoration: const InputDecoration(
                        hintText: 'Search by name or phone',
                        prefixIcon: Icon(Icons.search),
                        isDense: true,
                      ),
                    ),
                  ],
                ),
              ),
              Flexible(
                child: leads.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(AppTokens.space10),
                    child: LoadingView(),
                  ),
                  error: (e, _) => Padding(
                    padding: const EdgeInsets.all(AppTokens.space6),
                    child: ErrorView(
                      error: e,
                      onRetry: () =>
                          ref.invalidate(_leadSearchProvider(_query)),
                    ),
                  ),
                  data: (list) {
                    if (list.isEmpty) {
                      return const Padding(
                        padding: EdgeInsets.all(AppTokens.space8),
                        child: EmptyView(
                          icon: Icons.person_search_outlined,
                          title: 'No leads found',
                          message: 'Try a different name or number.',
                        ),
                      );
                    }
                    return ListView.separated(
                      shrinkWrap: true,
                      padding: const EdgeInsets.only(bottom: AppTokens.space6),
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final l = list[i];
                        return ListTile(
                          leading: CircleAvatar(
                            backgroundColor: AppTokens.primary100,
                            child: Text(
                              _initials(l),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: AppTokens.primary700,
                                fontSize: 13,
                              ),
                            ),
                          ),
                          title: Text(l.fullName,
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text(
                            l.phone.isNotEmpty ? l.phone : l.statusLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).pop(l),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _initials(Lead l) {
    final a = l.firstName.isNotEmpty ? l.firstName[0] : '';
    final b = l.lastName.isNotEmpty ? l.lastName[0] : '';
    final s = (a + b).toUpperCase();
    return s.isNotEmpty ? s : '?';
  }
}

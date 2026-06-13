import 'package:flutter/material.dart';

import '../theme/tokens.dart';
import '../../features/leads/domain/lead_options.dart';

/// Opens a searchable country picker — popular quick-pick chips plus the full
/// searchable list — mirroring the web portal's CountrySelect. Returns the
/// chosen country name, or null if dismissed. Pass [current] to tick the
/// active selection.
Future<String?> showCountryPicker(BuildContext context, {String? current}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _CountryPickerSheet(current: current),
  );
}

class _CountryPickerSheet extends StatefulWidget {
  final String? current;
  const _CountryPickerSheet({this.current});

  @override
  State<_CountryPickerSheet> createState() => _CountryPickerSheetState();
}

class _CountryPickerSheetState extends State<_CountryPickerSheet> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final filtered = q.isEmpty
        ? kAllCountries
        : kAllCountries.where((c) => c.toLowerCase().contains(q)).toList();

    return SafeArea(
      child: Padding(
        padding:
            EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppTokens.space4, 0,
                    AppTokens.space4, AppTokens.space2),
                child: TextField(
                  autofocus: true,
                  onChanged: (v) => setState(() => _q = v),
                  decoration: const InputDecoration(
                    hintText: 'Search country…',
                    prefixIcon: Icon(Icons.search),
                    isDense: true,
                  ),
                ),
              ),
              if (q.isEmpty)
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: AppTokens.space4),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Wrap(
                      spacing: AppTokens.space2,
                      runSpacing: AppTokens.space1,
                      children: [
                        for (final c in kPopularCountries)
                          ActionChip(
                            label: Text(c),
                            onPressed: () => Navigator.of(context).pop(c),
                          ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: AppTokens.space2),
              Flexible(
                child: filtered.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(AppTokens.space5),
                          child: Text('No matching country.'),
                        ),
                      )
                    : ListView.builder(
                        itemCount: filtered.length,
                        itemBuilder: (_, i) {
                          final c = filtered[i];
                          final selected = c == widget.current;
                          return ListTile(
                            dense: true,
                            title: Text(c),
                            trailing: selected
                                ? const Icon(Icons.check,
                                    color: AppTokens.brandNavy)
                                : null,
                            onTap: () => Navigator.of(context).pop(c),
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
}

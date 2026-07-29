import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../data/whatsapp_repository.dart';
import '../domain/wa_thread.dart';

/// Bottom sheet to pick a contact to FORWARD a message to. Returns the chosen
/// thread, or null if dismissed. Only contacts whose 24-hour window is OPEN are
/// selectable — WhatsApp blocks free-form forwards to a closed window.
Future<WhatsappThread?> showForwardTargetSheet(BuildContext context) {
  return showModalBottomSheet<WhatsappThread>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (_) => const _ForwardTargetSheet(),
  );
}

class _ForwardTargetSheet extends ConsumerStatefulWidget {
  const _ForwardTargetSheet();

  @override
  ConsumerState<_ForwardTargetSheet> createState() => _ForwardTargetSheetState();
}

class _ForwardTargetSheetState extends ConsumerState<_ForwardTargetSheet> {
  final _search = TextEditingController();
  List<WhatsappThread> _results = const [];
  bool _loading = true;
  Object? _reqToken;

  @override
  void initState() {
    super.initState();
    _load('');
    _search.addListener(() => _load(_search.text.trim()));
  }

  Future<void> _load(String q) async {
    final token = Object();
    _reqToken = token;
    setState(() => _loading = true);
    // Small debounce so we don't fire a request per keystroke.
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (_reqToken != token || !mounted) return;
    try {
      final page = await ref
          .read(whatsappRepositoryProvider)
          .listThreads(search: q.isEmpty ? null : q, limit: 25);
      if (_reqToken != token || !mounted) return;
      setState(() {
        _results = page.items;
        _loading = false;
      });
    } catch (_) {
      if (_reqToken != token || !mounted) return;
      setState(() {
        _results = const [];
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.7,
        minChildSize: 0.4,
        maxChildSize: 0.92,
        expand: false,
        builder: (ctx, scrollController) => Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Forward to…',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: TextField(
                controller: _search,
                decoration: InputDecoration(
                  hintText: 'Search a contact by name or number…',
                  prefixIcon: const Icon(Icons.search),
                  isDense: true,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _results.isEmpty
                      ? const Center(child: Text('No conversations found.'))
                      : ListView.separated(
                          controller: scrollController,
                          itemCount: _results.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final t = _results[i];
                            final open = t.windowOpen;
                            return ListTile(
                              enabled: open,
                              title: Text(t.displayName,
                                  maxLines: 1, overflow: TextOverflow.ellipsis),
                              subtitle: Text(t.phone),
                              trailing: Text(
                                open ? 'Open' : 'Closed',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: open
                                      ? AppTokens.statusSuccess
                                      : AppTokens.textMutedLight,
                                ),
                              ),
                              onTap: open ? () => Navigator.pop(context, t) : null,
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

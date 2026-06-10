import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../data/whatsapp_providers.dart';
import '../domain/wa_stats.dart';
import '../domain/wa_thread.dart';
import 'thread_screen.dart';

/// The "Chat" tab — the WhatsApp inbox. Mirrors the web: All / Open /
/// Uncontacted tabs with live counts, awaiting-reply rows pinned + flagged.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearch(String v) {
    setState(() {}); // clear-button visibility
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      ref.read(inboxFilterProvider.notifier).update((f) => f.copyWith(search: v));
    });
  }

  void _setTab(WaTab tab) =>
      ref.read(inboxFilterProvider.notifier).update((f) => f.copyWith(tab: tab));

  void _toggleDue() => ref
      .read(inboxFilterProvider.notifier)
      .update((f) => f.copyWith(followUpDue: !f.followUpDue));

  Future<void> _refreshAll(WaFilter filter) async {
    ref.invalidate(threadStatsProvider);
    await ref.read(threadsControllerProvider(filter).notifier).refresh();
  }

  Future<void> _openThread(WhatsappThread t) async {
    await Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => ThreadScreen(thread: t)));
    if (!mounted) return;
    final filter = ref.read(inboxFilterProvider);
    ref.read(threadsControllerProvider(filter).notifier).refresh();
    ref.invalidate(threadStatsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(inboxFilterProvider);
    final threads = ref.watch(threadsControllerProvider(filter));
    final stats = ref.watch(threadStatsProvider).valueOrNull ?? ThreadStats.empty;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
          child: TextField(
            controller: _searchCtrl,
            onChanged: _onSearch,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search name or phone…',
              prefixIcon: const Icon(Icons.search),
              isDense: true,
              suffixIcon: _searchCtrl.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _searchCtrl.clear();
                        _onSearch('');
                      },
                    ),
            ),
          ),
        ),
        const SizedBox(height: AppTokens.space2),
        _InboxTabs(
          selected: filter.tab,
          all: stats.total,
          open: stats.open,
          uncontacted: stats.uncontacted,
          onSelect: _setTab,
        ),
        if (stats.followUpDue > 0 || filter.followUpDue)
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space4, vertical: AppTokens.space2),
            child: Row(
              children: [
                FilterChip(
                  avatar: const Icon(Icons.alarm, size: 16),
                  label: Text('Due follow-ups (${stats.followUpDue})'),
                  selected: filter.followUpDue,
                  onSelected: (_) => _toggleDue(),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ),
        const Divider(height: 1),
        Expanded(
          child: _ThreadsList(
            state: threads,
            onRefresh: () => _refreshAll(filter),
            onLoadMore: () =>
                ref.read(threadsControllerProvider(filter).notifier).loadMore(),
            onRetry: () =>
                ref.read(threadsControllerProvider(filter).notifier).refresh(),
            onOpen: _openThread,
          ),
        ),
      ],
    );
  }
}

class _InboxTabs extends StatelessWidget {
  final WaTab selected;
  final int all;
  final int open;
  final int uncontacted;
  final ValueChanged<WaTab> onSelect;

  const _InboxTabs({
    required this.selected,
    required this.all,
    required this.open,
    required this.uncontacted,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppTokens.space4),
      child: Row(
        children: [
          _tab(context, 'All', all, WaTab.all),
          _tab(context, 'Open', open, WaTab.open),
          _tab(context, 'Uncontacted', uncontacted, WaTab.uncontacted),
        ],
      ),
    );
  }

  Widget _tab(BuildContext context, String label, int count, WaTab tab) {
    final active = selected == tab;
    final color = active ? AppTokens.primary600 : AppTokens.textMutedLight;
    return Expanded(
      child: InkWell(
        onTap: () => onSelect(tab),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTokens.space3),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: color,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                        fontSize: AppTokens.fontSizeSm,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '$count',
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w700,
                      fontSize: AppTokens.fontSizeXs,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTokens.space2),
              Container(
                height: 2,
                color: active ? AppTokens.primary600 : Colors.transparent,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThreadsList extends StatelessWidget {
  final ThreadsState state;
  final Future<void> Function() onRefresh;
  final VoidCallback onLoadMore;
  final VoidCallback onRetry;
  final void Function(WhatsappThread) onOpen;

  const _ThreadsList({
    required this.state,
    required this.onRefresh,
    required this.onLoadMore,
    required this.onRetry,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    if (state.loading) return const LoadingView();
    if (state.error != null) {
      return ErrorView(error: state.error!, onRetry: onRetry);
    }
    if (state.items.isEmpty) {
      return const EmptyView(
        icon: Icons.forum_outlined,
        title: 'No conversations',
        message: 'Chats assigned to you will appear here.',
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.separated(
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 78),
        itemBuilder: (context, i) {
          if (i >= state.items.length) {
            // Sentinel — trigger the next page, show a spinner.
            WidgetsBinding.instance.addPostFrameCallback((_) => onLoadMore());
            return const Padding(
              padding: EdgeInsets.all(AppTokens.space4),
              child: Center(
                child: SizedBox(
                  height: 22,
                  width: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            );
          }
          return _ThreadTile(thread: state.items[i], onTap: () => onOpen(state.items[i]));
        },
      ),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  final WhatsappThread thread;
  final VoidCallback onTap;
  const _ThreadTile({required this.thread, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final when = thread.lastMessageAt;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space4, vertical: AppTokens.space3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 23,
              backgroundColor: AppTokens.primary100,
              child: Text(
                _initials(thread.displayName),
                style: const TextStyle(
                    color: AppTokens.primary700, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          thread.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: t.titleSmall?.copyWith(
                              fontWeight: thread.unreadCount > 0
                                  ? FontWeight.w700
                                  : FontWeight.w600),
                        ),
                      ),
                      if (when != null)
                        Text(relativeTime(when),
                            style: t.bodySmall?.copyWith(
                                color: AppTokens.textMutedLight, fontSize: 11)),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          thread.lastMessagePreview ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: t.bodySmall
                              ?.copyWith(color: AppTokens.textMutedLight),
                        ),
                      ),
                      if (thread.awaitingReply) ...[
                        const SizedBox(width: AppTokens.space2),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTokens.statusWarningBg,
                            borderRadius:
                                const BorderRadius.all(AppTokens.radiusSm),
                            border:
                                Border.all(color: AppTokens.statusWarning),
                          ),
                          child: const Text('Reply',
                              style: TextStyle(
                                  color: AppTokens.statusWarning,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700)),
                        ),
                      ],
                      if (thread.unreadCount > 0) ...[
                        const SizedBox(width: AppTokens.space2),
                        Container(
                          constraints:
                              const BoxConstraints(minWidth: 20, minHeight: 20),
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          decoration: const BoxDecoration(
                            color: AppTokens.statusSuccess,
                            shape: BoxShape.rectangle,
                            borderRadius: BorderRadius.all(AppTokens.radiusFull),
                          ),
                          alignment: Alignment.center,
                          child: Text('${thread.unreadCount}',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700)),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }
}

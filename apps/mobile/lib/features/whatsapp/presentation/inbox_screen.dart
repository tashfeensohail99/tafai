import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
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
        // ── search bar ────────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppTokens.space4, AppTokens.space3, AppTokens.space4, 0),
          child: PremiumSearchBar(
            controller: _searchCtrl,
            hint: 'Search name or phone…',
            onChanged: _onSearch,
          ),
        ),
        const SizedBox(height: AppTokens.space3),

        // ── inline tab bar with counts ────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTokens.space4),
          child: _InboxTabs(
            selected: filter.tab,
            all: stats.total,
            open: stats.open,
            uncontacted: stats.uncontacted,
            onSelect: _setTab,
          ),
        ),

        // ── due follow-up chip ────────────────────────────────────────────
        if (stats.followUpDue > 0 || filter.followUpDue)
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppTokens.space4, AppTokens.space2, AppTokens.space4, 0),
            child: Row(
              children: [
                CrmFilterChip(
                  label: 'Due follow-ups',
                  count: stats.followUpDue,
                  selected: filter.followUpDue,
                  onTap: _toggleDue,
                  selectedColor: AppTokens.statusWarning,
                ),
              ],
            ),
          ),
        const SizedBox(height: AppTokens.space2),
        const Divider(height: 1),

        // ── thread list ───────────────────────────────────────────────────
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

// ── Inbox tab bar ─────────────────────────────────────────────────────────────

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
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.all(Radius.circular(12)),
        boxShadow: AppTokens.cardShadowSm,
      ),
      child: Row(
        children: [
          Expanded(child: _InboxTabItem(
            label: 'All', count: all, tab: WaTab.all,
            selected: selected, onSelect: onSelect,
          )),
          Expanded(child: _InboxTabItem(
            label: 'Open', count: open, tab: WaTab.open,
            selected: selected, onSelect: onSelect,
          )),
          Expanded(child: _InboxTabItem(
            label: 'Uncontacted', count: uncontacted, tab: WaTab.uncontacted,
            selected: selected, onSelect: onSelect,
          )),
        ],
      ),
    );
  }
}

class _InboxTabItem extends StatelessWidget {
  final String label;
  final int count;
  final WaTab tab;
  final WaTab selected;
  final ValueChanged<WaTab> onSelect;

  const _InboxTabItem({
    required this.label,
    required this.count,
    required this.tab,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final active = selected == tab;
    return GestureDetector(
      onTap: () => onSelect(tab),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppTokens.brandNavy : Colors.transparent,
          borderRadius: const BorderRadius.all(Radius.circular(9)),
        ),
        alignment: Alignment.center,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                color: active ? Colors.white : AppTokens.textMutedLight,
                fontSize: 13,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            Text(
              '$count',
              style: TextStyle(
                color: active
                    ? Colors.white.withValues(alpha: 0.75)
                    : AppTokens.textDisabledLight,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Thread list ───────────────────────────────────────────────────────────────

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
      color: AppTokens.brandNavy,
      onRefresh: onRefresh,
      child: ListView.separated(
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 78),
        itemBuilder: (context, i) {
          if (i >= state.items.length) {
            WidgetsBinding.instance.addPostFrameCallback((_) => onLoadMore());
            return const Padding(
              padding: EdgeInsets.all(AppTokens.space4),
              child: Center(
                child: SizedBox(
                  height: 22,
                  width: 22,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppTokens.brandNavy),
                ),
              ),
            );
          }
          return _ThreadTile(
              thread: state.items[i],
              onTap: () => onOpen(state.items[i]));
        },
      ),
    );
  }
}

// ── Thread tile ───────────────────────────────────────────────────────────────

class _ThreadTile extends StatelessWidget {
  final WhatsappThread thread;
  final VoidCallback onTap;
  const _ThreadTile({required this.thread, required this.onTap});

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final when = thread.lastMessageAt;
    final hasUnread = thread.unreadCount > 0;
    final awaiting = thread.awaitingReply;

    return Material(
      // Subtle amber tint on awaiting-reply rows
      color: awaiting
          ? AppTokens.statusWarning.withValues(alpha: 0.05)
          : Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space4, vertical: 13),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── avatar ─────────────────────────────────────────────────
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [AppTokens.brandNavy, AppTokens.brandNavyLight],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: [
                    BoxShadow(
                      color: AppTokens.brandNavy.withValues(alpha: 0.18),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: Text(
                  _initials(thread.displayName),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
              ),

              const SizedBox(width: AppTokens.space3),

              // ── content ────────────────────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // name + time
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            thread.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight:
                                  hasUnread ? FontWeight.w700 : FontWeight.w600,
                              color: AppTokens.textPrimaryLight,
                              letterSpacing: -0.1,
                            ),
                          ),
                        ),
                        if (when != null) ...[
                          const SizedBox(width: 6),
                          Text(
                            relativeTime(when),
                            style: const TextStyle(
                              color: AppTokens.textMutedLight,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ],
                    ),

                    const SizedBox(height: 3),

                    // preview + badges
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Text(
                            thread.lastMessagePreview ?? '',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: hasUnread
                                  ? AppTokens.textSecondaryLight
                                  : AppTokens.textMutedLight,
                              fontWeight: hasUnread
                                  ? FontWeight.w500
                                  : FontWeight.w400,
                            ),
                          ),
                        ),

                        // awaiting-reply badge
                        if (awaiting) ...[
                          const SizedBox(width: AppTokens.space2),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppTokens.statusWarning
                                  .withValues(alpha: 0.12),
                              borderRadius:
                                  const BorderRadius.all(AppTokens.radiusFull),
                              border: Border.all(
                                color: AppTokens.statusWarning
                                    .withValues(alpha: 0.4),
                                width: 0.5,
                              ),
                            ),
                            child: const Text(
                              'REPLY',
                              style: TextStyle(
                                color: AppTokens.statusWarning,
                                fontSize: 9,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                        ],

                        // unread count badge
                        if (hasUnread) ...[
                          const SizedBox(width: AppTokens.space2),
                          Container(
                            constraints: const BoxConstraints(
                                minWidth: 20, minHeight: 20),
                            padding:
                                const EdgeInsets.symmetric(horizontal: 6),
                            decoration: const BoxDecoration(
                              color: AppTokens.statusSuccess,
                              borderRadius:
                                  BorderRadius.all(AppTokens.radiusFull),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              '${thread.unreadCount}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
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
      ),
    );
  }
}

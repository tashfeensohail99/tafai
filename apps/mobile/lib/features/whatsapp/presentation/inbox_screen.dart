import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_states.dart';
import '../../../core/widgets/premium_ui.dart';
import '../data/whatsapp_providers.dart';
import '../data/whatsapp_repository.dart';
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

  /// Archived/Blocked are "show ONLY these" views. Tapping the chip selects
  /// that tab; tapping it again returns to All. They also clear the Due chip,
  /// which only applies to the live lists.
  void _toggleView(WaTab view) =>
      ref.read(inboxFilterProvider.notifier).update((f) => f.copyWith(
            tab: f.tab == view ? WaTab.all : view,
            followUpDue: false,
          ));

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

  /// Long-press a chat → quick-actions sheet (Archive / Mark as Junk), like
  /// modern chat apps. Keeps each row clean instead of showing action buttons.
  Future<void> _showThreadActions(WhatsappThread t) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetCtx) {
        final isArchived = t.isArchived;
        final isBlocked = t.isBlocked;
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                    AppTokens.space4, AppTokens.space3, AppTokens.space4, 4),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    t.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: Icon(isArchived
                    ? Icons.unarchive_outlined
                    : Icons.archive_outlined),
                title: Text(isArchived ? 'Unarchive' : 'Archive'),
                onTap: () =>
                    Navigator.pop(sheetCtx, isArchived ? 'unarchive' : 'archive'),
              ),
              if (isBlocked)
                ListTile(
                  leading: const Icon(Icons.lock_open_outlined),
                  title: const Text('Unblock contact'),
                  onTap: () => Navigator.pop(sheetCtx, 'unblock'),
                )
              else
                ListTile(
                  leading: const Icon(Icons.block, color: AppTokens.statusDanger),
                  title: const Text('Mark as Junk',
                      style: TextStyle(color: AppTokens.statusDanger)),
                  subtitle: const Text('Blocks the contact & archives the chat'),
                  onTap: () => Navigator.pop(sheetCtx, 'junk'),
                ),
              const SizedBox(height: AppTokens.space2),
            ],
          ),
        );
      },
    );
    if (action == null || !mounted) return;
    final repo = ref.read(whatsappRepositoryProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      switch (action) {
        case 'archive':
          await repo.archiveThread(t.id);
          messenger.showSnackBar(
              const SnackBar(content: Text('Conversation archived')));
          break;
        case 'unarchive':
          await repo.unarchiveThread(t.id);
          messenger.showSnackBar(
              const SnackBar(content: Text('Conversation unarchived')));
          break;
        case 'junk':
          await repo.blockContact(t.id);
          messenger.showSnackBar(const SnackBar(
              content: Text('Marked as junk — contact blocked & archived')));
          break;
        case 'unblock':
          await repo.unblockContact(t.id);
          messenger.showSnackBar(
              const SnackBar(content: Text('Contact unblocked')));
          break;
      }
      if (!mounted) return;
      final filter = ref.read(inboxFilterProvider);
      await ref.read(threadsControllerProvider(filter).notifier).refresh();
      ref.invalidate(threadStatsProvider);
    } catch (_) {
      messenger.showSnackBar(
          const SnackBar(content: Text('Action failed. Please try again.')));
    }
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

        // ── filter chips: Due / Archived / Blocked ────────────────────────
        Padding(
          padding: const EdgeInsets.only(top: AppTokens.space2),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppTokens.space4),
            child: Row(
              children: [
                if (stats.followUpDue > 0 || filter.followUpDue)
                  CrmFilterChip(
                    label: 'Due follow-ups',
                    count: stats.followUpDue,
                    selected: filter.followUpDue,
                    onTap: _toggleDue,
                    selectedColor: AppTokens.statusWarning,
                  ),
                if (stats.followUpDue > 0 || filter.followUpDue)
                  const SizedBox(width: AppTokens.space2),
                CrmFilterChip(
                  label: 'Archived',
                  count: stats.archived,
                  selected: filter.tab == WaTab.archived,
                  onTap: () => _toggleView(WaTab.archived),
                ),
                const SizedBox(width: AppTokens.space2),
                CrmFilterChip(
                  label: 'Blocked',
                  count: stats.blocked,
                  selected: filter.tab == WaTab.blocked,
                  onTap: () => _toggleView(WaTab.blocked),
                  selectedColor: AppTokens.statusDanger,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppTokens.space2),
        const Divider(height: 1),

        // ── thread list ───────────────────────────────────────────────────
        Expanded(
          child: _ThreadsList(
            state: threads,
            tab: filter.tab,
            onRefresh: () => _refreshAll(filter),
            onLoadMore: () =>
                ref.read(threadsControllerProvider(filter).notifier).loadMore(),
            onRetry: () =>
                ref.read(threadsControllerProvider(filter).notifier).refresh(),
            onOpen: _openThread,
            onActions: _showThreadActions,
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
  final WaTab tab;
  final Future<void> Function() onRefresh;
  final VoidCallback onLoadMore;
  final VoidCallback onRetry;
  final void Function(WhatsappThread) onOpen;
  final void Function(WhatsappThread) onActions;

  const _ThreadsList({
    required this.state,
    required this.tab,
    required this.onRefresh,
    required this.onLoadMore,
    required this.onRetry,
    required this.onOpen,
    required this.onActions,
  });

  @override
  Widget build(BuildContext context) {
    if (state.loading) return const LoadingView();
    if (state.error != null) {
      return ErrorView(error: state.error!, onRetry: onRetry);
    }
    if (state.items.isEmpty) {
      final (icon, title, message) = switch (tab) {
        WaTab.archived => (
            Icons.archive_outlined,
            'No archived chats',
            'Chats you archive will appear here.',
          ),
        WaTab.blocked => (
            Icons.block,
            'No blocked contacts',
            'Contacts you block will appear here.',
          ),
        _ => (
            Icons.forum_outlined,
            'No conversations',
            'Chats assigned to you will appear here.',
          ),
      };
      return EmptyView(icon: icon, title: title, message: message);
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
              onTap: () => onOpen(state.items[i]),
              onLongPress: () => onActions(state.items[i]));
        },
      ),
    );
  }
}

// ── Thread tile ───────────────────────────────────────────────────────────────

class _ThreadTile extends StatelessWidget {
  final WhatsappThread thread;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  const _ThreadTile(
      {required this.thread, required this.onTap, this.onLongPress});

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
                            chatTimestamp(when),
                            style: TextStyle(
                              color: awaiting
                                  ? AppTokens.statusWarning
                                  : AppTokens.textMutedLight,
                              fontSize: 11.5,
                              fontWeight:
                                  hasUnread ? FontWeight.w700 : FontWeight.w500,
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

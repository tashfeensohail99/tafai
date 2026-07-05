import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
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
  // #4 content search — chats matched by MESSAGE TEXT (a "Messages" section
  // below the name/phone matches). Empty unless the query is >= 2 chars.
  List<MessageSearchResult> _msgResults = const [];
  bool _msgBusy = false;
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      ref.read(inboxFilterProvider.notifier).update((f) => f.copyWith(search: v));
      final q = v.trim();
      if (mounted) setState(() => _query = q);
      if (q.length < 2) {
        if (mounted) setState(() {
          _msgResults = const [];
          _msgBusy = false;
        });
        return;
      }
      if (mounted) setState(() => _msgBusy = true);
      try {
        final res = await ref.read(whatsappRepositoryProvider).searchMessages(q);
        // Ignore a stale response if the box moved on to a different query.
        if (mounted && _searchCtrl.text.trim() == q) {
          setState(() {
            _msgResults = res;
            _msgBusy = false;
          });
        }
      } catch (_) {
        if (mounted && _searchCtrl.text.trim() == q) {
          setState(() {
            _msgResults = const [];
            _msgBusy = false;
          });
        }
      }
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
                leading: Icon(t.isPinnedByMe
                    ? Icons.push_pin
                    : Icons.push_pin_outlined),
                title: Text(t.isPinnedByMe ? 'Unpin chat' : 'Pin chat'),
                onTap: () =>
                    Navigator.pop(sheetCtx, t.isPinnedByMe ? 'unpin' : 'pin'),
              ),
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
        case 'pin':
          await repo.pinThread(t.id);
          messenger.showSnackBar(
              const SnackBar(content: Text('Chat pinned to top')));
          break;
        case 'unpin':
          await repo.unpinThread(t.id);
          messenger.showSnackBar(
              const SnackBar(content: Text('Chat unpinned')));
          break;
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
    } catch (e) {
      // Surface a useful message (e.g. the pin cap "You can pin up to 6 chats").
      messenger.showSnackBar(SnackBar(
          content: Text(
              e is AppError ? e.userMessage : 'Action failed. Please try again.')));
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
            hint: 'Search name, phone, or message…',
            onChanged: _onSearch,
          ),
        ),
        const SizedBox(height: AppTokens.space3),

        // ── inline tab bar with counts ────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTokens.space4),
          child: _InboxTabs(
            selected: filter.tab,
            all: stats.open,
            unread: stats.unreadEngaged,
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
            msgResults: _msgResults,
            msgBusy: _msgBusy,
            query: _query,
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
  final int unread;
  final int uncontacted;
  final ValueChanged<WaTab> onSelect;

  const _InboxTabs({
    required this.selected,
    required this.all,
    required this.unread,
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
            label: 'Unread', count: unread, tab: WaTab.unread,
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
  final List<MessageSearchResult> msgResults;
  final bool msgBusy;
  final String query;
  final Future<void> Function() onRefresh;
  final VoidCallback onLoadMore;
  final VoidCallback onRetry;
  final void Function(WhatsappThread) onOpen;
  final void Function(WhatsappThread) onActions;

  const _ThreadsList({
    required this.state,
    required this.tab,
    required this.msgResults,
    required this.msgBusy,
    required this.query,
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
    // Pinned chats first (stable partition preserves the server order within
    // each group), WhatsApp-style.
    final pinned = state.items.where((t) => t.isPinnedByMe).toList();
    final others = state.items.where((t) => !t.isPinnedByMe).toList();

    // #4 content-search "Messages" section — chats matched by MESSAGE TEXT,
    // deduped against the name/phone matches above.
    final searching = query.trim().length >= 2;
    final shownIds = state.items.map((t) => t.id).toSet();
    final extraMsgs =
        msgResults.where((m) => !shownIds.contains(m.thread.id)).toList();
    final showMessages = searching && (extraMsgs.isNotEmpty || msgBusy);

    if (state.items.isEmpty && extraMsgs.isEmpty && !msgBusy) {
      if (searching) {
        return EmptyView(
          icon: Icons.search_off,
          title: 'No matches',
          message: 'No chats or messages match “$query”.',
        );
      }
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

    // Build a flat list of row descriptors (headers, threads, load-more, and
    // the content-search "Messages" section). Clearer + safer than juggling
    // index math, and it lets us surface an explicit "Pinned" / "Other chats"
    // grouping — so a pinned chat is unmistakable, not just a subtle glyph.
    // The ListView.builder still builds only the visible rows, so paging stays
    // lazy. Pins get their own header only on the live list (not while searching).
    final rows = <_Row>[];
    final showPinnedSection = pinned.isNotEmpty && !searching;
    if (showPinnedSection) {
      rows.add(const _Row.header('Pinned'));
      rows.addAll(pinned.map(_Row.thread));
      if (others.isNotEmpty) rows.add(const _Row.header('Other chats'));
      rows.addAll(others.map(_Row.thread));
    } else {
      rows.addAll(state.items.map(_Row.thread));
    }
    if (state.hasMore) rows.add(const _Row.loadMore());
    if (showMessages) {
      rows.add(const _Row.header('Messages'));
      if (msgBusy && extraMsgs.isEmpty) rows.add(const _Row.msgLoading());
      rows.addAll(extraMsgs.map(_Row.msg));
    }

    return RefreshIndicator(
      color: AppTokens.brandNavy,
      onRefresh: onRefresh,
      child: ListView.separated(
        itemCount: rows.length,
        separatorBuilder: (_, i) {
          // No divider hugging a section header.
          if (rows[i].kind == _RowKind.header ||
              (i + 1 < rows.length && rows[i + 1].kind == _RowKind.header)) {
            return const SizedBox.shrink();
          }
          return const Divider(height: 1, indent: 78);
        },
        itemBuilder: (context, index) {
          final row = rows[index];
          switch (row.kind) {
            case _RowKind.header:
              return _SectionHeader(row.label!);
            case _RowKind.thread:
              final t = row.thread!;
              return _ThreadTile(
                  thread: t,
                  onTap: () => onOpen(t),
                  onLongPress: () => onActions(t));
            case _RowKind.loadMore:
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
            case _RowKind.msgLoading:
              return const Padding(
                padding: EdgeInsets.symmetric(
                    horizontal: AppTokens.space4, vertical: 10),
                child: Text('Searching messages…',
                    style: TextStyle(
                        fontSize: 12.5, color: AppTokens.textMutedLight)),
              );
            case _RowKind.msgResult:
              final m = row.msg!;
              return _MessageResultTile(
                result: m,
                query: query.trim(),
                onTap: () => onOpen(m.thread),
              );
          }
        },
      ),
    );
  }
}

/// The kinds of row the inbox list can render.
enum _RowKind { header, thread, loadMore, msgLoading, msgResult }

/// A single inbox-list row descriptor. Building a flat `List<_Row>` (instead of
/// index arithmetic) keeps the section layout — Pinned / Other chats / Messages
/// — obvious and hard to get wrong.
class _Row {
  const _Row._(this.kind, {this.label, this.thread, this.msg});
  const _Row.header(String label) : this._(_RowKind.header, label: label);
  const _Row.thread(WhatsappThread thread)
      : this._(_RowKind.thread, thread: thread);
  const _Row.loadMore() : this._(_RowKind.loadMore);
  const _Row.msgLoading() : this._(_RowKind.msgLoading);
  const _Row.msg(MessageSearchResult msg) : this._(_RowKind.msgResult, msg: msg);

  final _RowKind kind;
  final String? label;
  final WhatsappThread? thread;
  final MessageSearchResult? msg;
}

/// A small uppercase section header ("MESSAGES") separating content-search hits.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(
            AppTokens.space4, AppTokens.space3, AppTokens.space4, 4),
        child: Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
            color: AppTokens.textMutedLight,
          ),
        ),
      );
}

/// A content-search result row: avatar + name + the matched message snippet.
class _MessageResultTile extends StatelessWidget {
  const _MessageResultTile(
      {required this.result, required this.query, required this.onTap});
  final MessageSearchResult result;
  final String query;
  final VoidCallback onTap;

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final name = result.thread.displayName;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppTokens.space4, vertical: 11),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTokens.brandNavy, AppTokens.brandNavyLight],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              alignment: Alignment.center,
              child: Text(_initials(name),
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 13)),
            ),
            const SizedBox(width: AppTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppTokens.textPrimaryLight)),
                  const SizedBox(height: 2),
                  _HighlightedSnippet(text: result.snippet, query: query),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The matched message snippet with the query term emphasized.
class _HighlightedSnippet extends StatelessWidget {
  const _HighlightedSnippet({required this.text, required this.query});
  final String text;
  final String query;

  @override
  Widget build(BuildContext context) {
    const base = TextStyle(fontSize: 12.5, color: AppTokens.textMutedLight);
    if (query.isEmpty) {
      return Text(text,
          maxLines: 1, overflow: TextOverflow.ellipsis, style: base);
    }
    final lower = text.toLowerCase();
    final needle = query.toLowerCase();
    final spans = <TextSpan>[];
    var i = 0;
    while (i < text.length) {
      final idx = lower.indexOf(needle, i);
      if (idx < 0) {
        spans.add(TextSpan(text: text.substring(i)));
        break;
      }
      if (idx > i) spans.add(TextSpan(text: text.substring(i, idx)));
      spans.add(TextSpan(
        text: text.substring(idx, idx + query.length),
        style: const TextStyle(
            color: AppTokens.statusSuccess, fontWeight: FontWeight.w700),
      ));
      i = idx + query.length;
    }
    return Text.rich(TextSpan(style: base, children: spans),
        maxLines: 1, overflow: TextOverflow.ellipsis);
  }
}

// ── Thread tile ───────────────────────────────────────────────────────────────

/// Map the backend's lastMessagePreview tokens ([image] / [audio] / [video] /
/// [document: name] / [sticker] / [location] / [reaction ..]) to a WhatsApp-style
/// glyph + label ("📷 Photo" / "🎤 Voice message" / …). Plain text passes through
/// unchanged. Mirrors the web renderPreview so both surfaces read the same.
(IconData?, String) _previewParts(String? preview) {
  if (preview == null || preview.isEmpty) return (null, '');
  final react = RegExp(r'^\[reaction\s+(.+)\]$').firstMatch(preview);
  if (react != null) return (null, 'Reacted ${react.group(1)}');
  final m = RegExp(r'^\[([a-zA-Z]+)(?::\s*(.+))?\]$').firstMatch(preview);
  if (m == null) return (null, preview);
  final kind = m.group(1)!.toLowerCase();
  final rest = m.group(2)?.trim();
  switch (kind) {
    case 'image':
      return (Icons.photo, 'Photo');
    case 'video':
      return (Icons.videocam, 'Video');
    case 'audio':
      return (Icons.mic, 'Voice message');
    case 'document':
      return (Icons.description, (rest != null && rest.isNotEmpty) ? rest : 'Document');
    case 'sticker':
      return (Icons.emoji_emotions_outlined, 'Sticker');
    case 'location':
      return (Icons.location_on, 'Location');
    case 'contacts':
    case 'contact':
      return (Icons.person, 'Contact');
    default:
      return (null, preview);
  }
}

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
    final (previewIcon, previewText) = _previewParts(thread.lastMessagePreview);

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
                              color: hasUnread
                                  ? AppTokens.statusSuccess
                                  : awaiting
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
                          child: Row(
                            children: [
                              if (previewIcon != null) ...[
                                Icon(
                                  previewIcon,
                                  size: 13,
                                  color: hasUnread
                                      ? AppTokens.textSecondaryLight
                                      : AppTokens.textMutedLight,
                                ),
                                const SizedBox(width: 3),
                              ],
                              Expanded(
                                child: Text(
                                  previewText,
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
                            ],
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

                        // pinned glyph (WhatsApp-style, personal pin) — tilted
                        // + brand-navy so a pinned chat is unmistakable at a
                        // glance (a faint grey pin was too easy to miss).
                        if (thread.isPinnedByMe) ...[
                          const SizedBox(width: AppTokens.space2),
                          Transform.rotate(
                            angle: 0.6,
                            child: const Icon(Icons.push_pin,
                                size: 16, color: AppTokens.brandNavy),
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

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/wa_message.dart';
import '../domain/wa_stats.dart';
import '../domain/wa_thread.dart';
import 'whatsapp_repository.dart';

/// The inbox tabs — matching the web exactly. `archived` and `blocked` are
/// "show ONLY these" views (each maps to a single backend flag); the other
/// tabs show the default list, which the backend already excludes archived +
/// blocked threads from.
enum WaTab { all, unread, open, uncontacted, archived, blocked }

class WaFilter {
  final WaTab tab;
  final String search;
  final bool followUpDue;
  /// Sales-disposition funnel. Null = no disposition filter (any). When set,
  /// the list is narrowed to chats whose lead carries this disposition, on TOP
  /// of the active tab. `clearDisposition:true` on copyWith resets it to null.
  final String? disposition;
  const WaFilter({
    this.tab = WaTab.all,
    this.search = '',
    this.followUpDue = false,
    this.disposition,
  });

  WaFilter copyWith({
    WaTab? tab,
    String? search,
    bool? followUpDue,
    String? disposition,
    bool clearDisposition = false,
  }) =>
      WaFilter(
        tab: tab ?? this.tab,
        search: search ?? this.search,
        followUpDue: followUpDue ?? this.followUpDue,
        disposition: clearDisposition ? null : (disposition ?? this.disposition),
      );

  @override
  bool operator ==(Object other) =>
      other is WaFilter &&
      other.tab == tab &&
      other.search == search &&
      other.followUpDue == followUpDue &&
      other.disposition == disposition;

  @override
  int get hashCode => Object.hash(tab, search, followUpDue, disposition);
}

final inboxFilterProvider = StateProvider<WaFilter>((_) => const WaFilter());

/// Live tab-badge counts.
final threadStatsProvider = FutureProvider.autoDispose<ThreadStats>((ref) {
  return ref.watch(whatsappRepositoryProvider).stats();
});

// --- Threads (cursor pagination) ------------------------------------------

class ThreadsState {
  final List<WhatsappThread> items;
  final String? nextCursor;
  final bool loading;
  final bool loadingMore;
  final Object? error;
  const ThreadsState({
    this.items = const [],
    this.nextCursor,
    this.loading = true,
    this.loadingMore = false,
    this.error,
  });

  bool get hasMore => nextCursor != null;
}

class ThreadsController extends StateNotifier<ThreadsState> {
  final WhatsappRepository _repo;
  final WaFilter _filter;
  ThreadsController(this._repo, this._filter) : super(const ThreadsState()) {
    load();
  }

  ({bool? contacted, bool? uncontacted, bool? unread, bool? archived, bool? blocked})
      get _tabFlags => switch (_filter.tab) {
            WaTab.open => (
                contacted: true,
                uncontacted: null,
                unread: null,
                archived: null,
                blocked: null
              ),
            WaTab.unread => (
                contacted: true,
                uncontacted: null,
                unread: true,
                archived: null,
                blocked: null
              ),
            WaTab.uncontacted => (
                contacted: null,
                uncontacted: true,
                unread: null,
                archived: null,
                blocked: null
              ),
            WaTab.archived => (
                contacted: null,
                uncontacted: null,
                unread: null,
                archived: true,
                blocked: null
              ),
            WaTab.blocked => (
                contacted: null,
                uncontacted: null,
                unread: null,
                archived: null,
                blocked: true
              ),
            WaTab.all => (
                // Funnel: "All" = engaged (a human has replied). New leads live
                // in Uncontacted until a rep replies, then graduate here — this
                // matches the badge, which shows stats.open (total − uncontacted).
                contacted: true,
                uncontacted: null,
                unread: null,
                archived: null,
                blocked: null
              ),
          };

  /// The Due chip only makes sense on the live (non-archived/non-blocked) lists.
  bool? get _dueFlag => (_filter.followUpDue &&
          _filter.tab != WaTab.archived &&
          _filter.tab != WaTab.blocked)
      ? true
      : null;

  Future<void> load() async {
    state = const ThreadsState(loading: true);
    try {
      final f = _tabFlags;
      final page = await _repo.listThreads(
        contacted: f.contacted,
        uncontacted: f.uncontacted,
        unread: f.unread,
        archived: f.archived,
        blocked: f.blocked,
        followUpDue: _dueFlag,
        disposition: _filter.disposition,
        search: _filter.search,
      );
      state = ThreadsState(
        items: page.items,
        nextCursor: page.nextCursor,
        loading: false,
      );
    } catch (e) {
      state = ThreadsState(loading: false, error: e);
    }
  }

  Future<void> loadMore() async {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    state = ThreadsState(
      items: state.items,
      nextCursor: state.nextCursor,
      loading: false,
      loadingMore: true,
    );
    try {
      final f = _tabFlags;
      final page = await _repo.listThreads(
        contacted: f.contacted,
        uncontacted: f.uncontacted,
        unread: f.unread,
        archived: f.archived,
        blocked: f.blocked,
        followUpDue: _dueFlag,
        disposition: _filter.disposition,
        search: _filter.search,
        cursor: state.nextCursor,
      );
      state = ThreadsState(
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
        loading: false,
      );
    } catch (_) {
      // Keep what we have; just stop the spinner.
      state = ThreadsState(
        items: state.items,
        nextCursor: state.nextCursor,
        loading: false,
      );
    }
  }

  Future<void> refresh() => load();
}

final threadsControllerProvider = StateNotifierProvider.autoDispose
    .family<ThreadsController, ThreadsState, WaFilter>((ref, filter) {
  return ThreadsController(ref.watch(whatsappRepositoryProvider), filter);
});

// --- Messages (older-message pagination) ----------------------------------

class MessagesState {
  final List<ChatMessage> items;
  final bool loading;
  final bool loadingOlder;
  final bool hasOlder;
  final Object? error;
  const MessagesState({
    this.items = const [],
    this.loading = true,
    this.loadingOlder = false,
    this.hasOlder = false,
    this.error,
  });
}

class MessagesController extends StateNotifier<MessagesState> {
  final WhatsappRepository _repo;
  final String _threadId;
  MessagesController(this._repo, this._threadId)
      : super(const MessagesState()) {
    load();
  }

  Future<void> load() async {
    state = const MessagesState(loading: true);
    try {
      final msgs = await _repo.messages(_threadId);
      state = MessagesState(
        items: msgs,
        loading: false,
        hasOlder: msgs.length >= 50,
      );
    } catch (e) {
      state = MessagesState(loading: false, error: e);
    }
  }

  Future<void> loadOlder() async {
    if (state.loading || state.loadingOlder || !state.hasOlder || state.items.isEmpty) {
      return;
    }
    state = MessagesState(
      items: state.items,
      loading: false,
      loadingOlder: true,
      hasOlder: state.hasOlder,
    );
    try {
      final older =
          await _repo.messages(_threadId, before: state.items.first.createdAt);
      state = MessagesState(
        items: [...older, ...state.items],
        loading: false,
        hasOlder: older.length >= 50,
      );
    } catch (_) {
      state = MessagesState(
        items: state.items,
        loading: false,
        hasOlder: state.hasOlder,
      );
    }
  }

  /// Append a just-sent message (optimistic tail update).
  void append(ChatMessage m) {
    state = MessagesState(
      items: [...state.items, m],
      loading: false,
      hasOlder: state.hasOlder,
    );
  }

  Future<void> refresh() => load();

  /// Quietly reconcile the latest messages (status ticks sent→delivered→read
  /// and any new inbound) WITHOUT flashing a loader or dropping scroll
  /// position. Safe to call on a foreground timer while the thread is open.
  Future<void> syncTail() async {
    if (state.loading || state.loadingOlder || state.items.isEmpty) return;
    try {
      final latest = await _repo.messages(_threadId); // newest page, ascending
      if (latest.isEmpty) return;
      // Overlay by id: updates existing rows' status, adds brand-new ones.
      final byId = {for (final m in state.items) m.id: m};
      for (final m in latest) {
        byId[m.id] = m;
      }
      final merged = byId.values.toList()
        ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
      state = MessagesState(
        items: merged,
        loading: false,
        hasOlder: state.hasOlder,
      );
    } catch (_) {
      // Transient failure — keep what we have, try again next tick.
    }
  }
}

final messagesControllerProvider = StateNotifierProvider.autoDispose
    .family<MessagesController, MessagesState, String>((ref, threadId) {
  return MessagesController(ref.watch(whatsappRepositoryProvider), threadId);
});

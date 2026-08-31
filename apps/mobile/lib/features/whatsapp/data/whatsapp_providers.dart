import 'dart:io';

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
  /// "Upcoming" chip — chats whose lead has an OPEN follow-up set for LATER
  /// (dueAt in the future). Forward-looking complement of [followUpDue];
  /// mutually exclusive with it in the UI.
  final bool followUpUpcoming;
  /// Sales-disposition funnel. Null = no disposition filter (any). When set,
  /// the list is narrowed to chats whose lead carries this disposition, on TOP
  /// of the active tab. `clearDisposition:true` on copyWith resets it to null.
  final String? disposition;
  const WaFilter({
    this.tab = WaTab.all,
    this.search = '',
    this.followUpDue = false,
    this.followUpUpcoming = false,
    this.disposition,
  });

  WaFilter copyWith({
    WaTab? tab,
    String? search,
    bool? followUpDue,
    bool? followUpUpcoming,
    String? disposition,
    bool clearDisposition = false,
  }) =>
      WaFilter(
        tab: tab ?? this.tab,
        search: search ?? this.search,
        followUpDue: followUpDue ?? this.followUpDue,
        followUpUpcoming: followUpUpcoming ?? this.followUpUpcoming,
        disposition: clearDisposition ? null : (disposition ?? this.disposition),
      );

  @override
  bool operator ==(Object other) =>
      other is WaFilter &&
      other.tab == tab &&
      other.search == search &&
      other.followUpDue == followUpDue &&
      other.followUpUpcoming == followUpUpcoming &&
      other.disposition == disposition;

  @override
  int get hashCode =>
      Object.hash(tab, search, followUpDue, followUpUpcoming, disposition);
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

// --- Session caches (stale-while-revalidate) -------------------------------
// In-memory snapshots of recently-viewed lists so reopening paints INSTANTLY
// instead of blanking to a spinner: the controller seeds from the cache and
// quietly revalidates in the background. Bounded LRU; wiped on logout via
// [clearWhatsappSessionCaches].
const _kThreadsCacheMax = 8;
const _kMessagesCacheMax = 12;
final _threadsCache = <WaFilter, ThreadsState>{};
final _messagesCache = <String, MessagesState>{};

/// Session epoch. Controllers capture it at construction and their dispose()
/// snapshot is DROPPED if it has moved on — without this, the logout wipe is
/// defeated: the wipe runs synchronously on the auth flip while the WhatsApp
/// screens are still mounted, and their controllers' dispose() would re-insert
/// the logged-out rep's threads/messages right after the clear.
int _cacheEpoch = 0;

void _lruPut<K, V>(Map<K, V> cache, K key, V value, int max) {
  cache.remove(key);
  cache[key] = value;
  while (cache.length > max) {
    cache.remove(cache.keys.first);
  }
}

/// Wipe the per-session WhatsApp caches (called on BOTH sides of an auth
/// change so the next account on this device can never see the previous rep's
/// threads). Bumping the epoch also invalidates in-flight dispose snapshots.
void clearWhatsappSessionCaches() {
  _cacheEpoch++;
  _threadsCache.clear();
  _messagesCache.clear();
}

class ThreadsController extends StateNotifier<ThreadsState> {
  final WhatsappRepository _repo;
  final WaFilter _filter;
  final int _epoch = _cacheEpoch;
  ThreadsController(this._repo, this._filter)
      : super(_threadsCache[_filter] ?? const ThreadsState()) {
    if (state.loading || state.items.isEmpty) {
      load();
    } else {
      // Warm open (tab/chip revisit) — stale rows paint immediately, the
      // fresh page swaps in quietly underneath.
      quietReload();
    }
  }

  @override
  void dispose() {
    final s = state;
    // Skip: stale-epoch snapshots (logged-out session), transient states, and
    // search results (per-keystroke filters would churn the LRU with entries
    // that are never revisited by the exact same string).
    if (_epoch == _cacheEpoch &&
        _filter.search.isEmpty &&
        !s.loading &&
        !s.loadingMore &&
        s.error == null &&
        s.items.isNotEmpty) {
      _lruPut(_threadsCache, _filter, s, _kThreadsCacheMax);
    }
    super.dispose();
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

  /// The Upcoming chip, like Due, only applies to the live lists.
  bool? get _upcomingFlag => (_filter.followUpUpcoming &&
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
        followUpUpcoming: _upcomingFlag,
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
        followUpUpcoming: _upcomingFlag,
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

  /// Reload from the server WITHOUT clearing the list or flashing the loader, so
  /// the ListView — and the rep's scroll position — stays put. Used on return
  /// from a thread: a reply may have changed the row, but the list must not
  /// blank out and jump back to the top (the loader replaces the whole list).
  Future<void> quietReload() async {
    try {
      final f = _tabFlags;
      final page = await _repo.listThreads(
        contacted: f.contacted,
        uncontacted: f.uncontacted,
        unread: f.unread,
        archived: f.archived,
        blocked: f.blocked,
        followUpDue: _dueFlag,
        followUpUpcoming: _upcomingFlag,
        disposition: _filter.disposition,
        search: _filter.search,
      );
      state = ThreadsState(
        items: page.items,
        nextCursor: page.nextCursor,
        loading: false,
      );
    } catch (_) {
      // Keep the current list on failure — never blank the inbox on this reload.
    }
  }
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

  /// Acquires a Riverpod keep-alive link. While an optimistic `temp-` bubble
  /// exists (send in flight, or FAILED awaiting retry), the controller — not
  /// the screen — owns reconciliation: the rep can pop back to the inbox the
  /// moment the bubble appears, and the in-flight POST still lands, flips the
  /// bubble, and (on failure) PRESERVES it for when the thread is reopened.
  /// Without this, autoDispose would wipe the only copy of a failed send.
  final KeepAliveLink Function()? _acquireKeepAlive;
  KeepAliveLink? _tempLink;

  /// Monotonic suffix so two sends in the same microsecond can't collide on a
  /// temp id. The temp id doubles as the send's idempotencyKey, so a retry of
  /// a timed-out send can never double-deliver to the customer.
  static int _tempSeq = 0;

  final int _epoch = _cacheEpoch;

  MessagesController(this._repo, this._threadId,
      {KeepAliveLink Function()? acquireKeepAlive})
      : _acquireKeepAlive = acquireKeepAlive,
        super(_messagesCache[_threadId] ?? const MessagesState()) {
    if (state.loading || state.items.isEmpty) {
      load();
    } else {
      // Warm reopen — cached page paints instantly (no spinner), then the
      // delta syncTail reconciles anything that changed while we were away
      // (its saturation branch rebases on the fresh tail if a LOT did).
      syncTail();
    }
  }

  @override
  void dispose() {
    final s = state;
    if (_epoch == _cacheEpoch &&
        !s.loading &&
        !s.loadingOlder &&
        s.error == null &&
        s.items.isNotEmpty) {
      _lruPut(_messagesCache, _threadId, s, _kMessagesCacheMax);
    }
    super.dispose();
  }

  static bool _isTemp(ChatMessage m) => m.id.startsWith('temp-');

  /// List order: server rows by createdAt, optimistic temps ALWAYS last (their
  /// createdAt is the DEVICE clock — sorting them inline would teleport a
  /// pending/FAILED bubble into older history on phones with a slow clock).
  static int _order(ChatMessage a, ChatMessage b) {
    final at = _isTemp(a), bt = _isTemp(b);
    if (at != bt) return at ? 1 : -1;
    final c = a.createdAt.compareTo(b.createdAt);
    return c != 0 ? c : a.id.compareTo(b.id);
  }

  /// Acquire/release the keep-alive link to match temp-bubble presence.
  void _syncTempLink() {
    final hasTemps = state.items.any(_isTemp);
    if (hasTemps) {
      _tempLink ??= _acquireKeepAlive?.call();
    } else {
      _tempLink?.close();
      _tempLink = null;
    }
  }

  Future<void> load() async {
    // Carry optimistic temp bubbles across a (re)load — a wholesale replace
    // would silently discard an in-flight send's only copy.
    final temps = state.items.where(_isTemp).toList();
    state = MessagesState(loading: true, items: temps);
    try {
      final msgs = await _repo.messages(_threadId);
      if (!mounted) return;
      final echoed = <String>{
        for (final m in msgs)
          if (m.idempotencyKey != null) m.idempotencyKey!,
      };
      final keep = temps.where((t) => !echoed.contains(t.id)).toList();
      state = MessagesState(
        items: [...msgs, ...keep]..sort(_order),
        loading: false,
        hasOlder: msgs.length >= 50,
      );
      _syncTempLink();
    } catch (e) {
      if (!mounted) return;
      state = MessagesState(loading: false, error: e, items: temps);
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

  /// Append a just-sent message (optimistic tail update). Id-safe: if the row
  /// is already present (the un-gated poll can insert a slow send's server row
  /// before the POST response is processed), it is REPLACED, never duplicated
  /// — a duplicate id would also collide the list's ValueKeys.
  void append(ChatMessage m) {
    if (!mounted) return;
    final items = [...state.items];
    final i = items.indexWhere((x) => x.id == m.id);
    if (i >= 0) {
      items[i] = m;
    } else {
      items.add(m);
      items.sort(_order);
    }
    state = MessagesState(items: items, loading: false, hasOlder: state.hasOlder);
    _syncTempLink();
  }

  /// OPTIMISTIC text send: the bubble appears synchronously (before the first
  /// await), the POST reconciles it in the background — even if the screen is
  /// popped meanwhile (see _acquireKeepAlive). Returns null on success, else
  /// the error (for the screen to toast if it's still around).
  Future<Object?> sendTextOptimistic({
    required String body,
    String? contextWaMessageId,
  }) {
    final tempId =
        'temp-${DateTime.now().microsecondsSinceEpoch}-${_tempSeq++}';
    append(ChatMessage(
      id: tempId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: 'QUEUED',
      body: body,
      repliedToWaMessageId: contextWaMessageId,
      idempotencyKey: tempId,
      createdAt: DateTime.now(),
    ));
    return _postText(
      tempId: tempId,
      body: body,
      contextWaMessageId: contextWaMessageId,
    );
  }

  /// OPTIMISTIC media/voice send: the bubble (local preview / "Sending…")
  /// appears immediately and the composer is NEVER frozen — the multipart
  /// upload (up to minutes for a big video) reconciles in the background,
  /// controller-owned like text sends. On failure the bubble flips FAILED and
  /// the FILE IS KEPT for tap-to-retry (failed voice notes used to be deleted
  /// forever). `deleteOnSuccess` is for our own temp recordings (voice notes);
  /// picked gallery files are never touched.
  Future<Object?> sendMediaOptimistic({
    required String filePath,
    required String type, // IMAGE | VIDEO | AUDIO | DOCUMENT
    String? fileName,
    String? caption,
    bool deleteOnSuccess = false,
  }) {
    final tempId =
        'temp-${DateTime.now().microsecondsSinceEpoch}-${_tempSeq++}';
    append(ChatMessage(
      id: tempId,
      direction: 'OUTBOUND',
      type: type,
      status: 'QUEUED',
      body: caption,
      idempotencyKey: tempId,
      payload: {
        'localPath': filePath,
        if (fileName != null) 'localFileName': fileName,
        if (deleteOnSuccess) 'deleteOnSuccess': true,
      },
      createdAt: DateTime.now(),
    ));
    return _postMedia(
      tempId: tempId,
      filePath: filePath,
      fileName: fileName,
      caption: caption,
      deleteOnSuccess: deleteOnSuccess,
    );
  }

  Future<Object?> _postMedia({
    required String tempId,
    required String filePath,
    String? fileName,
    String? caption,
    bool deleteOnSuccess = false,
  }) async {
    try {
      if (!File(filePath).existsSync()) {
        // Retry after the picker/temp file was purged — nothing to upload.
        setTempStatus(tempId, 'FAILED');
        return StateError('Attachment is no longer available on this phone.');
      }
      final msg = await _repo.sendMedia(
        _threadId,
        filePath: filePath,
        fileName: fileName,
        caption: caption,
        idempotencyKey: tempId,
      );
      replaceTemp(tempId, msg);
      if (deleteOnSuccess) {
        try {
          final f = File(filePath);
          if (f.existsSync()) f.deleteSync();
        } catch (_) {}
      }
      return null;
    } catch (e) {
      setTempStatus(tempId, 'FAILED');
      return e;
    }
  }

  /// Tap-to-retry of a FAILED temp bubble — same tempId, so the SAME
  /// idempotencyKey, so the backend collapses a retry whose first attempt
  /// actually landed. Media temps re-upload their kept local file.
  Future<Object?> retryTemp(String tempId) {
    ChatMessage? temp;
    for (final m in state.items) {
      if (m.id == tempId) {
        temp = m;
        break;
      }
    }
    if (temp == null) return Future.value();
    final localPath = temp.payload?['localPath'] as String?;
    if (localPath != null) {
      if (!File(localPath).existsSync()) {
        // Unwinnable retry — don't flash "Sending…" first; leave it FAILED
        // and let the screen surface the accurate message.
        return Future.value(
            StateError('Attachment is no longer available on this phone.'));
      }
      setTempStatus(tempId, 'QUEUED');
      return _postMedia(
        tempId: tempId,
        filePath: localPath,
        fileName: temp.payload?['localFileName'] as String?,
        caption: temp.body,
        deleteOnSuccess: temp.payload?['deleteOnSuccess'] == true,
      );
    }
    setTempStatus(tempId, 'QUEUED');
    return _postText(
      tempId: tempId,
      body: temp.body ?? '',
      contextWaMessageId: temp.repliedToWaMessageId,
    );
  }

  Future<Object?> _postText({
    required String tempId,
    required String body,
    String? contextWaMessageId,
  }) async {
    try {
      final msg = await _repo.sendText(
        _threadId,
        body,
        contextWaMessageId: contextWaMessageId,
        idempotencyKey: tempId,
      );
      replaceTemp(tempId, msg);
      return null;
    } catch (e) {
      setTempStatus(tempId, 'FAILED');
      return e;
    }
  }

  /// Swap an optimistic temp bubble for the server row the POST returned. If a
  /// poll got there first and already inserted the server row, just drop the
  /// temp so no duplicate remains.
  void replaceTemp(String tempId, ChatMessage server) {
    if (!mounted) return;
    final items = [...state.items]..removeWhere((m) => m.id == tempId);
    if (!items.any((m) => m.id == server.id)) {
      items.add(server);
      items.sort(_order);
    }
    state = MessagesState(items: items, loading: false, hasOlder: state.hasOlder);
    _syncTempLink();
  }

  /// Flip a temp bubble's status (QUEUED → FAILED on send error, back to
  /// QUEUED on tap-to-retry). No-op if the bubble is gone.
  void setTempStatus(String tempId, String status) {
    if (!mounted) return;
    var changed = false;
    final items = state.items.map((m) {
      if (m.id != tempId || m.status == status) return m;
      changed = true;
      return ChatMessage(
        id: m.id,
        direction: m.direction,
        type: m.type,
        status: status,
        body: m.body,
        mediaUrl: m.mediaUrl,
        mediaMimeType: m.mediaMimeType,
        templateName: m.templateName,
        errorCode: m.errorCode,
        errorTitle: m.errorTitle,
        waMessageId: m.waMessageId,
        repliedToWaMessageId: m.repliedToWaMessageId,
        idempotencyKey: m.idempotencyKey,
        payload: m.payload,
        createdAt: m.createdAt,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        failedAt: m.failedAt,
      );
    }).toList();
    if (!changed) return;
    state = MessagesState(items: items, loading: false, hasOlder: state.hasOlder);
  }

  Future<void> refresh() => load();

  /// Outbound statuses whose tick can still advance. READ / FAILED are final,
  /// so rows at or past them never need re-fetching.
  static const _liveStatuses = {'QUEUED', 'SENDING', 'SENT', 'DELIVERED'};

  /// Quietly reconcile the latest messages (status ticks sent→delivered→read
  /// and any new inbound) WITHOUT flashing a loader or dropping scroll
  /// position. Safe to call on a foreground timer while the thread is open.
  ///
  /// Uses the backend's `after` delta cursor instead of re-downloading the
  /// whole newest page every tick. Ticks only ever advance on non-terminal
  /// OUTBOUND rows, so fetching from the OLDEST such row catches every status
  /// change AND anything new, at a fraction of the payload.
  Future<void> syncTail() async {
    if (state.loading || state.loadingOlder || state.items.isEmpty) return;
    try {
      // Anchor scan is CLAMPED to the newest 40 server rows: an outbound row
      // can park at DELIVERED forever (read receipts off) or at a stuck
      // QUEUED/SENT, and "Load older" can prepend hundreds of rows — an
      // unclamped scan would pin the cursor arbitrarily far from the tail.
      final nonTemp = [for (final m in state.items) if (!_isTemp(m)) m];
      DateTime? anchor;
      final scanFrom = nonTemp.length > 40 ? nonTemp.length - 40 : 0;
      for (var i = scanFrom; i < nonTemp.length; i++) {
        final m = nonTemp[i];
        if (m.isOutbound && _liveStatuses.contains(m.status)) {
          anchor = m.createdAt;
          break; // ascending — first hit is the oldest still-live row
        }
      }
      if (nonTemp.isNotEmpty && anchor == null) {
        // Everything settled — only what's newer than the last server row.
        anchor = nonTemp.last.createdAt;
      }
      // No server row at all (first send still in flight) → full page.
      // 1s back-off because the backend cursor is strictly `createdAt >`.
      final latest = await _repo.messages(
        _threadId,
        after: anchor?.subtract(const Duration(seconds: 1)),
      );
      if (latest.length >= 50) {
        // Delta page SATURATED (backend serves the oldest 50 after the
        // cursor) — >50 rows arrived since the anchor, so a merged view could
        // hide a silent GAP between the delta window and the true tail (the
        // classic case: a warm open seeded from an hours-old cache). Don't
        // merge disjoint windows: REBASE the list on a fresh contiguous
        // newest page, keeping only unresolved optimistic temps. "Load older"
        // re-fetches history contiguously from there.
        final tail = await _repo.messages(_threadId);
        if (tail.isEmpty || !mounted) return;
        final echoed = <String>{
          for (final m in tail)
            if (m.idempotencyKey != null) m.idempotencyKey!,
        };
        final temps = state.items
            .where((m) => _isTemp(m) && !echoed.contains(m.id))
            .toList();
        state = MessagesState(
          items: [...tail, ...temps]..sort(_order),
          loading: false,
          hasOlder: tail.length >= 50,
        );
        _syncTempLink();
        return;
      }
      if (latest.isEmpty) return;
      // A server row echoing a temp bubble's idempotencyKey IS that send —
      // drop the temp so the poll can never race the POST into a duplicate.
      final serverKeys = <String>{
        for (final m in latest)
          if (m.idempotencyKey != null) m.idempotencyKey!,
      };
      // Overlay by id: updates existing rows' status, adds brand-new ones.
      final byId = <String, ChatMessage>{
        for (final m in state.items)
          if (!(_isTemp(m) && serverKeys.contains(m.id))) m.id: m,
      };
      for (final m in latest) {
        byId[m.id] = m;
      }
      final merged = byId.values.toList()..sort(_order);
      // Identical content → skip the publish, so the whole thread doesn't
      // rebuild every 5s for nothing (every ChatMessage is a fresh instance,
      // so listeners can't tell "same data" apart without this check). The
      // comparison covers every field the poll can change live: status ticks,
      // late media URLs, error info, and the failed-voice transcript that
      // arrives as a payload-only update with NO status change.
      if (merged.length == state.items.length) {
        var same = true;
        for (var i = 0; i < merged.length; i++) {
          final a = merged[i], b = state.items[i];
          if (a.id != b.id ||
              a.status != b.status ||
              a.mediaUrl != b.mediaUrl ||
              a.errorTitle != b.errorTitle ||
              a.payload?['failedTranscript'] != b.payload?['failedTranscript']) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      if (!mounted) return;
      state = MessagesState(
        items: merged,
        loading: false,
        hasOlder: state.hasOlder,
      );
      _syncTempLink();
    } catch (_) {
      // Transient failure — keep what we have, try again next tick.
    }
  }
}

final messagesControllerProvider = StateNotifierProvider.autoDispose
    .family<MessagesController, MessagesState, String>((ref, threadId) {
  return MessagesController(
    ref.watch(whatsappRepositoryProvider),
    threadId,
    // Lets the controller pin itself alive while an optimistic send is in
    // flight (or FAILED awaiting retry) even after the screen is popped.
    acquireKeepAlive: () => ref.keepAlive(),
  );
});

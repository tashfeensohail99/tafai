import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/follow_up.dart';
import 'followups_repository.dart';

/// Follow-ups for a given bucket ('overdue' | 'today' | 'upcoming').
final followUpsListProvider =
    FutureProvider.autoDispose.family<List<FollowUp>, String>((ref, bucket) async {
  return ref.watch(followUpsRepositoryProvider).listByBucket(bucket);
});

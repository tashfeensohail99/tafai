import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/portal_models.dart';
import 'portal_repository.dart';

/// The client's cases (GET /portal/cases/mine). Resolved once on shell load.
/// A client with portalAccessEnabled=false gets a ForbiddenError here, which
/// the shell renders as a clean "no access" state rather than crashing.
final portalCasesProvider =
    FutureProvider.autoDispose<List<PortalCaseSummary>>((ref) {
  return ref.watch(portalRepositoryProvider).myCases();
});

/// The active case for the signed-in client — the most recent (cases come back
/// newest-first). Tabs read this to know which case to load. Null when the
/// client has no active case (a valid empty state, not an error).
final activeCaseIdProvider = Provider.autoDispose<String?>((ref) {
  final cases = ref.watch(portalCasesProvider).valueOrNull;
  if (cases == null || cases.isEmpty) return null;
  return cases.first.id;
});

/// Case overview detail, keyed by caseId.
final portalCaseDetailProvider = FutureProvider.autoDispose
    .family<PortalCaseDetail, String>((ref, caseId) {
  return ref.watch(portalRepositoryProvider).caseDetail(caseId);
});

/// Document checklist, keyed by caseId.
final portalDocumentsProvider = FutureProvider.autoDispose
    .family<List<PortalDocumentItem>, String>((ref, caseId) {
  return ref.watch(portalRepositoryProvider).documents(caseId);
});

/// Message thread, keyed by caseId. Fetching also marks officer messages read
/// server-side, so invalidating the unread badge after a read is appropriate.
final portalMessagesProvider = FutureProvider.autoDispose
    .family<List<PortalMessage>, String>((ref, caseId) {
  return ref.watch(portalRepositoryProvider).messages(caseId);
});

/// The derived notification feed (across all the client's cases).
final portalNotificationsProvider =
    FutureProvider.autoDispose<List<PortalNotification>>((ref) {
  return ref.watch(portalRepositoryProvider).notifications();
});

/// All of the client's appointments (past + upcoming).
final portalAppointmentsProvider =
    FutureProvider.autoDispose<List<PortalAppointment>>((ref) {
  return ref.watch(portalRepositoryProvider).appointments();
});

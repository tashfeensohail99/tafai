import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../domain/processing_models.dart';
import 'processing_repository.dart';

/// True when the signed-in user is a Processing Manager. Manager-only surfaces
/// (Intake tab, Manager dashboard, Reassign / Cancel actions) gate on this.
/// The server also enforces the matching permissions, so this is a UX gate, not
/// a security boundary.
final isProcessingManagerProvider = Provider<bool>((ref) {
  final user = ref.watch(currentUserProvider);
  final roles = user?.roles ?? const <String>[];
  if (roles.contains('processing_manager')) return true;
  // Fall back to the permissions the web client uses to detect "manager".
  final perms = user?.permissions ?? const <String>[];
  return perms.contains('processing.case.view_all') ||
      perms.contains('processing.case.assign');
});

/// Can this user reassign cases? (manager-only on the backend).
final canAssignCasesProvider = Provider<bool>((ref) {
  final user = ref.watch(currentUserProvider);
  return user?.permissions.contains('processing.case.assign') ?? false;
});

// --- Dashboard ------------------------------------------------------------

final processingDashboardProvider =
    FutureProvider.autoDispose<ProcessingDashboardMetrics>((ref) {
  return ref.watch(processingRepositoryProvider).dashboard();
});

final processingAdminOverviewProvider =
    FutureProvider.autoDispose<AdminOverview>((ref) {
  return ref.watch(processingRepositoryProvider).adminOverview();
});

// --- Cases list (search/filter state lives in the My Cases tab) -----------

/// Query parameters for the My Cases list — a small value type so the
/// FutureProvider.family re-fetches when the search/filter changes.
class CasesQuery {
  final String? search;
  final List<String>? stages;
  final String? priority;

  const CasesQuery({this.search, this.stages, this.priority});

  @override
  bool operator ==(Object other) =>
      other is CasesQuery &&
      other.search == search &&
      other.priority == priority &&
      _listEq(other.stages, stages);

  @override
  int get hashCode => Object.hash(
        search,
        priority,
        stages == null ? null : Object.hashAll(stages!),
      );

  static bool _listEq(List<String>? a, List<String>? b) {
    if (a == null && b == null) return true;
    if (a == null || b == null || a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

final processingCasesProvider =
    FutureProvider.autoDispose.family<ListCasesResult, CasesQuery>((ref, q) {
  return ref.watch(processingRepositoryProvider).listCases(
        search: q.search,
        stages: q.stages,
        priority: q.priority,
        limit: 100,
      );
});

// --- Cross-case queues ----------------------------------------------------

final aggregatedDocumentsProvider =
    FutureProvider.autoDispose<List<AggregatedDocument>>((ref) {
  return ref.watch(processingRepositoryProvider).aggregatedDocuments();
});

final aggregatedTasksProvider =
    FutureProvider.autoDispose<List<AggregatedTask>>((ref) {
  return ref.watch(processingRepositoryProvider).aggregatedTasks();
});

// --- Intake (manager) -----------------------------------------------------

final intakeQueueProvider =
    FutureProvider.autoDispose<List<IntakeCaseItem>>((ref) {
  return ref.watch(processingRepositoryProvider).intakeQueue();
});

final processingOfficersProvider =
    FutureProvider.autoDispose<List<ProcessingOfficer>>((ref) {
  return ref.watch(processingRepositoryProvider).officers();
});

// --- Per-case providers (keyed by caseId) ---------------------------------

final caseDetailProvider = FutureProvider.autoDispose
    .family<ProcessingCaseDetail, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).getCase(caseId);
});

final caseDocumentsProvider = FutureProvider.autoDispose
    .family<List<CaseDocumentItem>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseDocuments(caseId);
});

final caseNotesProvider = FutureProvider.autoDispose
    .family<List<ProcessingNote>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseNotes(caseId);
});

final caseTasksProvider = FutureProvider.autoDispose
    .family<List<ProcessingTask>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseTasks(caseId);
});

final caseCommunicationsProvider = FutureProvider.autoDispose
    .family<List<CaseCommunication>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseCommunications(caseId);
});

final caseAuditProvider = FutureProvider.autoDispose
    .family<List<CaseAuditLog>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseAudit(caseId);
});

final caseBackgroundProvider = FutureProvider.autoDispose
    .family<CaseBackground, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseBackground(caseId);
});

final caseIdentityProvider = FutureProvider.autoDispose
    .family<IdentityReconciliation, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).identityReconciliation(caseId);
});

final submissionReadinessProvider = FutureProvider.autoDispose
    .family<SubmissionReadiness, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).submissionReadiness(caseId);
});

final submissionPackageProvider = FutureProvider.autoDispose
    .family<SubmissionPackage, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).submissionPackage(caseId);
});

final caseCorrectionsProvider = FutureProvider.autoDispose
    .family<List<CaseCorrection>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseCorrections(caseId);
});

final caseSubmissionsProvider = FutureProvider.autoDispose
    .family<List<CaseSubmission>, String>((ref, caseId) {
  return ref.watch(processingRepositoryProvider).caseSubmissions(caseId);
});

// --- Refund / escalation lane (shell-level) -------------------------------

final refundsQueueProvider =
    FutureProvider.autoDispose<List<RefundCaseItem>>((ref) {
  return ref.watch(processingRepositoryProvider).refundsQueue();
});

// Domain models for the Processing department portal. Mirror the shapes in
// apps/frontend/lib/processing.ts (the web type contract) so the mobile client
// reads exactly what the backend emits. Lenient `fromJson` via core/util/parsers
// so a missing/wrong-typed field degrades gracefully instead of blanking a screen.
library;

import '../../../core/util/parsers.dart';

// ---------------------------------------------------------------------------
// Enums (kept as Strings — the backend sends the canonical SCREAMING_SNAKE
// values; we render via the label maps below).
// ---------------------------------------------------------------------------

/// Human label for a ProcessingStage code (mirrors web STAGE_LABEL).
const Map<String, String> kStageLabel = {
  'INTAKE_PENDING': 'Intake Pending',
  'DOCUMENTS_COLLECTION': 'Collecting Documents',
  'DOCUMENTS_UNDER_REVIEW': 'Under Review',
  'DOCUMENTS_INCOMPLETE': 'Documents Incomplete',
  'DOCUMENTS_COMPLETE': 'Documents Complete',
  'READY_FOR_SUBMISSION': 'Ready to Submit',
  'SUBMITTED': 'Submitted',
  'UNDER_AUTHORITY_REVIEW': 'With Authority',
  'ADDITIONAL_INFO_REQUESTED': 'Info Requested',
  'DECISION_RECEIVED': 'Decision Received',
  'APPROVED': 'Approved',
  'REJECTED': 'Rejected',
  'APPEAL_IN_PROGRESS': 'Appeal Filed',
  'COMPLETED': 'Completed',
  'CANCELLED': 'Cancelled',
};

String stageLabel(String code) => kStageLabel[code] ?? code.replaceAll('_', ' ');

const Map<String, String> kPriorityLabel = {
  'CRITICAL': 'Critical',
  'URGENT': 'Urgent',
  'NORMAL': 'Normal',
  'LOW': 'Low',
};

String priorityLabel(String code) => kPriorityLabel[code] ?? code;

/// Allowed stage transitions — mirrors the backend ALLOWED_TRANSITIONS and the
/// web StageChangeModal so the bottom sheet only offers legal next stages.
const Map<String, List<String>> kAllowedTransitions = {
  'INTAKE_PENDING': ['DOCUMENTS_COLLECTION'],
  'DOCUMENTS_COLLECTION': ['DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_INCOMPLETE'],
  'DOCUMENTS_UNDER_REVIEW': ['DOCUMENTS_COMPLETE', 'DOCUMENTS_INCOMPLETE'],
  'DOCUMENTS_INCOMPLETE': ['DOCUMENTS_COLLECTION'],
  'DOCUMENTS_COMPLETE': ['READY_FOR_SUBMISSION'],
  'READY_FOR_SUBMISSION': ['SUBMITTED'],
  'SUBMITTED': ['UNDER_AUTHORITY_REVIEW', 'ADDITIONAL_INFO_REQUESTED'],
  'UNDER_AUTHORITY_REVIEW': ['DECISION_RECEIVED', 'ADDITIONAL_INFO_REQUESTED'],
  'ADDITIONAL_INFO_REQUESTED': ['UNDER_AUTHORITY_REVIEW', 'DOCUMENTS_COLLECTION'],
  'DECISION_RECEIVED': ['APPROVED', 'REJECTED'],
  'APPROVED': ['COMPLETED'],
  'REJECTED': ['APPEAL_IN_PROGRESS', 'CANCELLED'],
  'APPEAL_IN_PROGRESS': ['SUBMITTED', 'CANCELLED'],
  'COMPLETED': <String>[],
  'CANCELLED': <String>[],
};

/// Target stages that trigger the server-side submission-readiness quality gate.
const Set<String> kSubmissionGateStages = {'READY_FOR_SUBMISSION', 'SUBMITTED'};

/// Canonical service-type codes → labels (mirrors web service-types.ts). Used by
/// the intake acknowledge sheet's category picker.
const List<MapEntry<String, String>> kServiceTypes = [
  MapEntry('STUDY_VISA', 'Study Visa'),
  MapEntry('WORK_PERMIT', 'Work Permit (WP)'),
  MapEntry('PR_CASE', 'Permanent Residency (PR)'),
  MapEntry('VISIT_VISA', 'Visit Visa'),
  MapEntry('TOURIST_VISA', 'Tourist Visa'),
  MapEntry('SPOUSE_VISA', 'Spouse Visa'),
  MapEntry('E2_VISA', 'E2 Visa'),
  MapEntry('CBI', 'Citizenship by Investment'),
  MapEntry('JR_RESUBMISSION', 'JR Resubmission'),
];

String labelForServiceCode(String? value) {
  if (value == null || value.trim().isEmpty) return '—';
  for (final e in kServiceTypes) {
    if (e.key == value) return e.value;
  }
  return value;
}

bool isCanonicalServiceCode(String? value) {
  if (value == null) return false;
  return kServiceTypes.any((e) => e.key == value);
}

const Map<String, String> kDocStatusLabel = {
  'NOT_SUBMITTED': 'Not submitted',
  'SUBMITTED': 'Uploaded — pending review',
  'UNDER_REVIEW': 'Under review',
  'ACCEPTED': 'Accepted',
  'REJECTED': 'Rejected',
  'EXPIRED': 'Expired',
  'EXPIRING_SOON': 'Expiring soon',
  'WAIVED': 'Waived',
  'NOT_APPLICABLE': 'N/A',
  'REQUESTED': 'Requested',
  'AWAITING_UPLOAD': 'Awaiting upload',
  'UPLOADED': 'Uploaded',
};

String docStatusLabel(String code) => kDocStatusLabel[code] ?? code.replaceAll('_', ' ');

/// Rejection reason codes the document-review sheet offers (mirrors web).
const Map<String, String> kRejectionReasonLabel = {
  'ILLEGIBLE': 'Blurry or unreadable',
  'WRONG_DOCUMENT': 'Incorrect document type',
  'EXPIRED': 'Document expired',
  'DETAILS_MISMATCH': 'Name/date/ID mismatch',
  'INCOMPLETE': 'Missing pages',
  'POOR_SCAN_QUALITY': 'Scan quality too low',
  'SIGNATURE_MISSING': 'Signature absent',
  'TRANSLATION_REQUIRED': 'Translation required',
  'CERTIFIED_COPY_REQUIRED': 'Certified copy required',
  'FORMAT_NOT_ACCEPTED': 'Format not accepted',
  'WRONG_DATE_RANGE': 'Wrong validity period',
  'OTHER': 'Other',
};

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------

class ProcessingDashboardMetrics {
  final int activeCases;
  final int awaitingReview;
  final int readyToSubmit;
  final int newIntake;
  final int myPendingDocs;
  final int myClientFollowUp;
  final int myApproved;
  final int myRefused;

  const ProcessingDashboardMetrics({
    required this.activeCases,
    required this.awaitingReview,
    required this.readyToSubmit,
    required this.newIntake,
    required this.myPendingDocs,
    required this.myClientFollowUp,
    required this.myApproved,
    required this.myRefused,
  });

  factory ProcessingDashboardMetrics.fromJson(Map<String, dynamic> j) =>
      ProcessingDashboardMetrics(
        activeCases: asInt(j['activeCases']),
        awaitingReview: asInt(j['awaitingReview']),
        readyToSubmit: asInt(j['readyToSubmit']),
        newIntake: asInt(j['newIntake']),
        myPendingDocs: asInt(j['myPendingDocs']),
        myClientFollowUp: asInt(j['myClientFollowUp']),
        myApproved: asInt(j['myApproved']),
        myRefused: asInt(j['myRefused']),
      );
}

// ---------------------------------------------------------------------------
// Case list item
// ---------------------------------------------------------------------------

class CasePerson {
  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final String? email;

  const CasePerson({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.email,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory CasePerson.fromJson(Map<String, dynamic> j) => CasePerson(
        id: j['id'] as String? ?? '',
        firstName: j['firstName'] as String? ?? '',
        lastName: j['lastName'] as String? ?? '',
        phone: j['phone'] as String? ?? '',
        email: asStringOrNull(j['email']),
      );
}

class CaseOfficer {
  final String id;
  final String email;
  final String? name;

  const CaseOfficer({required this.id, required this.email, this.name});

  /// Best-effort display: explicit name, else the email local-part.
  String get display {
    final n = name?.trim() ?? '';
    if (n.isNotEmpty) return n;
    final at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : email;
  }

  factory CaseOfficer.fromJson(Map<String, dynamic> j) => CaseOfficer(
        id: j['id'] as String? ?? '',
        email: j['email'] as String? ?? '',
        name: asStringOrNull(j['name']),
      );
}

class CaseDocProgress {
  final int total;
  final int verified;
  final int rejected;
  final int criticalMissing;

  const CaseDocProgress({
    this.total = 0,
    this.verified = 0,
    this.rejected = 0,
    this.criticalMissing = 0,
  });

  factory CaseDocProgress.fromJson(Map<String, dynamic> j) => CaseDocProgress(
        total: asInt(j['total']),
        verified: asInt(j['verified']),
        rejected: asInt(j['rejected']),
        criticalMissing: asInt(j['criticalMissing']),
      );
}

class ProcessingCaseListItem {
  final String id;
  final String service;
  final String targetCountry;
  final String stage;
  final String priority;
  final String authorityDecision;
  final DateTime? slaDueAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final CasePerson? lead;
  final CasePerson? client;
  final CaseOfficer? assignedOfficer;
  final int documentCount;
  final CaseDocProgress docProgress;

  const ProcessingCaseListItem({
    required this.id,
    required this.service,
    required this.targetCountry,
    required this.stage,
    required this.priority,
    required this.authorityDecision,
    this.slaDueAt,
    required this.createdAt,
    required this.updatedAt,
    this.completedAt,
    this.lead,
    this.client,
    this.assignedOfficer,
    this.documentCount = 0,
    this.docProgress = const CaseDocProgress(),
  });

  String get personName {
    final c = client;
    if (c != null && c.fullName.isNotEmpty) return c.fullName;
    final l = lead;
    if (l != null && l.fullName.isNotEmpty) return l.fullName;
    return 'Unknown';
  }

  String get personPhone => client?.phone.isNotEmpty == true
      ? client!.phone
      : (lead?.phone ?? '');

  bool get isTerminal => stage == 'COMPLETED' || stage == 'CANCELLED';

  factory ProcessingCaseListItem.fromJson(Map<String, dynamic> j) {
    final count = j['_count'];
    return ProcessingCaseListItem(
      id: j['id'] as String? ?? '',
      service: j['service'] as String? ?? '',
      targetCountry: j['targetCountry'] as String? ?? '',
      stage: j['stage'] as String? ?? 'INTAKE_PENDING',
      priority: j['priority'] as String? ?? 'NORMAL',
      authorityDecision: j['authorityDecision'] as String? ?? 'PENDING',
      slaDueAt: parseApiDateOrNull(j['slaDueAt']),
      createdAt: parseApiDate(j['createdAt']),
      updatedAt: parseApiDate(j['updatedAt']),
      completedAt: parseApiDateOrNull(j['completedAt']),
      lead: j['lead'] is Map<String, dynamic>
          ? CasePerson.fromJson(j['lead'] as Map<String, dynamic>)
          : null,
      client: j['client'] is Map<String, dynamic>
          ? CasePerson.fromJson(j['client'] as Map<String, dynamic>)
          : null,
      assignedOfficer: j['assignedOfficer'] is Map<String, dynamic>
          ? CaseOfficer.fromJson(j['assignedOfficer'] as Map<String, dynamic>)
          : null,
      documentCount:
          count is Map<String, dynamic> ? asInt(count['documentItems']) : 0,
      docProgress: j['docProgress'] is Map<String, dynamic>
          ? CaseDocProgress.fromJson(j['docProgress'] as Map<String, dynamic>)
          : const CaseDocProgress(),
    );
  }
}

class ListCasesResult {
  final List<ProcessingCaseListItem> cases;
  final int total;
  final int page;
  final int limit;

  const ListCasesResult({
    required this.cases,
    required this.total,
    required this.page,
    required this.limit,
  });
}

// ---------------------------------------------------------------------------
// Case detail
// ---------------------------------------------------------------------------

class FinanceHandoverSnapshot {
  final String id;
  final num submittedAmount;
  final String currency;
  final String? receiptFileName;
  final DateTime? submittedAt;

  const FinanceHandoverSnapshot({
    required this.id,
    required this.submittedAmount,
    required this.currency,
    this.receiptFileName,
    this.submittedAt,
  });

  factory FinanceHandoverSnapshot.fromJson(Map<String, dynamic> j) =>
      FinanceHandoverSnapshot(
        id: j['id'] as String? ?? '',
        submittedAmount: asDouble(j['submittedAmount']),
        currency: j['currency'] as String? ?? 'CAD',
        receiptFileName: asStringOrNull(j['receiptFileName']),
        submittedAt: parseApiDateOrNull(j['submittedAt']),
      );
}

class StageHistoryEntry {
  final String id;
  final String? fromStage;
  final String toStage;
  final String? reason;
  final DateTime createdAt;

  const StageHistoryEntry({
    required this.id,
    this.fromStage,
    required this.toStage,
    this.reason,
    required this.createdAt,
  });

  factory StageHistoryEntry.fromJson(Map<String, dynamic> j) =>
      StageHistoryEntry(
        id: j['id'] as String? ?? '',
        fromStage: asStringOrNull(j['fromStage']),
        toStage: j['toStage'] as String? ?? '',
        reason: asStringOrNull(j['reason']),
        createdAt: parseApiDate(j['createdAt']),
      );
}

class ProcessingCaseDetail {
  final String id;
  final String? assignedOfficerId;
  final String priority;
  final String stage;
  final String service;
  final String targetCountry;
  final String? financeHandoverNote;
  final String? processingNote;
  final DateTime? slaDueAt;
  final String authorityDecision;
  final DateTime createdAt;
  final DateTime updatedAt;
  final CasePerson? lead;
  final CasePerson? client;
  final CaseOfficer? assignedOfficer;
  final FinanceHandoverSnapshot? financeHandover;
  final List<StageHistoryEntry> stageHistory;
  final int documentCount;
  final int taskCount;
  final int noteCount;
  // P4e — submission package
  final String? submissionPackageKey;

  const ProcessingCaseDetail({
    required this.id,
    this.assignedOfficerId,
    required this.priority,
    required this.stage,
    required this.service,
    required this.targetCountry,
    this.financeHandoverNote,
    this.processingNote,
    this.slaDueAt,
    required this.authorityDecision,
    required this.createdAt,
    required this.updatedAt,
    this.lead,
    this.client,
    this.assignedOfficer,
    this.financeHandover,
    this.stageHistory = const [],
    this.documentCount = 0,
    this.taskCount = 0,
    this.noteCount = 0,
    this.submissionPackageKey,
  });

  String get personName {
    final c = client;
    if (c != null && c.fullName.isNotEmpty) return c.fullName;
    final l = lead;
    if (l != null && l.fullName.isNotEmpty) return l.fullName;
    return 'Unknown';
  }

  String get personPhone => client?.phone.isNotEmpty == true
      ? client!.phone
      : (lead?.phone ?? '');

  /// Days since the case last moved stage (approx via updatedAt — matches web).
  int get daysInCurrentStage {
    final ms = DateTime.now().difference(updatedAt).inMilliseconds;
    return ms < 0 ? 0 : (ms ~/ const Duration(days: 1).inMilliseconds);
  }

  bool get isTerminal => stage == 'COMPLETED' || stage == 'CANCELLED';

  factory ProcessingCaseDetail.fromJson(Map<String, dynamic> j) {
    final count = j['_count'];
    return ProcessingCaseDetail(
      id: j['id'] as String? ?? '',
      assignedOfficerId: asStringOrNull(j['assignedOfficerId']),
      priority: j['priority'] as String? ?? 'NORMAL',
      stage: j['stage'] as String? ?? 'INTAKE_PENDING',
      service: j['service'] as String? ?? '',
      targetCountry: j['targetCountry'] as String? ?? '',
      financeHandoverNote: asStringOrNull(j['financeHandoverNote']),
      processingNote: asStringOrNull(j['processingNote']),
      slaDueAt: parseApiDateOrNull(j['slaDueAt']),
      authorityDecision: j['authorityDecision'] as String? ?? 'PENDING',
      createdAt: parseApiDate(j['createdAt']),
      updatedAt: parseApiDate(j['updatedAt']),
      lead: j['lead'] is Map<String, dynamic>
          ? CasePerson.fromJson(j['lead'] as Map<String, dynamic>)
          : null,
      client: j['client'] is Map<String, dynamic>
          ? CasePerson.fromJson(j['client'] as Map<String, dynamic>)
          : null,
      assignedOfficer: j['assignedOfficer'] is Map<String, dynamic>
          ? CaseOfficer.fromJson(j['assignedOfficer'] as Map<String, dynamic>)
          : null,
      financeHandover: j['financeHandover'] is Map<String, dynamic>
          ? FinanceHandoverSnapshot.fromJson(
              j['financeHandover'] as Map<String, dynamic>)
          : null,
      stageHistory: (j['stageHistory'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(StageHistoryEntry.fromJson)
          .toList(),
      documentCount:
          count is Map<String, dynamic> ? asInt(count['documentItems']) : 0,
      taskCount: count is Map<String, dynamic> ? asInt(count['tasks']) : 0,
      noteCount: count is Map<String, dynamic> ? asInt(count['notes']) : 0,
      submissionPackageKey: asStringOrNull(j['submissionPackageKey']),
    );
  }
}

// ---------------------------------------------------------------------------
// Officer roster (manager picker)
// ---------------------------------------------------------------------------

class ProcessingOfficer {
  final String id;
  final String email;
  final String name;
  final String primaryRole;

  const ProcessingOfficer({
    required this.id,
    required this.email,
    required this.name,
    required this.primaryRole,
  });

  factory ProcessingOfficer.fromJson(Map<String, dynamic> j) =>
      ProcessingOfficer(
        id: j['id'] as String? ?? '',
        email: j['email'] as String? ?? '',
        name: (j['name'] as String?)?.trim().isNotEmpty == true
            ? j['name'] as String
            : (j['email'] as String? ?? ''),
        primaryRole: j['primaryRole'] as String? ?? 'processing',
      );
}

// ---------------------------------------------------------------------------
// Intake queue
// ---------------------------------------------------------------------------

class IntakeCaseItem {
  final ProcessingCaseListItem base;
  final FinanceHandoverSnapshot? financeHandover;
  final String? financeHandoverNote;

  const IntakeCaseItem({
    required this.base,
    this.financeHandover,
    this.financeHandoverNote,
  });

  factory IntakeCaseItem.fromJson(Map<String, dynamic> j) => IntakeCaseItem(
        base: ProcessingCaseListItem.fromJson(j),
        financeHandover: j['financeHandover'] is Map<String, dynamic>
            ? FinanceHandoverSnapshot.fromJson(
                j['financeHandover'] as Map<String, dynamic>)
            : null,
        financeHandoverNote: asStringOrNull(j['financeHandoverNote']),
      );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

class DocumentVersionLite {
  final String id;
  final String fileName;
  final int? fileSizeBytes;
  final int versionNumber;
  final DateTime? uploadedAt;

  const DocumentVersionLite({
    required this.id,
    required this.fileName,
    this.fileSizeBytes,
    required this.versionNumber,
    this.uploadedAt,
  });

  factory DocumentVersionLite.fromJson(Map<String, dynamic> j) =>
      DocumentVersionLite(
        id: j['id'] as String? ?? '',
        fileName: j['fileName'] as String? ?? '',
        fileSizeBytes: j['fileSizeBytes'] == null ? null : asInt(j['fileSizeBytes']),
        versionNumber: asInt(j['versionNumber'], 1),
        uploadedAt: parseApiDateOrNull(j['uploadedAt']),
      );
}

class AiAssessmentLite {
  final String suggestedDecision; // APPROVE | REJECT | NEEDS_REVIEW
  final double? confidence;
  final String? detectedDocType;
  final String? detectedLanguage;
  final bool autoApproved;
  final String? errorMessage;

  const AiAssessmentLite({
    required this.suggestedDecision,
    this.confidence,
    this.detectedDocType,
    this.detectedLanguage,
    this.autoApproved = false,
    this.errorMessage,
  });

  factory AiAssessmentLite.fromJson(Map<String, dynamic> j) => AiAssessmentLite(
        suggestedDecision: j['suggestedDecision'] as String? ?? 'NEEDS_REVIEW',
        confidence: j['confidence'] == null ? null : asDouble(j['confidence']),
        detectedDocType: asStringOrNull(j['detectedDocType']),
        detectedLanguage: asStringOrNull(j['detectedLanguage']),
        autoApproved: j['autoApproved'] as bool? ?? false,
        errorMessage: asStringOrNull(j['errorMessage']),
      );
}

class CaseDocumentItem {
  final String id;
  final String caseId;
  final String documentName;
  final String? description;
  final String criticality;
  final List<String> expectedFormats;
  final String status;
  final DateTime? validityExpiryDate;
  final DateTime updatedAt;
  final DocumentVersionLite? latestVersion;
  final List<AiAssessmentLite> aiAssessments;

  const CaseDocumentItem({
    required this.id,
    required this.caseId,
    required this.documentName,
    this.description,
    required this.criticality,
    this.expectedFormats = const [],
    required this.status,
    this.validityExpiryDate,
    required this.updatedAt,
    this.latestVersion,
    this.aiAssessments = const [],
  });

  bool get hasFile => latestVersion != null;

  bool get canReview =>
      hasFile &&
      (status == 'SUBMITTED' || status == 'UPLOADED' || status == 'UNDER_REVIEW');

  bool get canRequest =>
      !hasFile && (status == 'NOT_SUBMITTED' || status == 'AWAITING_UPLOAD');

  bool get canWaive =>
      status != 'ACCEPTED' && status != 'WAIVED' && status != 'NOT_APPLICABLE';

  bool get canUpload =>
      status != 'ACCEPTED' && status != 'WAIVED' && status != 'NOT_APPLICABLE';

  factory CaseDocumentItem.fromJson(Map<String, dynamic> j) => CaseDocumentItem(
        id: j['id'] as String? ?? '',
        caseId: j['caseId'] as String? ?? '',
        documentName: j['documentName'] as String? ?? 'Document',
        description: asStringOrNull(j['description']),
        criticality: j['criticality'] as String? ?? 'REQUIRED',
        expectedFormats: (j['expectedFormats'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        status: j['status'] as String? ?? 'NOT_SUBMITTED',
        validityExpiryDate: parseApiDateOrNull(j['validityExpiryDate']),
        updatedAt: parseApiDate(j['updatedAt']),
        latestVersion: j['latestVersion'] is Map<String, dynamic>
            ? DocumentVersionLite.fromJson(
                j['latestVersion'] as Map<String, dynamic>)
            : null,
        aiAssessments: (j['aiAssessments'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(AiAssessmentLite.fromJson)
            .toList(),
      );
}

// ---------------------------------------------------------------------------
// Cross-case aggregated rows
// ---------------------------------------------------------------------------

/// Slim case context attached to aggregated task/document rows.
class AggregatedCaseRef {
  final String id;
  final String service;
  final String targetCountry;
  final String priority;
  final String stage;
  final CasePerson? lead;
  final CasePerson? client;

  const AggregatedCaseRef({
    required this.id,
    required this.service,
    required this.targetCountry,
    required this.priority,
    required this.stage,
    this.lead,
    this.client,
  });

  String get personName {
    final c = client;
    if (c != null && c.fullName.isNotEmpty) return c.fullName;
    final l = lead;
    if (l != null && l.fullName.isNotEmpty) return l.fullName;
    return 'Unnamed';
  }

  factory AggregatedCaseRef.fromJson(Map<String, dynamic> j) => AggregatedCaseRef(
        id: j['id'] as String? ?? '',
        service: j['service'] as String? ?? '',
        targetCountry: j['targetCountry'] as String? ?? '',
        priority: j['priority'] as String? ?? 'NORMAL',
        stage: j['stage'] as String? ?? 'INTAKE_PENDING',
        lead: j['lead'] is Map<String, dynamic>
            ? CasePerson.fromJson(j['lead'] as Map<String, dynamic>)
            : null,
        client: j['client'] is Map<String, dynamic>
            ? CasePerson.fromJson(j['client'] as Map<String, dynamic>)
            : null,
      );
}

class AggregatedDocument {
  final String id;
  final String caseId;
  final String documentName;
  final String? description;
  final String criticality;
  final String status;
  final DateTime? validityExpiryDate;
  final AggregatedCaseRef caseRef;

  const AggregatedDocument({
    required this.id,
    required this.caseId,
    required this.documentName,
    this.description,
    required this.criticality,
    required this.status,
    this.validityExpiryDate,
    required this.caseRef,
  });

  factory AggregatedDocument.fromJson(Map<String, dynamic> j) =>
      AggregatedDocument(
        id: j['id'] as String? ?? '',
        caseId: j['caseId'] as String? ?? '',
        documentName: j['documentName'] as String? ?? 'Document',
        description: asStringOrNull(j['description']),
        criticality: j['criticality'] as String? ?? 'REQUIRED',
        status: j['status'] as String? ?? 'NOT_SUBMITTED',
        validityExpiryDate: parseApiDateOrNull(j['validityExpiryDate']),
        caseRef: AggregatedCaseRef.fromJson(
            (j['case'] as Map<String, dynamic>?) ?? const {}),
      );
}

class AggregatedTask {
  final ProcessingTask task;
  final AggregatedCaseRef caseRef;

  const AggregatedTask({required this.task, required this.caseRef});

  factory AggregatedTask.fromJson(Map<String, dynamic> j) => AggregatedTask(
        task: ProcessingTask.fromJson(j),
        caseRef: AggregatedCaseRef.fromJson(
            (j['case'] as Map<String, dynamic>?) ?? const {}),
      );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const Map<String, String> kNoteTypeLabel = {
  'GENERAL': 'General',
  'ESCALATION': 'Escalation',
  'STRATEGY': 'Strategy',
  'CLIENT_INSIGHT': 'Client insight',
  'AUTHORITY_NOTE': 'Authority note',
  'MANAGER_ONLY': 'Manager only',
};

class ProcessingNote {
  final String id;
  final String content;
  final String noteType;
  final bool isPinned;
  final DateTime createdAt;
  final CaseOfficer? createdBy;

  const ProcessingNote({
    required this.id,
    required this.content,
    required this.noteType,
    required this.isPinned,
    required this.createdAt,
    this.createdBy,
  });

  factory ProcessingNote.fromJson(Map<String, dynamic> j) => ProcessingNote(
        id: j['id'] as String? ?? '',
        content: j['content'] as String? ?? '',
        noteType: j['noteType'] as String? ?? 'GENERAL',
        isPinned: j['isPinned'] as bool? ?? false,
        createdAt: parseApiDate(j['createdAt']),
        createdBy: j['createdBy'] is Map<String, dynamic>
            ? CaseOfficer.fromJson(j['createdBy'] as Map<String, dynamic>)
            : null,
      );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

class ProcessingTask {
  final String id;
  final String caseId;
  final String title;
  final String? description;
  final DateTime? dueDate;
  final String priority; // LOW | NORMAL | HIGH | URGENT
  final String status; // OPEN | IN_PROGRESS | BLOCKED | DONE | CANCELLED
  final CaseOfficer? assignedTo;

  const ProcessingTask({
    required this.id,
    required this.caseId,
    required this.title,
    this.description,
    this.dueDate,
    required this.priority,
    required this.status,
    this.assignedTo,
  });

  ProcessingTask copyWith({String? status}) => ProcessingTask(
        id: id,
        caseId: caseId,
        title: title,
        description: description,
        dueDate: dueDate,
        priority: priority,
        status: status ?? this.status,
        assignedTo: assignedTo,
      );

  factory ProcessingTask.fromJson(Map<String, dynamic> j) => ProcessingTask(
        id: j['id'] as String? ?? '',
        caseId: j['caseId'] as String? ?? '',
        title: j['title'] as String? ?? '',
        description: asStringOrNull(j['description']),
        dueDate: parseApiDateOrNull(j['dueDate']),
        priority: j['priority'] as String? ?? 'NORMAL',
        status: j['status'] as String? ?? 'OPEN',
        assignedTo: j['assignedTo'] is Map<String, dynamic>
            ? CaseOfficer.fromJson(j['assignedTo'] as Map<String, dynamic>)
            : null,
      );
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

class CaseCommunication {
  final String id;
  final String direction; // OUTBOUND | INBOUND
  final String? subject;
  final String content;
  final List<String> channelsSent;
  final DateTime createdAt;
  final CaseOfficer? sentBy;

  const CaseCommunication({
    required this.id,
    required this.direction,
    this.subject,
    required this.content,
    this.channelsSent = const [],
    required this.createdAt,
    this.sentBy,
  });

  bool get isInbound => direction == 'INBOUND';

  factory CaseCommunication.fromJson(Map<String, dynamic> j) => CaseCommunication(
        id: j['id'] as String? ?? '',
        direction: j['direction'] as String? ?? 'OUTBOUND',
        subject: asStringOrNull(j['subject']),
        content: j['content'] as String? ?? '',
        channelsSent: (j['channelsSent'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        createdAt: parseApiDate(j['createdAt']),
        sentBy: j['sentBy'] is Map<String, dynamic>
            ? CaseOfficer.fromJson(j['sentBy'] as Map<String, dynamic>)
            : null,
      );
}

class SendCommunicationResult {
  final CaseCommunication communication;
  final List<String> deliveryWarnings;

  const SendCommunicationResult({
    required this.communication,
    this.deliveryWarnings = const [],
  });

  factory SendCommunicationResult.fromJson(Map<String, dynamic> j) =>
      SendCommunicationResult(
        communication: CaseCommunication.fromJson(j),
        deliveryWarnings: (j['deliveryWarnings'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
      );
}

// ---------------------------------------------------------------------------
// Audit / Timeline
// ---------------------------------------------------------------------------

class CaseAuditLog {
  final String id;
  final String action;
  final String? fromValue;
  final String? toValue;
  final DateTime createdAt;
  final CaseOfficer? performedBy;

  const CaseAuditLog({
    required this.id,
    required this.action,
    this.fromValue,
    this.toValue,
    required this.createdAt,
    this.performedBy,
  });

  factory CaseAuditLog.fromJson(Map<String, dynamic> j) => CaseAuditLog(
        id: j['id'] as String? ?? '',
        action: j['action'] as String? ?? '',
        fromValue: asStringOrNull(j['fromValue']),
        toValue: asStringOrNull(j['toValue']),
        createdAt: parseApiDate(j['createdAt']),
        performedBy: j['performedBy'] is Map<String, dynamic>
            ? CaseOfficer.fromJson(j['performedBy'] as Map<String, dynamic>)
            : null,
      );
}

// ---------------------------------------------------------------------------
// Cross-department background (History tab, read-only)
// ---------------------------------------------------------------------------

class CrossDeptNote {
  final String source;
  final String label;
  final String text;
  final String? author;
  final DateTime? at;

  const CrossDeptNote({
    required this.source,
    required this.label,
    required this.text,
    this.author,
    this.at,
  });

  factory CrossDeptNote.fromJson(Map<String, dynamic> j) => CrossDeptNote(
        source: j['source'] as String? ?? '',
        label: j['label'] as String? ?? '',
        text: j['text'] as String? ?? '',
        author: asStringOrNull(j['author']),
        at: parseApiDateOrNull(j['at']),
      );
}

class CaseCall {
  final String id;
  final String direction;
  final String status;
  final int? durationSeconds;
  final DateTime at;
  final String? rep;
  final String? transcript;
  final String? transcriptStatus;
  final bool hasRecording;

  const CaseCall({
    required this.id,
    required this.direction,
    required this.status,
    this.durationSeconds,
    required this.at,
    this.rep,
    this.transcript,
    this.transcriptStatus,
    this.hasRecording = false,
  });

  factory CaseCall.fromJson(Map<String, dynamic> j) => CaseCall(
        id: j['id'] as String? ?? '',
        direction: j['direction'] as String? ?? 'INBOUND',
        status: j['status'] as String? ?? 'ENDED',
        durationSeconds:
            j['durationSeconds'] == null ? null : asInt(j['durationSeconds']),
        at: parseApiDate(j['at']),
        rep: asStringOrNull(j['rep']),
        transcript: asStringOrNull(j['transcript']),
        transcriptStatus: asStringOrNull(j['transcriptStatus']),
        hasRecording: j['hasRecording'] as bool? ?? false,
      );
}

class CaseBackground {
  final List<CrossDeptNote> salesNotes;
  final List<CrossDeptNote> financeNotes;
  final List<CaseCall> calls;

  const CaseBackground({
    this.salesNotes = const [],
    this.financeNotes = const [],
    this.calls = const [],
  });

  factory CaseBackground.fromJson(Map<String, dynamic> j) => CaseBackground(
        salesNotes: (j['salesNotes'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CrossDeptNote.fromJson)
            .toList(),
        financeNotes: (j['financeNotes'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CrossDeptNote.fromJson)
            .toList(),
        calls: (j['calls'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CaseCall.fromJson)
            .toList(),
      );
}

// ---------------------------------------------------------------------------
// Identity reconciliation (read panel)
// ---------------------------------------------------------------------------

class IdentitySource {
  final String itemId;
  final String documentName;
  final String value;
  final bool matchesReference;

  const IdentitySource({
    required this.itemId,
    required this.documentName,
    required this.value,
    required this.matchesReference,
  });

  factory IdentitySource.fromJson(Map<String, dynamic> j) => IdentitySource(
        itemId: j['itemId'] as String? ?? '',
        documentName: j['documentName'] as String? ?? '',
        value: j['value'] as String? ?? '',
        matchesReference: j['matchesReference'] as bool? ?? false,
      );
}

class IdentityFieldRow {
  final String key;
  final String label;
  final String? crmValue;
  final bool? crmMatches;
  final String? referenceValue;
  final List<IdentitySource> sources;
  final String status; // agree | conflict | insufficient

  const IdentityFieldRow({
    required this.key,
    required this.label,
    this.crmValue,
    this.crmMatches,
    this.referenceValue,
    this.sources = const [],
    required this.status,
  });

  factory IdentityFieldRow.fromJson(Map<String, dynamic> j) => IdentityFieldRow(
        key: j['key'] as String? ?? '',
        label: j['label'] as String? ?? '',
        crmValue: asStringOrNull(j['crmValue']),
        crmMatches: j['crmMatches'] as bool?,
        referenceValue: asStringOrNull(j['referenceValue']),
        sources: (j['sources'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(IdentitySource.fromJson)
            .toList(),
        status: j['status'] as String? ?? 'insufficient',
      );
}

class IdentityReconciliation {
  final List<IdentityFieldRow> fields;
  final String overall; // ok | review | insufficient
  final int documentCount;
  final String? referenceFrom;
  final String? referenceDocumentName;

  const IdentityReconciliation({
    this.fields = const [],
    required this.overall,
    this.documentCount = 0,
    this.referenceFrom,
    this.referenceDocumentName,
  });

  factory IdentityReconciliation.fromJson(Map<String, dynamic> j) =>
      IdentityReconciliation(
        fields: (j['fields'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(IdentityFieldRow.fromJson)
            .toList(),
        overall: j['overall'] as String? ?? 'insufficient',
        documentCount: asInt(j['documentCount']),
        referenceFrom: asStringOrNull(j['referenceFrom']),
        referenceDocumentName: asStringOrNull(j['referenceDocumentName']),
      );
}

// ---------------------------------------------------------------------------
// Submission readiness + package
// ---------------------------------------------------------------------------

class SubmissionReadiness {
  final bool ready;
  final List<String> blockers;

  const SubmissionReadiness({required this.ready, this.blockers = const []});

  factory SubmissionReadiness.fromJson(Map<String, dynamic> j) =>
      SubmissionReadiness(
        ready: j['ready'] as bool? ?? false,
        blockers: (j['blockers'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
      );
}

class SubmissionPackage {
  final bool exists;
  final String? fileName;
  final int? sizeBytes;
  final int? documentCount;
  final DateTime? assembledAt;
  final String? signedUrl;

  const SubmissionPackage({
    required this.exists,
    this.fileName,
    this.sizeBytes,
    this.documentCount,
    this.assembledAt,
    this.signedUrl,
  });

  factory SubmissionPackage.fromJson(Map<String, dynamic> j) => SubmissionPackage(
        exists: j['exists'] as bool? ?? false,
        fileName: asStringOrNull(j['fileName']),
        sizeBytes: j['sizeBytes'] == null ? null : asInt(j['sizeBytes']),
        documentCount:
            j['documentCount'] == null ? null : asInt(j['documentCount']),
        assembledAt: parseApiDateOrNull(j['assembledAt']),
        signedUrl: asStringOrNull(j['signedUrl']),
      );
}

// ---------------------------------------------------------------------------
// Manager admin-overview dashboard
// ---------------------------------------------------------------------------

class AdminOverviewTotals {
  final int active;
  final int newIntake;
  final int slaBreached;
  final int unassigned;
  final int pendingDocuments;
  final int finalSubmissionPending;
  final int approved;
  final int refused;

  const AdminOverviewTotals({
    this.active = 0,
    this.newIntake = 0,
    this.slaBreached = 0,
    this.unassigned = 0,
    this.pendingDocuments = 0,
    this.finalSubmissionPending = 0,
    this.approved = 0,
    this.refused = 0,
  });

  factory AdminOverviewTotals.fromJson(Map<String, dynamic> j) =>
      AdminOverviewTotals(
        active: asInt(j['active']),
        newIntake: asInt(j['newIntake']),
        slaBreached: asInt(j['slaBreached']),
        unassigned: asInt(j['unassigned']),
        pendingDocuments: asInt(j['pendingDocuments']),
        finalSubmissionPending: asInt(j['finalSubmissionPending']),
        approved: asInt(j['approved']),
        refused: asInt(j['refused']),
      );
}

class OfficerWorkload {
  final String? officerId;
  final String name;
  final int activeCases;

  const OfficerWorkload({
    this.officerId,
    required this.name,
    required this.activeCases,
  });

  factory OfficerWorkload.fromJson(Map<String, dynamic> j) => OfficerWorkload(
        officerId: asStringOrNull(j['officerId']),
        name: j['name'] as String? ?? 'Unknown',
        activeCases: asInt(j['activeCases']),
      );
}

class StageBreakdownRow {
  final String stage;
  final int count;

  const StageBreakdownRow({required this.stage, required this.count});

  factory StageBreakdownRow.fromJson(Map<String, dynamic> j) => StageBreakdownRow(
        stage: j['stage'] as String? ?? '',
        count: asInt(j['count']),
      );
}

class ServiceCountRow {
  final String service;
  final int count;

  const ServiceCountRow({required this.service, required this.count});

  factory ServiceCountRow.fromJson(Map<String, dynamic> j) => ServiceCountRow(
        service: j['service'] as String? ?? '',
        count: asInt(j['count']),
      );
}

class BreachedCaseRow {
  final String id;
  final String stage;
  final String service;
  final String targetCountry;
  final DateTime? slaDueAt;
  final String? officerName;
  final String? clientName;

  const BreachedCaseRow({
    required this.id,
    required this.stage,
    required this.service,
    required this.targetCountry,
    this.slaDueAt,
    this.officerName,
    this.clientName,
  });

  factory BreachedCaseRow.fromJson(Map<String, dynamic> j) => BreachedCaseRow(
        id: j['id'] as String? ?? '',
        stage: j['stage'] as String? ?? '',
        service: j['service'] as String? ?? '',
        targetCountry: j['targetCountry'] as String? ?? '',
        slaDueAt: parseApiDateOrNull(j['slaDueAt']),
        officerName: asStringOrNull(j['officerName']),
        clientName: asStringOrNull(j['clientName']),
      );
}

class RecentIntakeRow {
  final String id;
  final String service;
  final String targetCountry;
  final String priority;
  final DateTime createdAt;
  final String? clientName;

  const RecentIntakeRow({
    required this.id,
    required this.service,
    required this.targetCountry,
    required this.priority,
    required this.createdAt,
    this.clientName,
  });

  factory RecentIntakeRow.fromJson(Map<String, dynamic> j) => RecentIntakeRow(
        id: j['id'] as String? ?? '',
        service: j['service'] as String? ?? '',
        targetCountry: j['targetCountry'] as String? ?? '',
        priority: j['priority'] as String? ?? 'NORMAL',
        createdAt: parseApiDate(j['createdAt']),
        clientName: asStringOrNull(j['clientName']),
      );
}

class AdminOverview {
  final AdminOverviewTotals totals;
  final List<ServiceCountRow> casesByType;
  final List<StageBreakdownRow> stageBreakdown;
  final List<OfficerWorkload> officerWorkload;
  final List<RecentIntakeRow> recentIntake;
  final List<BreachedCaseRow> breachedCases;

  const AdminOverview({
    required this.totals,
    this.casesByType = const [],
    this.stageBreakdown = const [],
    this.officerWorkload = const [],
    this.recentIntake = const [],
    this.breachedCases = const [],
  });

  factory AdminOverview.fromJson(Map<String, dynamic> j) => AdminOverview(
        totals: AdminOverviewTotals.fromJson(
            (j['totals'] as Map<String, dynamic>?) ?? const {}),
        casesByType: (j['casesByType'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ServiceCountRow.fromJson)
            .toList(),
        stageBreakdown: (j['stageBreakdown'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(StageBreakdownRow.fromJson)
            .toList(),
        officerWorkload: (j['officerWorkload'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(OfficerWorkload.fromJson)
            .toList(),
        recentIntake: (j['recentIntake'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(RecentIntakeRow.fromJson)
            .toList(),
        breachedCases: (j['breachedCases'] as List? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(BreachedCaseRow.fromJson)
            .toList(),
      );
}

// ---------------------------------------------------------------------------
// Correction requests (case-level Corrections tab)
// ---------------------------------------------------------------------------

/// Correction-request status → label (mirrors web CorrectionsTab STATUS_LABEL).
const Map<String, String> kCorrectionStatusLabel = {
  'SENT': 'Sent',
  'IN_PROGRESS': 'In progress',
  'RESOLVED': 'Resolved',
  'ESCALATED': 'Escalated',
};

/// Required-action codes the request sheet offers (mirrors web ACTION_LABEL).
const List<MapEntry<String, String>> kCorrectionRequiredActions = [
  MapEntry('REUPLOAD', 'Re-upload document'),
  MapEntry('CONFIRM', 'Confirm information'),
  MapEntry('CORRECT', 'Correct information'),
  MapEntry('CALL_BACK', 'Call back office'),
];

String correctionRequiredActionLabel(String code) {
  for (final e in kCorrectionRequiredActions) {
    if (e.key == code) return e.value;
  }
  return code.replaceAll('_', ' ');
}

/// Reason codes the correction sheet offers (mirrors web REASON_OPTIONS).
const List<MapEntry<String, String>> kCorrectionReasonCodes = [
  MapEntry('ILLEGIBLE', 'Document is blurry or unreadable'),
  MapEntry('WRONG_DOCUMENT', 'Incorrect document type uploaded'),
  MapEntry('EXPIRED', 'Document has passed its expiry date'),
  MapEntry('DETAILS_MISMATCH', 'Name, date, or ID number does not match'),
  MapEntry('INCOMPLETE', 'Document appears to be missing pages'),
  MapEntry('POOR_SCAN_QUALITY', 'Scan quality too low for official use'),
  MapEntry('SIGNATURE_MISSING', 'Required signature is absent'),
  MapEntry('TRANSLATION_REQUIRED', 'Document is in a non-accepted language'),
  MapEntry('CERTIFIED_COPY_REQUIRED', 'Original certified copy required'),
  MapEntry('FORMAT_NOT_ACCEPTED', 'File format not accepted by authority'),
  MapEntry('WRONG_DATE_RANGE', 'Document validity does not cover required period'),
  MapEntry('DATA_INCORRECT', 'Application data needs correction'),
  MapEntry('DATA_MISSING', 'Required information is missing'),
  MapEntry('CONFIRM_DETAILS', 'Client must confirm details'),
  MapEntry('OTHER', 'Other — described in message to client'),
];

class CaseCorrection {
  final String id;
  final String caseId;
  final String? documentItemId;
  final String correctionType; // DOCUMENT | INFORMATION
  final String status; // SENT | IN_PROGRESS | RESOLVED | ESCALATED
  final String subject;
  final List<String> reasonCodes;
  final String? officerNote;
  final String clientMessage;
  final String requiredAction;
  final int? slaHours;
  final String? resolutionNote;
  final String? escalationReason;
  final DateTime? resolvedAt;
  final DateTime createdAt;
  final CaseOfficer? raisedBy;

  const CaseCorrection({
    required this.id,
    required this.caseId,
    this.documentItemId,
    required this.correctionType,
    required this.status,
    required this.subject,
    this.reasonCodes = const [],
    this.officerNote,
    required this.clientMessage,
    required this.requiredAction,
    this.slaHours,
    this.resolutionNote,
    this.escalationReason,
    this.resolvedAt,
    required this.createdAt,
    this.raisedBy,
  });

  bool get isOpen => status == 'SENT' || status == 'IN_PROGRESS';
  bool get canEscalate => status != 'RESOLVED' && status != 'ESCALATED';

  factory CaseCorrection.fromJson(Map<String, dynamic> j) => CaseCorrection(
        id: j['id'] as String? ?? '',
        caseId: j['caseId'] as String? ?? '',
        documentItemId: asStringOrNull(j['documentItemId']),
        correctionType: j['correctionType'] as String? ?? 'INFORMATION',
        status: j['status'] as String? ?? 'SENT',
        subject: j['subject'] as String? ?? '',
        reasonCodes: (j['reasonCodes'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        officerNote: asStringOrNull(j['officerNote']),
        clientMessage: j['clientMessage'] as String? ?? '',
        requiredAction: j['requiredAction'] as String? ?? 'REUPLOAD',
        slaHours: j['slaHours'] == null ? null : asInt(j['slaHours']),
        resolutionNote: asStringOrNull(j['resolutionNote']),
        escalationReason: asStringOrNull(j['escalationReason']),
        resolvedAt: parseApiDateOrNull(j['resolvedAt']),
        createdAt: parseApiDate(j['createdAt']),
        raisedBy: j['raisedBy'] is Map<String, dynamic>
            ? CaseOfficer.fromJson(j['raisedBy'] as Map<String, dynamic>)
            : null,
      );
}

/// Resolved case WhatsApp thread pointer (the case endpoint returns threadId +
/// messages; the mobile WhatsApp tab only needs the threadId to reuse the
/// existing ThreadScreen via getThread()).
class CaseWhatsAppRef {
  final String? threadId;
  final bool windowOpen;

  const CaseWhatsAppRef({this.threadId, this.windowOpen = false});

  factory CaseWhatsAppRef.fromJson(Map<String, dynamic> j) => CaseWhatsAppRef(
        threadId: asStringOrNull(j['threadId']),
        windowOpen: j['windowOpen'] as bool? ?? false,
      );
}

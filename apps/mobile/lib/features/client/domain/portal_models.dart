// Domain models for the CLIENT (external customer) portal.
//
// These mirror the backend /portal/* response shapes exactly (see
// apps/backend/src/modules/portal/portal.service.ts and the web client's
// apps/frontend/lib/portal.ts). Clients carry an EMPTY permissions[] — every
// screen gates on the 'client' ROLE only (the router already restricts /portal
// to that role). A client with portalAccessEnabled=false authenticates fine but
// gets 403 on every /portal/* call, which the repository maps to a ForbiddenError
// the screens render as a clean empty/error state — never a crash.

/// Helper: parse an ISO string into a UTC DateTime, or null.
DateTime? _parseDate(dynamic v) {
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v);
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// CASE
// ───────────────────────────────────────────────────────────────────────────

/// One row of GET /portal/cases/mine — used to resolve the active case on shell
/// load and to render the case overview.
class PortalCaseSummary {
  final String id;
  final String stage;
  final String service;
  final String? targetCountry;
  final DateTime? createdAt;
  final DateTime? slaDueAt;
  final String? assignedOfficerName;
  final int docsTotal;
  final int docsAccepted;
  final int docsActionRequired;
  final int unreadMessages;

  const PortalCaseSummary({
    required this.id,
    required this.stage,
    required this.service,
    this.targetCountry,
    this.createdAt,
    this.slaDueAt,
    this.assignedOfficerName,
    this.docsTotal = 0,
    this.docsAccepted = 0,
    this.docsActionRequired = 0,
    this.unreadMessages = 0,
  });

  factory PortalCaseSummary.fromJson(Map<String, dynamic> j) => PortalCaseSummary(
        id: j['id'] as String,
        stage: j['stage'] as String? ?? 'INTAKE_PENDING',
        service: j['service'] as String? ?? '',
        targetCountry: j['targetCountry'] as String?,
        createdAt: _parseDate(j['createdAt']),
        slaDueAt: _parseDate(j['slaDueAt']),
        assignedOfficerName: j['assignedOfficerName'] as String?,
        docsTotal: (j['docsTotal'] as num?)?.toInt() ?? 0,
        docsAccepted: (j['docsAccepted'] as num?)?.toInt() ?? 0,
        docsActionRequired: (j['docsActionRequired'] as num?)?.toInt() ?? 0,
        unreadMessages: (j['unreadMessages'] as num?)?.toInt() ?? 0,
      );
}

/// GET /portal/cases/:caseId — the detail used by the Case overview tab.
class PortalCaseDetail {
  final String id;
  final String stage;
  final String service;
  final String? targetCountry;
  final DateTime? createdAt;
  final DateTime? slaDueAt;
  final String? assignedOfficerName;

  /// Map of DocumentItemStatus → count (e.g. {ACCEPTED: 3, NOT_SUBMITTED: 2}).
  final Map<String, int> docCounts;
  final int unreadMessages;

  const PortalCaseDetail({
    required this.id,
    required this.stage,
    required this.service,
    this.targetCountry,
    this.createdAt,
    this.slaDueAt,
    this.assignedOfficerName,
    this.docCounts = const {},
    this.unreadMessages = 0,
  });

  int get docsTotal => docCounts.values.fold(0, (a, b) => a + b);
  int get docsAccepted => docCounts['ACCEPTED'] ?? 0;
  int get docsActionRequired =>
      (docCounts['NOT_SUBMITTED'] ?? 0) + (docCounts['REJECTED'] ?? 0);

  factory PortalCaseDetail.fromJson(Map<String, dynamic> j) {
    final raw = j['docCounts'];
    final counts = <String, int>{};
    if (raw is Map) {
      for (final e in raw.entries) {
        counts[e.key.toString()] = (e.value as num?)?.toInt() ?? 0;
      }
    }
    return PortalCaseDetail(
      id: j['id'] as String,
      stage: j['stage'] as String? ?? 'INTAKE_PENDING',
      service: j['service'] as String? ?? '',
      targetCountry: j['targetCountry'] as String?,
      createdAt: _parseDate(j['createdAt']),
      slaDueAt: _parseDate(j['slaDueAt']),
      assignedOfficerName: j['assignedOfficerName'] as String?,
      docCounts: counts,
      unreadMessages: (j['unreadMessages'] as num?)?.toInt() ?? 0,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ───────────────────────────────────────────────────────────────────────────

/// The uploaded-file metadata attached to a document item (latest version).
class PortalDocumentVersion {
  final String id;
  final String fileName;
  final int fileSizeBytes;
  final String mimeType;
  final int versionNumber;
  final DateTime? uploadedAt;

  const PortalDocumentVersion({
    required this.id,
    required this.fileName,
    required this.fileSizeBytes,
    required this.mimeType,
    required this.versionNumber,
    this.uploadedAt,
  });

  factory PortalDocumentVersion.fromJson(Map<String, dynamic> j) =>
      PortalDocumentVersion(
        id: j['id'] as String,
        fileName: j['fileName'] as String? ?? 'document',
        fileSizeBytes: (j['fileSizeBytes'] as num?)?.toInt() ?? 0,
        mimeType: j['mimeType'] as String? ?? '',
        versionNumber: (j['versionNumber'] as num?)?.toInt() ?? 1,
        uploadedAt: _parseDate(j['uploadedAt']),
      );
}

/// A backend-translated, client-safe rejection message. Render `clientMessage`
/// only — `code`/`internalLabel` are for audit and must never reach the UI.
class PortalRejectionMessage {
  final String code;
  final String internalLabel;
  final String clientMessage;

  const PortalRejectionMessage({
    required this.code,
    required this.internalLabel,
    required this.clientMessage,
  });

  factory PortalRejectionMessage.fromJson(Map<String, dynamic> j) =>
      PortalRejectionMessage(
        code: j['code'] as String? ?? '',
        internalLabel: j['internalLabel'] as String? ?? '',
        clientMessage: j['clientMessage'] as String? ?? '',
      );
}

/// One row of GET /portal/cases/:caseId/documents.
class PortalDocumentItem {
  final String id;
  final String documentName;
  final String? description;
  final String criticality;
  final String status;
  final bool isAdditional;
  final List<String> expectedFormats;
  final int maxFileSizeMb;
  final DateTime? validityExpiryDate;
  final DateTime? requestDeadline;
  final PortalDocumentVersion? latestVersion;
  final bool canUpload;
  final List<PortalRejectionMessage> latestRejectionMessages;

  const PortalDocumentItem({
    required this.id,
    required this.documentName,
    this.description,
    required this.criticality,
    required this.status,
    this.isAdditional = false,
    this.expectedFormats = const [],
    this.maxFileSizeMb = 10,
    this.validityExpiryDate,
    this.requestDeadline,
    this.latestVersion,
    this.canUpload = false,
    this.latestRejectionMessages = const [],
  });

  bool get isAccepted => status == 'ACCEPTED';
  bool get isRejected => status == 'REJECTED';
  bool get isSubmitted => status == 'SUBMITTED' || status == 'UNDER_REVIEW';
  bool get notSubmitted => status == 'NOT_SUBMITTED';

  factory PortalDocumentItem.fromJson(Map<String, dynamic> j) {
    final rej = (j['latestRejectionMessages'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(PortalRejectionMessage.fromJson)
        .toList();
    return PortalDocumentItem(
      id: j['id'] as String,
      documentName: j['documentName'] as String? ?? 'Document',
      description: j['description'] as String?,
      criticality: j['criticality'] as String? ?? 'REQUIRED',
      status: j['status'] as String? ?? 'NOT_SUBMITTED',
      isAdditional: j['isAdditional'] as bool? ?? false,
      expectedFormats: (j['expectedFormats'] as List? ?? const [])
          .map((e) => e.toString())
          .toList(),
      maxFileSizeMb: (j['maxFileSizeMb'] as num?)?.toInt() ?? 10,
      validityExpiryDate: _parseDate(j['validityExpiryDate']),
      requestDeadline: _parseDate(j['requestDeadline']),
      latestVersion: j['latestVersion'] is Map<String, dynamic>
          ? PortalDocumentVersion.fromJson(
              j['latestVersion'] as Map<String, dynamic>)
          : null,
      canUpload: j['canUpload'] as bool? ?? false,
      latestRejectionMessages: rej,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// MESSAGES
// ───────────────────────────────────────────────────────────────────────────

/// One row of GET /portal/cases/:caseId/communications. Direction is one of
/// OFFICER_TO_CLIENT | CLIENT_TO_OFFICER | SYSTEM_TO_CLIENT.
class PortalMessage {
  final String id;
  final String direction;
  final String messageType;
  final String? subject;
  final String content;
  final List<String> channelsSent;
  final DateTime? createdAt;
  final DateTime? readByClientAt;
  final String? senderName;

  const PortalMessage({
    required this.id,
    required this.direction,
    required this.messageType,
    this.subject,
    required this.content,
    this.channelsSent = const [],
    this.createdAt,
    this.readByClientAt,
    this.senderName,
  });

  /// The client's own outgoing message (renders right-aligned).
  bool get isFromClient => direction == 'CLIENT_TO_OFFICER';

  /// A system/automated message (renders centered, muted).
  bool get isSystem => direction == 'SYSTEM_TO_CLIENT';

  factory PortalMessage.fromJson(Map<String, dynamic> j) => PortalMessage(
        id: j['id'] as String,
        direction: j['direction'] as String? ?? 'OFFICER_TO_CLIENT',
        messageType: j['messageType'] as String? ?? 'GENERAL_UPDATE',
        subject: j['subject'] as String?,
        content: j['content'] as String? ?? '',
        channelsSent: (j['channelsSent'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        createdAt: _parseDate(j['createdAt']),
        readByClientAt: _parseDate(j['readByClientAt']),
        senderName: j['senderName'] as String?,
      );
}

// ───────────────────────────────────────────────────────────────────────────
// TIMELINE
// ───────────────────────────────────────────────────────────────────────────

/// One event of GET /portal/cases/:caseId/timeline — a client-safe activity
/// feed merging stage changes, document review decisions, and officer/system
/// communications (internal notes, tasks and officer rejection notes are
/// filtered out server-side). The backend returns events ascending by
/// createdAt; the tab renders them newest-first.
class PortalTimelineEvent {
  final String id;
  final String type; // STAGE_CHANGE | DOCUMENT_REVIEW | COMMUNICATION
  final DateTime? createdAt;
  final String description;
  final String? actor;
  final String? decision; // ACCEPTED | REJECTED — DOCUMENT_REVIEW only

  const PortalTimelineEvent({
    required this.id,
    required this.type,
    this.createdAt,
    required this.description,
    this.actor,
    this.decision,
  });

  bool get isStageChange => type == 'STAGE_CHANGE';
  bool get isDocumentReview => type == 'DOCUMENT_REVIEW';
  bool get isCommunication => type == 'COMMUNICATION';
  bool get isRejection => decision == 'REJECTED';

  factory PortalTimelineEvent.fromJson(Map<String, dynamic> j) =>
      PortalTimelineEvent(
        id: j['id'] as String? ?? '',
        type: j['type'] as String? ?? 'STAGE_CHANGE',
        createdAt: _parseDate(j['createdAt']),
        description: j['description'] as String? ?? '',
        actor: j['actor'] as String?,
        decision: j['decision'] as String?,
      );
}

// ───────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ───────────────────────────────────────────────────────────────────────────

/// One row of GET /portal/notifications — a derived feed (no DB table). `kind`
/// drives the icon; `href` is the web path the web portal deep-links to — we
/// reuse the tail of it to pick a tab on mobile.
class PortalNotification {
  final String id;
  final String kind;
  final String title;
  final String body;
  final DateTime? createdAt;
  final String? caseId;
  final String severity; // info | warning | danger | success
  final String href;

  const PortalNotification({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    this.createdAt,
    this.caseId,
    this.severity = 'info',
    this.href = '',
  });

  factory PortalNotification.fromJson(Map<String, dynamic> j) => PortalNotification(
        id: j['id'] as String? ?? '',
        kind: j['kind'] as String? ?? 'STAGE_CHANGE',
        title: j['title'] as String? ?? '',
        body: j['body'] as String? ?? '',
        createdAt: _parseDate(j['createdAt']),
        caseId: j['caseId'] as String?,
        severity: j['severity'] as String? ?? 'info',
        href: j['href'] as String? ?? '',
      );
}

// ───────────────────────────────────────────────────────────────────────────
// APPOINTMENTS
// ───────────────────────────────────────────────────────────────────────────

/// One row of GET /portal/appointments (past + upcoming).
class PortalAppointment {
  final String id;
  final String title;
  final String appointmentType;
  final DateTime? scheduledAt;
  final int durationMinutes;
  final String? location;
  final String? meetingLink;
  final String? instructions;
  final String status;
  final bool reminderSent;
  final DateTime? completedAt;
  final String? cancellationReason;

  const PortalAppointment({
    required this.id,
    required this.title,
    required this.appointmentType,
    this.scheduledAt,
    this.durationMinutes = 0,
    this.location,
    this.meetingLink,
    this.instructions,
    required this.status,
    this.reminderSent = false,
    this.completedAt,
    this.cancellationReason,
  });

  /// Upcoming = scheduled in the future and still active (not done/cancelled).
  bool get isUpcoming {
    final at = scheduledAt;
    if (at == null) return false;
    final active = status == 'SCHEDULED' || status == 'CONFIRMED';
    return active && at.isAfter(DateTime.now());
  }

  factory PortalAppointment.fromJson(Map<String, dynamic> j) => PortalAppointment(
        id: j['id'] as String,
        title: j['title'] as String? ?? 'Appointment',
        appointmentType: j['appointmentType'] as String? ?? '',
        scheduledAt: _parseDate(j['scheduledAt']),
        durationMinutes: (j['durationMinutes'] as num?)?.toInt() ?? 0,
        location: j['location'] as String?,
        meetingLink: j['meetingLink'] as String?,
        instructions: j['instructions'] as String?,
        status: j['status'] as String? ?? 'SCHEDULED',
        reminderSent: j['reminderSent'] as bool? ?? false,
        completedAt: _parseDate(j['completedAt']),
        cancellationReason: j['cancellationReason'] as String?,
      );
}

// ───────────────────────────────────────────────────────────────────────────
// CLIENT-FACING LABELS (mirrors apps/frontend/lib/portal.ts)
// ───────────────────────────────────────────────────────────────────────────

/// Friendly stage labels — the client never sees raw enum names.
const Map<String, String> kClientStageLabel = {
  'INTAKE_PENDING': 'Case Received',
  'DOCUMENTS_COLLECTION': 'Please Upload Documents',
  'DOCUMENTS_UNDER_REVIEW': 'Documents Under Review',
  'DOCUMENTS_INCOMPLETE': 'Action Required — Documents Incomplete',
  'DOCUMENTS_COMPLETE': 'Documents Complete',
  'READY_FOR_SUBMISSION': 'Being Prepared for Submission',
  'SUBMITTED': 'Application Submitted',
  'UNDER_AUTHORITY_REVIEW': 'With Immigration Authority',
  'ADDITIONAL_INFO_REQUESTED': 'Additional Information Required',
  'DECISION_RECEIVED': 'Decision Received',
  'APPROVED': 'Approved',
  'REJECTED': 'Application Rejected',
  'APPEAL_IN_PROGRESS': 'Appeal In Progress',
  'COMPLETED': 'Case Complete',
  'CANCELLED': 'Case Cancelled',
};

/// What the client should do next, by stage.
const Map<String, String> kClientNextAction = {
  'INTAKE_PENDING':
      'Your application has been received. We will be in touch shortly.',
  'DOCUMENTS_COLLECTION':
      'Please upload all required documents via the Documents tab.',
  'DOCUMENTS_UNDER_REVIEW':
      'Your documents are being reviewed. No action needed at this time.',
  'DOCUMENTS_INCOMPLETE':
      'Some documents require attention. Please check the Documents tab.',
  'DOCUMENTS_COMPLETE':
      'All documents are complete. We are preparing your application.',
  'READY_FOR_SUBMISSION': 'Your application is ready. We will submit it soon.',
  'SUBMITTED':
      'Your application has been submitted. We will notify you when there is an update.',
  'UNDER_AUTHORITY_REVIEW':
      'Your application is with the authority. This process takes time — we will keep you informed.',
  'ADDITIONAL_INFO_REQUESTED':
      'The authority has requested additional information. Please check your messages.',
  'DECISION_RECEIVED':
      'A decision has been received. Your consultant will contact you shortly.',
  'APPROVED':
      'Congratulations — your application has been approved! Your consultant will explain the next steps.',
  'REJECTED':
      'Your application has been rejected. Please check your messages for details and options.',
  'APPEAL_IN_PROGRESS':
      'An appeal has been filed on your behalf. We will keep you informed.',
  'COMPLETED': 'Your case is complete. Thank you for trusting us.',
};

/// The 5-step journey the client sees as a progress stepper.
const List<String> kClientJourneyPhases = [
  'Documents',
  'Preparing',
  'Submitted',
  'Authority review',
  'Decision',
];

const Map<String, int> _kPhaseByStage = {
  'INTAKE_PENDING': 0,
  'DOCUMENTS_COLLECTION': 0,
  'DOCUMENTS_UNDER_REVIEW': 0,
  'DOCUMENTS_INCOMPLETE': 0,
  'DOCUMENTS_COMPLETE': 0,
  'READY_FOR_SUBMISSION': 1,
  'SUBMITTED': 2,
  'UNDER_AUTHORITY_REVIEW': 3,
  'ADDITIONAL_INFO_REQUESTED': 3,
  'DECISION_RECEIVED': 3,
  'APPEAL_IN_PROGRESS': 3,
  'APPROVED': 4,
  'REJECTED': 4,
  'COMPLETED': 4,
  'CANCELLED': -1,
};

/// Index (0–4) of the client's current journey phase, or -1 if cancelled.
int clientJourneyPhase(String stage) => _kPhaseByStage[stage] ?? 0;

/// Friendly stage label, falling back to a title-cased enum.
String clientStageLabel(String stage) =>
    kClientStageLabel[stage] ?? _titleCase(stage);

String clientNextAction(String stage) => kClientNextAction[stage] ?? '';

/// Title-case an ENUM_LIKE_THIS string ("Enum Like This").
String _titleCase(String s) => s
    .split('_')
    .where((w) => w.isNotEmpty)
    .map((w) => w[0].toUpperCase() + w.substring(1).toLowerCase())
    .join(' ');

/// Title-case helper exposed for service/type/appointment labels.
String titleCaseEnum(String s) => _titleCase(s);

import '../../../core/util/parsers.dart';

const kAgreementStatuses = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'SENT',
  'SIGNED',
  'REJECTED',
];

String agreementStatusLabel(String status) => switch (status) {
      'DRAFT' => 'Draft',
      'SUBMITTED' => 'Submitted to Finance',
      'FINANCE_REVIEW' => 'In finance review',
      'CHANGES_REQUESTED' => 'Changes requested',
      'EDITED_PENDING_SALES' => 'Edited — pending sales',
      'APPROVED' => 'Approved',
      'SENT' => 'Sent to client',
      'SIGNED' => 'Signed',
      'REJECTED' => 'Changes requested',
      'CANCELLED' => 'Cancelled',
      _ => status,
    };

class Agreement {
  final String id;
  final String? agreementNumber;
  final String? categoryKey;
  final String status;
  final String? currency;
  final double? totalAmount;
  final double? grossAmount;
  final double? discountAmount;
  final String? paymentPlanType;
  final String? financeNotes;
  final String? salesNotes;
  final DateTime createdAt;
  final DateTime? submittedAt;

  /// Nested lead snippet returned by the API.
  final String? leadFirstName;
  final String? leadLastName;
  final String? leadReferenceCode;

  // ── Detail-only fields (present from GET /agreements/:id, null from list) ──
  final AgreementBio? bio;
  final AgreementPaymentPlan? paymentPlan;
  final DateTime? paymentPlanLockedAt;
  final List<AgreementEvent> events;

  const Agreement({
    required this.id,
    this.agreementNumber,
    this.categoryKey,
    required this.status,
    this.currency,
    this.totalAmount,
    this.grossAmount,
    this.discountAmount,
    this.paymentPlanType,
    this.financeNotes,
    this.salesNotes,
    required this.createdAt,
    this.submittedAt,
    this.leadFirstName,
    this.leadLastName,
    this.leadReferenceCode,
    this.bio,
    this.paymentPlan,
    this.paymentPlanLockedAt,
    this.events = const [],
  });

  String get statusLabel => agreementStatusLabel(status);

  String get title {
    final num = agreementNumber;
    final cat = categoryKey ?? 'Agreement';
    return num != null ? '#$num · $cat' : cat;
  }

  String? get amountDisplay {
    if (totalAmount == null) return null;
    final cur = currency ?? '';
    return '$cur ${totalAmount!.toStringAsFixed(0)}'.trim();
  }

  factory Agreement.fromJson(Map<String, dynamic> j) {
    final lead = j['lead'];
    final leadMap = lead is Map<String, dynamic> ? lead : null;
    final bioMap = j['bioData'] is Map<String, dynamic>
        ? j['bioData'] as Map<String, dynamic>
        : null;
    final planMap = j['paymentPlan'] is Map<String, dynamic>
        ? j['paymentPlan'] as Map<String, dynamic>
        : null;
    final eventsRaw = j['events'];
    return Agreement(
      id: j['id'] as String,
      agreementNumber: asStringOrNull(j['agreementNumber']),
      categoryKey: asStringOrNull(j['categoryKey']),
      status: j['status'] as String? ?? 'DRAFT',
      currency: asStringOrNull(j['currency']),
      totalAmount: _toDouble(j['totalAmount'] ?? j['netPayable']),
      grossAmount: _toDouble(j['grossAmount']),
      discountAmount: _toDouble(j['discountAmount']),
      paymentPlanType: asStringOrNull(j['paymentPlanType']),
      financeNotes: asStringOrNull(j['financeNotes']),
      salesNotes: asStringOrNull(j['salesNotes']),
      createdAt: parseApiDate(j['createdAt']),
      submittedAt: parseApiDateOrNull(j['submittedAt']),
      leadFirstName:
          leadMap != null ? asStringOrNull(leadMap['firstName']) : null,
      leadLastName:
          leadMap != null ? asStringOrNull(leadMap['lastName']) : null,
      leadReferenceCode:
          leadMap != null ? asStringOrNull(leadMap['referenceCode']) : null,
      // Detail fields — only present on the single-agreement endpoint. The
      // payment plan comes back as an empty object {} when none is set, so
      // only treat it as a plan when it actually carries a planType.
      bio: bioMap != null ? AgreementBio.fromJson(bioMap) : null,
      paymentPlan: planMap != null && planMap['planType'] != null
          ? AgreementPaymentPlan.fromJson(planMap)
          : null,
      paymentPlanLockedAt: parseApiDateOrNull(j['paymentPlanLockedAt']),
      events: eventsRaw is List
          ? eventsRaw
              .whereType<Map<String, dynamic>>()
              .map(AgreementEvent.fromJson)
              .toList()
          : const [],
    );
  }
}

/// Applicant bio captured on the agreement (mirrors the web BioDataInput).
class AgreementBio {
  final String? applicantName;
  final String? fatherName;
  final String? cnic;
  final String? passport;
  final String? dob;
  final String? nationality;
  final String? address;
  final String? phone;
  final String? email;
  final String? fileNumber;
  final String? agreementDate;
  final String? country;

  const AgreementBio({
    this.applicantName,
    this.fatherName,
    this.cnic,
    this.passport,
    this.dob,
    this.nationality,
    this.address,
    this.phone,
    this.email,
    this.fileNumber,
    this.agreementDate,
    this.country,
  });

  factory AgreementBio.fromJson(Map<String, dynamic> j) => AgreementBio(
        applicantName: asStringOrNull(j['applicantName']),
        fatherName: asStringOrNull(j['fatherName']),
        cnic: asStringOrNull(j['cnic']),
        passport: asStringOrNull(j['passport']),
        dob: asStringOrNull(j['dob']),
        nationality: asStringOrNull(j['nationality']),
        address: asStringOrNull(j['address']),
        phone: asStringOrNull(j['phone']),
        email: asStringOrNull(j['email']),
        fileNumber: asStringOrNull(j['fileNumber']),
        agreementDate: asStringOrNull(j['agreementDate']),
        country: asStringOrNull(j['country']),
      );
}

class AgreementInstallment {
  final int? sequence;
  final String? stage;
  final double? amount;
  final String? trigger;
  final String? dueDate;
  final String? notes;

  const AgreementInstallment({
    this.sequence,
    this.stage,
    this.amount,
    this.trigger,
    this.dueDate,
    this.notes,
  });

  factory AgreementInstallment.fromJson(Map<String, dynamic> j) =>
      AgreementInstallment(
        sequence: j['sequence'] is num ? (j['sequence'] as num).toInt() : null,
        stage: asStringOrNull(j['stage']),
        amount: _toDouble(j['amount']),
        trigger: asStringOrNull(j['trigger']),
        dueDate: asStringOrNull(j['dueDate']),
        notes: asStringOrNull(j['notes']),
      );
}

class AgreementGovFee {
  final String? label;
  final double? amount;
  final String? currency;
  final String? payableBy;

  const AgreementGovFee({this.label, this.amount, this.currency, this.payableBy});

  factory AgreementGovFee.fromJson(Map<String, dynamic> j) => AgreementGovFee(
        label: asStringOrNull(j['label']),
        amount: _toDouble(j['amount']),
        currency: asStringOrNull(j['currency']),
        payableBy: asStringOrNull(j['payableBy']),
      );
}

/// Payment plan (mirrors the web PaymentPlanInput).
class AgreementPaymentPlan {
  final String? planType;
  final String? currency;
  final double? grossAmount;
  final double? discountAmount;
  final double? netPayable;
  final double? taxAmount;
  final bool? refundable;
  final String? refundPolicyText;
  final String? notes;
  final List<AgreementInstallment> installments;
  final List<AgreementGovFee> governmentFees;

  const AgreementPaymentPlan({
    this.planType,
    this.currency,
    this.grossAmount,
    this.discountAmount,
    this.netPayable,
    this.taxAmount,
    this.refundable,
    this.refundPolicyText,
    this.notes,
    this.installments = const [],
    this.governmentFees = const [],
  });

  factory AgreementPaymentPlan.fromJson(Map<String, dynamic> j) {
    final inst = j['installments'];
    final fees = j['governmentFees'];
    return AgreementPaymentPlan(
      planType: asStringOrNull(j['planType']),
      currency: asStringOrNull(j['currency']),
      grossAmount: _toDouble(j['grossAmount']),
      discountAmount: _toDouble(j['discountAmount']),
      netPayable: _toDouble(j['netPayable']),
      taxAmount: _toDouble(j['taxAmount']),
      refundable: j['refundable'] is bool ? j['refundable'] as bool : null,
      refundPolicyText: asStringOrNull(j['refundPolicyText']),
      notes: asStringOrNull(j['notes']),
      installments: inst is List
          ? inst
              .whereType<Map<String, dynamic>>()
              .map(AgreementInstallment.fromJson)
              .toList()
          : const [],
      governmentFees: fees is List
          ? fees
              .whereType<Map<String, dynamic>>()
              .map(AgreementGovFee.fromJson)
              .toList()
          : const [],
    );
  }
}

class AgreementEvent {
  final String id;
  final String? type;
  final String? summary;
  final DateTime? createdAt;

  const AgreementEvent(
      {required this.id, this.type, this.summary, this.createdAt});

  factory AgreementEvent.fromJson(Map<String, dynamic> j) => AgreementEvent(
        id: j['id'] as String? ?? '',
        type: asStringOrNull(j['type']),
        summary: asStringOrNull(j['summary']),
        createdAt: parseApiDateOrNull(j['createdAt']),
      );
}

double? _toDouble(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  final s = v.toString();
  return double.tryParse(s);
}

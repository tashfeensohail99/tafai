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
      'APPROVED' => 'Approved',
      'SENT' => 'Sent to client',
      'SIGNED' => 'Signed',
      'REJECTED' => 'Changes requested',
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
      leadFirstName: leadMap != null
          ? asStringOrNull(leadMap['firstName'])
          : null,
      leadLastName: leadMap != null
          ? asStringOrNull(leadMap['lastName'])
          : null,
      leadReferenceCode: leadMap != null
          ? asStringOrNull(leadMap['referenceCode'])
          : null,
    );
  }
}

double? _toDouble(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  final s = v.toString();
  return double.tryParse(s);
}

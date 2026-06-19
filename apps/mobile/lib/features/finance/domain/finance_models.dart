import '../../../core/util/parsers.dart';

/// Finance domain models — mirror the web JSON shapes (apps/frontend/lib/
/// finance-api.ts + finance-profile.ts + agreements.ts). All `fromJson`
/// factories are lenient/null-safe (see core/util/parsers.dart) so a missing
/// or oddly-typed field never blanks a whole screen.

// ─── Customers list (GET /finance/customer[?search=]) ───────────────────────

/// One row in the Finance "Customers" home — the searchable pipeline list.
/// Mirrors web `FinanceCustomerRow`.
class FinanceCustomerRow {
  final String leadId;
  final String referenceCode;
  final String firstName;
  final String lastName;
  final String phone;
  final String? serviceInterest;
  final String? targetCountry;
  final String status;
  final String? agreementStatus;
  final bool hasContract;
  final String? contractStatus;
  final String? processingStage;
  final bool hasPendingPayment;
  final double fee;
  final double paid;
  final double outstanding;
  final String currency;

  const FinanceCustomerRow({
    required this.leadId,
    required this.referenceCode,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.serviceInterest,
    this.targetCountry,
    required this.status,
    this.agreementStatus,
    this.hasContract = false,
    this.contractStatus,
    this.processingStage,
    this.hasPendingPayment = false,
    this.fee = 0,
    this.paid = 0,
    this.outstanding = 0,
    this.currency = 'CAD',
  });

  String get fullName => '$firstName $lastName'.trim();

  factory FinanceCustomerRow.fromJson(Map<String, dynamic> j) =>
      FinanceCustomerRow(
        leadId: j['leadId']?.toString() ?? '',
        referenceCode: j['referenceCode']?.toString() ?? '',
        firstName: j['firstName']?.toString() ?? '',
        lastName: j['lastName']?.toString() ?? '',
        phone: j['phone']?.toString() ?? '',
        serviceInterest: asStringOrNull(j['serviceInterest']),
        targetCountry: asStringOrNull(j['targetCountry']),
        status: j['status']?.toString() ?? 'NEW',
        agreementStatus: asStringOrNull(j['agreementStatus']),
        hasContract: j['hasContract'] == true,
        contractStatus: asStringOrNull(j['contractStatus']),
        processingStage: asStringOrNull(j['processingStage']),
        hasPendingPayment: j['hasPendingPayment'] == true,
        fee: asDouble(j['fee']),
        paid: asDouble(j['paid']),
        outstanding: asDouble(j['outstanding']),
        currency: j['currency']?.toString() ?? 'CAD',
      );
}

// ─── Customer profile (GET /finance/customer/:leadId) ───────────────────────

/// Lead bio inside the profile. Mirrors web `FinanceProfileLead`.
class FinanceProfileLead {
  final String id;
  final String referenceCode;
  final String firstName;
  final String lastName;
  final String phone;
  final String? email;
  final String? nationality;
  final String? targetCountry;
  final String? serviceInterest;
  final String status;
  final String? sourceChannel;
  final DateTime? createdAt;
  final String? assignedEmployeeName;

  const FinanceProfileLead({
    required this.id,
    required this.referenceCode,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.email,
    this.nationality,
    this.targetCountry,
    this.serviceInterest,
    required this.status,
    this.sourceChannel,
    this.createdAt,
    this.assignedEmployeeName,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory FinanceProfileLead.fromJson(Map<String, dynamic> j) {
    final emp = j['assignedEmployee'];
    String? empName;
    if (emp is Map<String, dynamic>) {
      empName =
          '${emp['firstName'] ?? ''} ${emp['lastName'] ?? ''}'.trim();
      if (empName.isEmpty) empName = null;
    }
    return FinanceProfileLead(
      id: j['id']?.toString() ?? '',
      referenceCode: j['referenceCode']?.toString() ?? '',
      firstName: j['firstName']?.toString() ?? '',
      lastName: j['lastName']?.toString() ?? '',
      phone: j['phone']?.toString() ?? '',
      email: asStringOrNull(j['email']),
      nationality: asStringOrNull(j['nationality']),
      targetCountry: asStringOrNull(j['targetCountry']),
      serviceInterest: asStringOrNull(j['serviceInterest']),
      status: j['status']?.toString() ?? 'NEW',
      sourceChannel: asStringOrNull(j['sourceChannel']),
      createdAt: parseApiDateOrNull(j['createdAt']),
      assignedEmployeeName: empName,
    );
  }
}

/// Agreement snippet inside the profile. Mirrors web `FinanceProfileAgreement`.
class FinanceProfileAgreement {
  final String id;
  final String agreementNumber;
  final String status;
  final String currency;
  final double totalAmount;
  final double grossAmount;
  final double discountAmount;
  final bool hasPdf;
  final String? serviceContractId;
  final DateTime? sentAt;
  final DateTime? signedAt;

  const FinanceProfileAgreement({
    required this.id,
    required this.agreementNumber,
    required this.status,
    required this.currency,
    this.totalAmount = 0,
    this.grossAmount = 0,
    this.discountAmount = 0,
    this.hasPdf = false,
    this.serviceContractId,
    this.sentAt,
    this.signedAt,
  });

  factory FinanceProfileAgreement.fromJson(Map<String, dynamic> j) =>
      FinanceProfileAgreement(
        id: j['id']?.toString() ?? '',
        agreementNumber: j['agreementNumber']?.toString() ?? '',
        status: j['status']?.toString() ?? 'DRAFT',
        currency: j['currency']?.toString() ?? 'CAD',
        totalAmount: asDouble(j['totalAmount']),
        grossAmount: asDouble(j['grossAmount']),
        discountAmount: asDouble(j['discountAmount']),
        hasPdf: j['hasPdf'] == true,
        serviceContractId: asStringOrNull(j['serviceContractId']),
        sentAt: parseApiDateOrNull(j['sentAt']),
        signedAt: parseApiDateOrNull(j['signedAt']),
      );
}

/// Service-contract snippet. Mirrors web `FinanceProfileContract`.
class FinanceProfileContract {
  final String id;
  final String contractNumber;
  final String status;
  final double totalAmount;
  final String currency;
  final DateTime? signedDate;
  final bool hasSignedAgreement;
  final String? agreementFileName;

  const FinanceProfileContract({
    required this.id,
    required this.contractNumber,
    required this.status,
    this.totalAmount = 0,
    this.currency = 'CAD',
    this.signedDate,
    this.hasSignedAgreement = false,
    this.agreementFileName,
  });

  factory FinanceProfileContract.fromJson(Map<String, dynamic> j) =>
      FinanceProfileContract(
        id: j['id']?.toString() ?? '',
        contractNumber: j['contractNumber']?.toString() ?? '',
        status: j['status']?.toString() ?? 'ACTIVE',
        totalAmount: asDouble(j['totalAmount']),
        currency: j['currency']?.toString() ?? 'CAD',
        signedDate: parseApiDateOrNull(j['signedDate']),
        hasSignedAgreement: j['hasSignedAgreement'] == true,
        agreementFileName: asStringOrNull(j['agreementFileName']),
      );
}

/// One installment row in the ledger.
class FinanceInstallment {
  final String id;
  final int sequence;
  final DateTime? dueDate;
  final double amount;
  final String status;
  final String? description;
  final double paidAmount;
  final String paidStatus;
  final DateTime? recognizedAt;

  const FinanceInstallment({
    required this.id,
    this.sequence = 0,
    this.dueDate,
    this.amount = 0,
    this.status = '',
    this.description,
    this.paidAmount = 0,
    this.paidStatus = '',
    this.recognizedAt,
  });

  factory FinanceInstallment.fromJson(Map<String, dynamic> j) =>
      FinanceInstallment(
        id: j['id']?.toString() ?? '',
        sequence: asInt(j['sequence']),
        dueDate: parseApiDateOrNull(j['dueDate']),
        amount: asDouble(j['amount']),
        status: j['status']?.toString() ?? '',
        description: asStringOrNull(j['description']),
        paidAmount: asDouble(j['paidAmount']),
        paidStatus: j['paidStatus']?.toString() ?? '',
        recognizedAt: parseApiDateOrNull(j['recognizedAt']),
      );
}

/// Verified-payment row.
class FinancePayment {
  final String id;
  final double amount;
  final String currency;
  final String status;
  final String? paymentMethod;
  final DateTime? paidAt;
  final DateTime? verifiedAt;

  const FinancePayment({
    required this.id,
    this.amount = 0,
    this.currency = 'CAD',
    this.status = '',
    this.paymentMethod,
    this.paidAt,
    this.verifiedAt,
  });

  factory FinancePayment.fromJson(Map<String, dynamic> j) => FinancePayment(
        id: j['id']?.toString() ?? '',
        amount: asDouble(j['amount']),
        currency: j['currency']?.toString() ?? 'CAD',
        status: j['status']?.toString() ?? '',
        paymentMethod: asStringOrNull(j['paymentMethod']),
        paidAt: parseApiDateOrNull(j['paidAt']),
        verifiedAt: parseApiDateOrNull(j['verifiedAt']),
      );
}

/// A finance handover (payment submission) row on the profile + dashboard.
class FinanceHandoverRow {
  final String id;
  final String status;
  final double amount;
  final String currency;
  final bool verified;
  final String? receiptFileName;
  final DateTime? submittedAt;
  final DateTime? reviewedAt;

  const FinanceHandoverRow({
    required this.id,
    this.status = '',
    this.amount = 0,
    this.currency = 'CAD',
    this.verified = false,
    this.receiptFileName,
    this.submittedAt,
    this.reviewedAt,
  });

  factory FinanceHandoverRow.fromJson(Map<String, dynamic> j) =>
      FinanceHandoverRow(
        id: j['id']?.toString() ?? '',
        status: j['status']?.toString() ?? '',
        amount: asDouble(j['amount']),
        currency: j['currency']?.toString() ?? 'CAD',
        verified: j['verified'] == true,
        receiptFileName: asStringOrNull(j['receiptFileName']),
        submittedAt: parseApiDateOrNull(j['submittedAt']),
        reviewedAt: parseApiDateOrNull(j['reviewedAt']),
      );
}

/// A receipt issued for the customer.
class FinanceReceiptRow {
  final String id;
  final String receiptNumber;
  final double amount;
  final String currency;
  final DateTime? issuedAt;

  const FinanceReceiptRow({
    required this.id,
    this.receiptNumber = '',
    this.amount = 0,
    this.currency = 'CAD',
    this.issuedAt,
  });

  factory FinanceReceiptRow.fromJson(Map<String, dynamic> j) =>
      FinanceReceiptRow(
        id: j['id']?.toString() ?? '',
        receiptNumber: j['receiptNumber']?.toString() ?? '',
        amount: asDouble(j['amount']),
        currency: j['currency']?.toString() ?? 'CAD',
        issuedAt: parseApiDateOrNull(j['issuedAt']),
      );
}

/// An expense incurred on the client's behalf. Mirrors `FinanceProfileExpense`.
class FinanceExpense {
  final String id;
  final String category;
  final String description;
  final double amount;
  final String currency;
  final bool billable;
  final DateTime? incurredAt;
  final String? receiptFileName;
  final bool hasReceipt;

  const FinanceExpense({
    required this.id,
    this.category = 'OTHER',
    this.description = '',
    this.amount = 0,
    this.currency = 'CAD',
    this.billable = false,
    this.incurredAt,
    this.receiptFileName,
    this.hasReceipt = false,
  });

  factory FinanceExpense.fromJson(Map<String, dynamic> j) => FinanceExpense(
        id: j['id']?.toString() ?? '',
        category: j['category']?.toString() ?? 'OTHER',
        description: j['description']?.toString() ?? '',
        amount: asDouble(j['amount']),
        currency: j['currency']?.toString() ?? 'CAD',
        billable: j['billable'] == true,
        incurredAt: parseApiDateOrNull(j['incurredAt']),
        receiptFileName: asStringOrNull(j['receiptFileName']),
        hasReceipt: j['hasReceipt'] == true,
      );
}

/// Money totals + margin for the profile. Mirrors web `totals`.
class FinanceTotals {
  final double fee;
  final double paid;
  final double outstanding;
  final String currency;
  final int installmentsPaid;
  final int installmentsTotal;
  final double expenses;
  final double billableExpenses;
  final double absorbedExpenses;
  final double margin;

  const FinanceTotals({
    this.fee = 0,
    this.paid = 0,
    this.outstanding = 0,
    this.currency = 'CAD',
    this.installmentsPaid = 0,
    this.installmentsTotal = 0,
    this.expenses = 0,
    this.billableExpenses = 0,
    this.absorbedExpenses = 0,
    this.margin = 0,
  });

  factory FinanceTotals.fromJson(Map<String, dynamic>? j) {
    if (j == null) return const FinanceTotals();
    return FinanceTotals(
      fee: asDouble(j['fee']),
      paid: asDouble(j['paid']),
      outstanding: asDouble(j['outstanding']),
      currency: j['currency']?.toString() ?? 'CAD',
      installmentsPaid: asInt(j['installmentsPaid']),
      installmentsTotal: asInt(j['installmentsTotal']),
      expenses: asDouble(j['expenses']),
      billableExpenses: asDouble(j['billableExpenses']),
      absorbedExpenses: asDouble(j['absorbedExpenses']),
      margin: asDouble(j['margin']),
    );
  }
}

/// Processing-case snippet (when the file is already in Processing).
class FinanceProcessingCase {
  final String id;
  final String stage;
  final String service;
  final String? targetCountry;

  const FinanceProcessingCase({
    required this.id,
    this.stage = '',
    this.service = '',
    this.targetCountry,
  });

  factory FinanceProcessingCase.fromJson(Map<String, dynamic> j) =>
      FinanceProcessingCase(
        id: j['id']?.toString() ?? '',
        stage: j['stage']?.toString() ?? '',
        service: j['service']?.toString() ?? '',
        targetCountry: asStringOrNull(j['targetCountry']),
      );
}

/// The full aggregated customer profile. Mirrors web `FinanceCustomerProfile`.
class FinanceCustomerProfile {
  final FinanceProfileLead lead;
  final String? clientId;
  final FinanceProfileAgreement? agreement;
  final FinanceProfileContract? contract;
  final List<FinanceInstallment> installments;
  final List<FinancePayment> payments;
  final List<FinanceReceiptRow> receipts;
  final List<FinanceHandoverRow> handovers;
  final List<FinanceExpense> expenses;
  final FinanceProcessingCase? processingCase;
  final FinanceTotals totals;

  const FinanceCustomerProfile({
    required this.lead,
    this.clientId,
    this.agreement,
    this.contract,
    this.installments = const [],
    this.payments = const [],
    this.receipts = const [],
    this.handovers = const [],
    this.expenses = const [],
    this.processingCase,
    this.totals = const FinanceTotals(),
  });

  static List<T> _list<T>(
    Object? raw,
    T Function(Map<String, dynamic>) fromJson,
  ) {
    if (raw is! List) return const [];
    return raw.whereType<Map<String, dynamic>>().map(fromJson).toList();
  }

  factory FinanceCustomerProfile.fromJson(Map<String, dynamic> j) {
    final leadMap = j['lead'];
    final agMap = j['agreement'];
    final contractMap = j['contract'];
    final pcMap = j['processingCase'];
    return FinanceCustomerProfile(
      lead: FinanceProfileLead.fromJson(
          leadMap is Map<String, dynamic> ? leadMap : const {}),
      clientId: asStringOrNull(j['clientId']),
      agreement: agMap is Map<String, dynamic>
          ? FinanceProfileAgreement.fromJson(agMap)
          : null,
      contract: contractMap is Map<String, dynamic>
          ? FinanceProfileContract.fromJson(contractMap)
          : null,
      installments: _list(j['installments'], FinanceInstallment.fromJson),
      payments: _list(j['payments'], FinancePayment.fromJson),
      receipts: _list(j['receipts'], FinanceReceiptRow.fromJson),
      handovers: _list(j['handovers'], FinanceHandoverRow.fromJson),
      expenses: _list(j['expenses'], FinanceExpense.fromJson),
      processingCase: pcMap is Map<String, dynamic>
          ? FinanceProcessingCase.fromJson(pcMap)
          : null,
      totals: FinanceTotals.fromJson(
          j['totals'] is Map<String, dynamic> ? j['totals'] as Map<String, dynamic> : null),
    );
  }
}

// ─── Dashboard handover (GET /finance/handovers) ────────────────────────────

/// A handover as returned by the queue/dashboard list. Mirrors web `ApiHandover`
/// (only the fields the mobile dashboard needs).
class FinanceDashboardHandover {
  final String id;
  final String leadId;
  final String? paymentId;
  final String? reviewedByUserId;
  final String status;
  final double submittedAmount;
  final String currency;
  final String? paymentMethod;
  final String? financeNotes;
  final DateTime? submittedAt;
  final String leadFirstName;
  final String leadLastName;

  const FinanceDashboardHandover({
    required this.id,
    required this.leadId,
    this.paymentId,
    this.reviewedByUserId,
    this.status = '',
    this.submittedAmount = 0,
    this.currency = 'CAD',
    this.paymentMethod,
    this.financeNotes,
    this.submittedAt,
    this.leadFirstName = '',
    this.leadLastName = '',
  });

  String get clientName => '$leadFirstName $leadLastName'.trim();

  factory FinanceDashboardHandover.fromJson(Map<String, dynamic> j) {
    final lead = j['lead'];
    final leadMap = lead is Map<String, dynamic> ? lead : const {};
    final payment = j['payment'];
    final paymentMap = payment is Map<String, dynamic> ? payment : null;
    return FinanceDashboardHandover(
      id: j['id']?.toString() ?? '',
      leadId: (j['leadId'] ?? leadMap['id'])?.toString() ?? '',
      paymentId:
          asStringOrNull(j['paymentId']) ?? asStringOrNull(paymentMap?['id']),
      reviewedByUserId: asStringOrNull(j['reviewedByUserId']),
      status: j['status']?.toString() ?? '',
      submittedAmount: asDouble(j['submittedAmount']),
      currency: j['currency']?.toString() ?? 'CAD',
      paymentMethod: asStringOrNull(j['paymentMethod']),
      financeNotes: asStringOrNull(j['financeNotes']),
      submittedAt: parseApiDateOrNull(j['submittedAt']),
      leadFirstName: leadMap['firstName']?.toString() ?? '',
      leadLastName: leadMap['lastName']?.toString() ?? '',
    );
  }
}

// ─── Revenue by service (GET /finance/revenue/by-service) ───────────────────

class FinanceRevenue {
  final double month;
  final double ytd;
  final double allTime;
  final List<FinanceRevenueService> byService;

  const FinanceRevenue({
    this.month = 0,
    this.ytd = 0,
    this.allTime = 0,
    this.byService = const [],
  });

  factory FinanceRevenue.fromJson(Map<String, dynamic> j) {
    final totals = j['totals'];
    final totalsMap = totals is Map<String, dynamic> ? totals : const {};
    final svc = j['byService'];
    return FinanceRevenue(
      month: asDouble(totalsMap['month']),
      ytd: asDouble(totalsMap['ytd']),
      allTime: asDouble(totalsMap['allTime']),
      byService: svc is List
          ? svc
              .whereType<Map<String, dynamic>>()
              .map(FinanceRevenueService.fromJson)
              .toList()
          : const [],
    );
  }
}

class FinanceRevenueService {
  final String service;
  final double month;
  final double ytd;
  final double allTime;

  const FinanceRevenueService({
    required this.service,
    this.month = 0,
    this.ytd = 0,
    this.allTime = 0,
  });

  factory FinanceRevenueService.fromJson(Map<String, dynamic> j) =>
      FinanceRevenueService(
        service: j['service']?.toString() ?? '—',
        month: asDouble(j['month']),
        ytd: asDouble(j['ytd']),
        allTime: asDouble(j['allTime']),
      );
}

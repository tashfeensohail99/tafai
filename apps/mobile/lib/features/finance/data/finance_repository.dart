import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../../agreements/domain/agreement.dart';
import '../domain/finance_models.dart';

/// All Finance REST calls. Every method catches [DioException] and rethrows a
/// typed [AppError] via [mapDioError] — exactly the Sales/leads convention.
///
/// Endpoints used here are ONLY those the web client (apps/frontend/lib/
/// finance-api.ts, finance-profile.ts, agreements.ts) already calls — no
/// invented routes.
class FinanceRepository {
  final Dio _c;
  FinanceRepository(this._c);

  // ── Customers ──────────────────────────────────────────────────────────

  /// GET /finance/customer[?search=] — the searchable customer pipeline list.
  Future<List<FinanceCustomerRow>> customers({String? search}) async {
    try {
      final res = await _c.get<List<dynamic>>(
        '/finance/customer',
        queryParameters: <String, dynamic>{
          if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        },
      );
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FinanceCustomerRow.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /finance/customer/:leadId — the aggregated customer profile.
  Future<FinanceCustomerProfile> customerProfile(String leadId) async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/finance/customer/$leadId');
      return FinanceCustomerProfile.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Dashboard / queue ────────────────────────────────────────────────────

  /// GET /finance/handovers[?status=] — the verification queue + history.
  Future<List<FinanceDashboardHandover>> handovers({String? status}) async {
    try {
      final res = await _c.get<List<dynamic>>(
        '/finance/handovers',
        queryParameters: <String, dynamic>{
          if (status != null) 'status': status,
        },
      );
      return (res.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FinanceDashboardHandover.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /finance/revenue/by-service — collection totals for the dashboard.
  Future<FinanceRevenue> revenueByService() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/finance/revenue/by-service');
      return FinanceRevenue.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /agreements/review-counts → { financeToReview, salesChangesRequested }.
  Future<int> agreementsToReviewCount() async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/agreements/review-counts');
      final v = res.data?['financeToReview'];
      return v is num ? v.toInt() : int.tryParse('$v') ?? 0;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Agreements queue ─────────────────────────────────────────────────────

  /// GET /agreements — the firm-wide agreements list (Finance review queue).
  /// Reuses the rich [Agreement] domain that already maps this exact JSON.
  Future<List<Agreement>> agreements() async {
    try {
      final res = await _c.get<dynamic>('/agreements');
      final data = res.data;
      final List<dynamic> raw = data is List
          ? data
          : (data is Map<String, dynamic> && data['items'] is List
              ? data['items'] as List<dynamic>
              : const []);
      return raw
          .whereType<Map<String, dynamic>>()
          .map(Agreement.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Payment verification (maker-checker enforced server-side) ─────────────

  /// POST /finance/handovers/:id/review — { action }.
  /// `action` ∈ MARK_IN_REVIEW | RECORD_PAYMENT | REJECT. Returns the updated
  /// handover JSON so the caller can read back `payment.id`.
  Future<FinanceDashboardHandover> reviewHandover(
    String handoverId,
    String action, {
    String? financeNotes,
  }) async {
    try {
      final res = await _c.post<Map<String, dynamic>>(
        '/finance/handovers/$handoverId/review',
        data: <String, dynamic>{
          'action': action,
          if (financeNotes != null && financeNotes.trim().isNotEmpty)
            'financeNotes': financeNotes.trim(),
        },
      );
      return FinanceDashboardHandover.fromJson(res.data ?? const {});
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /finance/payments/:id/verify — { notes? }.
  ///
  /// Can be rejected by maker-checker: the server returns 403 (this user lacks
  /// the verify permission) or 409 (the same officer recorded the payment, so a
  /// DIFFERENT officer must verify it above the org threshold). The caller
  /// surfaces these as a clear message rather than a generic error.
  Future<void> verifyPayment(String paymentId, {String? note}) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/finance/payments/$paymentId/verify',
        // Backend VerifyPaymentDto only accepts `notes` (forbidNonWhitelisted).
        data: (note != null && note.trim().isNotEmpty)
            ? {'notes': note.trim()}
            : <String, dynamic>{},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Agreements ─────────────────────────────────────────────────────────

  /// POST /agreements/:id/approve — locks the plan, creates the contract +
  /// installment ledger.
  Future<void> approveAgreement(String agreementId) async {
    try {
      await _c.post<Map<String, dynamic>>('/agreements/$agreementId/approve');
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /agreements/:id/request-changes — { note }. Bounces back to Sales.
  Future<void> requestAgreementChanges(
    String agreementId,
    String note,
  ) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/agreements/$agreementId/request-changes',
        data: {'note': note},
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// POST /agreements/:id/upload-signed (multipart) — uploads the client's
  /// signed PDF. Keyed by AGREEMENT id (the contract materialises on first
  /// upload). [filePath] is a local device path from file_picker.
  Future<void> uploadSignedAgreement(
    String agreementId, {
    required String filePath,
    String? fileName,
  }) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      await _c.post<Map<String, dynamic>>(
        '/agreements/$agreementId/upload-signed',
        data: form,
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /agreements/:id/pdf-url → { url } — short-lived signed S3 URL for the
  /// approved/sent/signed agreement PDF. Opened in the device browser.
  Future<String> agreementPdfUrl(String agreementId) async {
    try {
      final res =
          await _c.get<Map<String, dynamic>>('/agreements/$agreementId/pdf-url');
      return res.data?['url'] as String? ?? '';
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /finance/service-contracts/:id/agreement-url → { url, fileName } —
  /// signed URL to the stored signed-agreement copy on a contract.
  Future<String> contractAgreementUrl(String contractId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/finance/service-contracts/$contractId/agreement-url',
      );
      return res.data?['url'] as String? ?? '';
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // ── Expenses ───────────────────────────────────────────────────────────

  /// POST /finance/expenses — record a disbursement spent on the client's
  /// behalf (cost side of the ledger). [leadId], [description] and [amount]
  /// (a numeric string, e.g. "1500.00") are required; the rest are optional.
  /// [category] is an ExpenseCategory enum name, [incurredAt] an ISO-8601 date.
  Future<void> createExpense({
    required String leadId,
    required String description,
    required String amount,
    String? caseId,
    String? category,
    String? taxAmount,
    String? currency,
    String? incurredAt,
    bool? billable,
  }) async {
    try {
      await _c.post<Map<String, dynamic>>(
        '/finance/expenses',
        data: <String, dynamic>{
          'leadId': leadId,
          'description': description.trim(),
          'amount': amount,
          if (caseId != null && caseId.isNotEmpty) 'caseId': caseId,
          if (category != null && category.isNotEmpty) 'category': category,
          if (taxAmount != null && taxAmount.trim().isNotEmpty)
            'taxAmount': taxAmount.trim(),
          if (currency != null && currency.trim().isNotEmpty)
            'currency': currency.trim(),
          if (incurredAt != null && incurredAt.isNotEmpty)
            'incurredAt': incurredAt,
          if (billable != null) 'billable': billable,
        },
      );
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /finance/expenses/:id/receipt-url → { url, fileName } — signed URL to
  /// the expense's attached receipt. Opened in the device browser.
  Future<String> expenseReceiptUrl(String expenseId) async {
    try {
      final res = await _c.get<Map<String, dynamic>>(
        '/finance/expenses/$expenseId/receipt-url',
      );
      return res.data?['url'] as String? ?? '';
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final financeRepositoryProvider = Provider<FinanceRepository>((ref) {
  return FinanceRepository(ref.watch(apiClientProvider));
});

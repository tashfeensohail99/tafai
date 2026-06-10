import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/agreement.dart';
import 'agreements_repository.dart';

/// List of agreements for a given lead.
final leadAgreementsProvider =
    FutureProvider.family<List<Agreement>, String>((ref, leadId) {
  return ref.read(agreementsRepositoryProvider).listForLead(leadId);
});

/// Single agreement detail.
final agreementDetailProvider =
    FutureProvider.family<Agreement, String>((ref, id) {
  return ref.read(agreementsRepositoryProvider).get(id);
});

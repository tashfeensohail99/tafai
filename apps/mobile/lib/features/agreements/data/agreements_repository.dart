import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../domain/agreement.dart';

class AgreementsRepository {
  final Dio _c;
  AgreementsRepository(this._c);

  /// GET /agreements?leadId=<id>
  Future<List<Agreement>> listForLead(String leadId) async {
    try {
      final res = await _c.get<dynamic>(
        '/agreements',
        queryParameters: {'leadId': leadId},
      );
      final data = res.data;
      final List<dynamic> raw;
      if (data is List) {
        raw = data;
      } else if (data is Map<String, dynamic> && data['items'] is List) {
        raw = data['items'] as List<dynamic>;
      } else {
        raw = const [];
      }
      return raw
          .whereType<Map<String, dynamic>>()
          .map(Agreement.fromJson)
          .toList();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /agreements/:id
  Future<Agreement> get(String id) async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/agreements/$id');
      return Agreement.fromJson(res.data!);
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  /// GET /agreements/:id/pdf-url → { url }
  Future<String> pdfUrl(String id) async {
    try {
      final res = await _c.get<Map<String, dynamic>>('/agreements/$id/pdf-url');
      return res.data!['url'] as String;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final agreementsRepositoryProvider = Provider<AgreementsRepository>((ref) {
  return AgreementsRepository(ref.watch(apiClientProvider));
});

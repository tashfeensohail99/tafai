import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/error_mapper.dart';
import '../../../core/util/parsers.dart';

class Employee {
  final String id;
  final String firstName;
  final String lastName;
  final String? email;
  final String? code;

  const Employee({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.email,
    this.code,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory Employee.fromJson(Map<String, dynamic> j) => Employee(
        id: j['id'] as String? ?? '',
        firstName: j['firstName'] as String? ?? '',
        lastName: j['lastName'] as String? ?? '',
        email: asStringOrNull(j['email']),
        code: asStringOrNull(j['code']),
      );
}

class EmployeesRepository {
  final Dio _c;
  EmployeesRepository(this._c);

  Future<List<Employee>> list() async {
    try {
      final res = await _c.get<dynamic>(
        '/employees',
        queryParameters: {'limit': '500'},
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
          .map(Employee.fromJson)
          .toList()
        ..sort((a, b) => a.fullName.compareTo(b.fullName));
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }
}

final employeesRepositoryProvider = Provider<EmployeesRepository>((ref) {
  return EmployeesRepository(ref.watch(apiClientProvider));
});

/// Cached employee roster for the session (re-fetch on demand).
final employeesListProvider = FutureProvider<List<Employee>>((ref) {
  return ref.read(employeesRepositoryProvider).list();
});

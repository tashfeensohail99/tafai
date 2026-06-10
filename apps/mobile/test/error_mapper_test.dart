import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tafsheen_mobile/core/errors/app_error.dart';
import 'package:tafsheen_mobile/core/errors/error_mapper.dart';

DioException _err(int status, dynamic data) => DioException(
      requestOptions: RequestOptions(path: '/x'),
      type: DioExceptionType.badResponse,
      response: Response(
        requestOptions: RequestOptions(path: '/x'),
        statusCode: status,
        data: data,
      ),
    );

void main() {
  group('mapDioError', () {
    test('409 → ConflictError with parsed suggestedAt', () {
      final e = mapDioError(_err(409, {
        'message': 'That time is already booked.',
        'suggestedAt': '2026-06-10T09:00:00Z',
      }));
      expect(e, isA<ConflictError>());
      final c = e as ConflictError;
      expect(c.message, 'That time is already booked.');
      expect(c.suggestedAt!.toUtc(), DateTime.utc(2026, 6, 10, 9));
    });

    test('401 / 403 / 404 map to typed errors', () {
      expect(mapDioError(_err(401, <String, dynamic>{})),
          isA<UnauthorizedError>());
      expect(
          mapDioError(_err(403, <String, dynamic>{})), isA<ForbiddenError>());
      expect(mapDioError(_err(404, {'message': 'nope'})), isA<NotFoundError>());
    });

    test('400 with errors map → ValidationError', () {
      final e = mapDioError(_err(400, {
        'errors': {
          'phone': ['required'],
        },
      }));
      expect(e, isA<ValidationError>());
    });

    test('connection timeout → NetworkError', () {
      final e = mapDioError(DioException(
        requestOptions: RequestOptions(path: '/x'),
        type: DioExceptionType.connectionTimeout,
      ));
      expect(e, isA<NetworkError>());
    });
  });
}

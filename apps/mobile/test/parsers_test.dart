import 'package:flutter_test/flutter_test.dart';
import 'package:tafsheen_mobile/core/util/parsers.dart';

void main() {
  group('parsers', () {
    test('asInt handles int / num / string / fallback', () {
      expect(asInt(5), 5);
      expect(asInt(5.9), 5);
      expect(asInt('7'), 7);
      expect(asInt(null), 0);
      expect(asInt('not-a-number', 3), 3);
    });

    test('asStringOrNull nulls out empty/null', () {
      expect(asStringOrNull(null), isNull);
      expect(asStringOrNull(''), isNull);
      expect(asStringOrNull('a'), 'a');
      expect(asStringOrNull(5), '5');
    });

    test('parseApiDate parses ISO and falls back to epoch', () {
      expect(parseApiDate('2026-06-10T04:00:00Z').toUtc(),
          DateTime.utc(2026, 6, 10, 4));
      expect(parseApiDate(null).millisecondsSinceEpoch, 0);
      expect(parseApiDate('garbage').millisecondsSinceEpoch, 0);
    });

    test('parseApiDateOrNull returns null on empty', () {
      expect(parseApiDateOrNull(null), isNull);
      expect(parseApiDateOrNull(''), isNull);
      expect(parseApiDateOrNull('2026-06-10T04:00:00Z')!.toUtc(),
          DateTime.utc(2026, 6, 10, 4));
    });
  });
}

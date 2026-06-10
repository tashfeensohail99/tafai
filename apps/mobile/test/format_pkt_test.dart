import 'package:flutter_test/flutter_test.dart';
import 'package:tafsheen_mobile/core/util/format.dart';

void main() {
  // These must hold regardless of the host machine's timezone — the whole
  // point of the PKT helpers is that appointment/slot times render as Pakistan
  // office hours everywhere.
  group('PKT formatting (timezone-independent)', () {
    test('pktTime renders office hours from UTC instants', () {
      expect(pktTime(DateTime.utc(2026, 6, 10, 4, 0)), '9:00 AM'); // 04:00Z + 5h
      expect(pktTime(DateTime.utc(2026, 6, 10, 13, 30)), '6:30 PM');
      expect(pktTime(DateTime.utc(2026, 6, 10, 7, 0)), '12:00 PM'); // noon PKT
      expect(pktTime(DateTime.utc(2026, 6, 10, 19, 0)), '12:00 AM'); // midnight
    });

    test('pktDateTime includes the PKT time', () {
      expect(pktDateTime(DateTime.utc(2026, 6, 10, 4, 0)), contains('9:00 AM'));
    });
  });
}

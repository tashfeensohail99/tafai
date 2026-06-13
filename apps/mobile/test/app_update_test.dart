import 'package:flutter_test/flutter_test.dart';
import 'package:tafsheen_mobile/core/update/app_update.dart';

void main() {
  group('isNewerVersion', () {
    test('a higher build number is newer', () {
      expect(isNewerVersion('1.0.7+8', '1.0.6+7'), isTrue);
      expect(isNewerVersion('1.0.7+9', '1.0.7+8'), isTrue);
    });

    test('a higher patch/minor/major is newer', () {
      expect(isNewerVersion('1.0.7+8', '1.0.6+8'), isTrue);
      expect(isNewerVersion('1.1.0+1', '1.0.9+9'), isTrue);
      expect(isNewerVersion('2.0.0+1', '1.9.9+9'), isTrue);
    });

    test('the same version is not newer', () {
      expect(isNewerVersion('1.0.7+8', '1.0.7+8'), isFalse);
    });

    test('an older version is not newer', () {
      expect(isNewerVersion('1.0.6+7', '1.0.7+8'), isFalse);
      expect(isNewerVersion('1.0.7+7', '1.0.7+8'), isFalse);
    });

    test('tolerates a missing build segment', () {
      // "1.1.0" (no +build) vs "1.0.9+5" → still newer by minor.
      expect(isNewerVersion('1.1.0', '1.0.9+5'), isTrue);
      // Equal core, one missing build → treated as build 0, not newer.
      expect(isNewerVersion('1.0.7', '1.0.7+1'), isFalse);
    });

    test('tolerates non-numeric noise without throwing', () {
      expect(isNewerVersion('1.0.7+8', 'garbage'), isTrue);
      expect(isNewerVersion('', '1.0.0+1'), isFalse);
    });
  });
}

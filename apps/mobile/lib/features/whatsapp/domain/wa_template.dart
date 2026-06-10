import '../../../core/util/parsers.dart';

/// A WhatsApp channel (phone number + name).
class WaChannel {
  final String id;
  final String name;
  final String? phoneNumber;

  const WaChannel({required this.id, required this.name, this.phoneNumber});

  factory WaChannel.fromJson(Map<String, dynamic> j) => WaChannel(
        id: j['id'] as String? ?? '',
        name: j['name'] as String? ?? '',
        phoneNumber: asStringOrNull(j['phoneNumber'] ?? j['phone']),
      );
}

/// A Meta-approved WhatsApp message template.
class WaTemplate {
  final String id;
  final String name;
  final String language;
  final String category;
  final List<dynamic> components; // raw JSON components from Meta

  const WaTemplate({
    required this.id,
    required this.name,
    required this.language,
    required this.category,
    required this.components,
  });

  /// Extract body text (with {{N}} placeholders).
  String? get bodyText {
    for (final c in components) {
      if (c is Map<String, dynamic> &&
          (c['type'] as String?)?.toUpperCase() == 'BODY') {
        return c['text'] as String?;
      }
    }
    return null;
  }

  /// Number of {{N}} variables in the body.
  List<String> get bodyVariables {
    final text = bodyText ?? '';
    final matches = RegExp(r'\{\{(\d+)\}\}').allMatches(text);
    // Return unique sorted placeholder indices as strings.
    final seen = <String>{};
    final out = <String>[];
    for (final m in matches) {
      final key = m.group(1)!;
      if (seen.add(key)) out.add(key);
    }
    out.sort((a, b) => int.parse(a).compareTo(int.parse(b)));
    return out;
  }

  factory WaTemplate.fromJson(Map<String, dynamic> j) => WaTemplate(
        id: j['id'] as String? ?? '',
        name: j['name'] as String? ?? '',
        language: j['language'] as String? ?? 'en',
        category: j['category'] as String? ?? '',
        components: j['components'] as List<dynamic>? ?? const [],
      );
}

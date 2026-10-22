import '../../../core/util/parsers.dart';

/// On-demand AI summary of a WhatsApp chat — mirrors the web Summary panel's
/// `POST /whatsapp/threads/:id/summary` payload. Tolerant to missing/odd fields
/// (default strings to '', bools to false, generatedAt via DateTime.tryParse)
/// so a slightly off response never blanks the sheet.
class ThreadSummary {
  /// One-paragraph recap of where the conversation stands.
  final String summary;

  /// The suggested next step for the rep.
  final String suggestion;

  /// A ready-to-send draft reply (in the customer's language).
  final String draftReply;

  /// "en" | "ur_roman" — the language the AI drafted in.
  final String language;

  /// How many messages were read to produce this.
  final int messageCount;

  /// True when this came from the server-side cache (vs freshly generated).
  final bool cached;

  /// When the (cached) summary was generated. Null on empty / unknown.
  final DateTime? generatedAt;

  /// True on a thread with no messages — the text fields are then all "".
  final bool empty;

  const ThreadSummary({
    this.summary = '',
    this.suggestion = '',
    this.draftReply = '',
    this.language = 'en',
    this.messageCount = 0,
    this.cached = false,
    this.generatedAt,
    this.empty = false,
  });

  factory ThreadSummary.fromJson(Map<String, dynamic> j) => ThreadSummary(
        summary: (j['summary'] ?? '').toString(),
        suggestion: (j['suggestion'] ?? '').toString(),
        draftReply: (j['draftReply'] ?? '').toString(),
        language: (j['language'] ?? 'en').toString(),
        messageCount: asInt(j['messageCount']),
        cached: j['cached'] == true,
        generatedAt: parseApiDateOrNull(j['generatedAt']),
        empty: j['empty'] == true,
      );
}

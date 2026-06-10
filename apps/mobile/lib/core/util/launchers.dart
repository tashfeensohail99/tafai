import 'package:url_launcher/url_launcher.dart';

/// Thin wrappers around url_launcher for the lead quick-actions. Each returns
/// false if no app on the device can handle the intent (e.g. no dialer, or
/// WhatsApp not installed) so callers can show a friendly message.

/// Keep digits and a leading '+', drop spaces/dashes/parentheses.
String _clean(String phone) => phone.replaceAll(RegExp(r'[^\d+]'), '');

/// Open the dialer with the number pre-filled (does not place the call).
Future<bool> callNumber(String phone) async {
  final n = _clean(phone);
  if (n.isEmpty) return false;
  return launchUrl(Uri(scheme: 'tel', path: n));
}

/// Open a WhatsApp chat with the number (wa.me needs no leading '+').
Future<bool> openWhatsApp(String phone, {String? text}) async {
  var n = _clean(phone);
  if (n.startsWith('+')) n = n.substring(1);
  if (n.isEmpty) return false;
  final q = (text != null && text.isNotEmpty)
      ? '?text=${Uri.encodeComponent(text)}'
      : '';
  return launchUrl(
    Uri.parse('https://wa.me/$n$q'),
    mode: LaunchMode.externalApplication,
  );
}

/// Open the mail composer addressed to [email].
Future<bool> sendEmail(String email, {String? subject}) async {
  if (email.isEmpty) return false;
  return launchUrl(Uri(
    scheme: 'mailto',
    path: email,
    query: (subject != null && subject.isNotEmpty)
        ? 'subject=${Uri.encodeComponent(subject)}'
        : null,
  ));
}

/// Open an arbitrary http(s) URL in the browser / external app.
Future<bool> openExternalUrl(String url) async {
  if (url.isEmpty) return false;
  return launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
}

import '../router/app_router.dart';

/// Resolves which portal home route a freshly-authenticated user lands on,
/// from their roles. ONE source of truth for login routing.
///
/// Mirrors the web's `destinationForUser` (apps/frontend/lib/session.ts): a
/// user may hold MULTIPLE roles, so this is PRIORITY-ORDERED, not `roles.first`.
/// Roles are LOWERCASE (verified against the Prisma seed + web session) — a
/// switch on uppercase values would silently never match and route everyone to
/// the fallback.
///
/// Priority (most-specific / external first; Sales is the catch-all): the same
/// order the web uses — client, then sales, then finance, then processing.
/// admin / super_admin / support / marketing / partner (no dedicated mobile
/// portal yet) and any unknown role fall through to the Sales shell.
String homeRouteForRoles(List<String> roles) {
  final r = roles.map((e) => e.toLowerCase()).toSet();
  if (r.contains('client')) return AppRoutes.clientHome;
  if (r.contains('sales') || r.contains('sales_manager')) return AppRoutes.home;
  if (r.contains('finance') || r.contains('finance_manager')) {
    return AppRoutes.financeHome;
  }
  if (r.contains('processing') ||
      r.contains('processing_manager') ||
      r.contains('documentation')) {
    return AppRoutes.processingHome;
  }
  return AppRoutes.home; // Sales shell = safe default.
}

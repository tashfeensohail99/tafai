/// Shared API base URL. Mirrors the default baked into `api_client.dart`.
/// Override at build time with:
///   --dart-define=API_BASE_URL=http://10.0.2.2:3001
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://backend-production-5a89.up.railway.app',
);

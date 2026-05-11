/// Domain model for the currently authenticated user.
/// Mirrors the JWT payload returned by POST /auth/me.
class AuthUser {
  final String id;
  final String email;
  final List<String> roles;
  final List<String> permissions;
  final bool mustChangePassword;

  const AuthUser({
    required this.id,
    required this.email,
    required this.roles,
    required this.permissions,
    required this.mustChangePassword,
  });

  bool hasPermission(String key) => permissions.contains(key);

  bool hasAnyPermission(List<String> keys) =>
      keys.any((k) => permissions.contains(k));

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String,
        email: json['email'] as String,
        roles: List<String>.from(json['roles'] as List? ?? []),
        permissions: List<String>.from(json['permissions'] as List? ?? []),
        mustChangePassword: json['mustChangePassword'] as bool? ?? false,
      );
}

/// Domain model for the currently authenticated user.
/// Mirrors the payload returned by GET /auth/me.
class AuthUser {
  final String id;
  final String email;
  final List<String> roles;
  final List<String> permissions;
  final bool mustChangePassword;
  final Employee? employee;

  const AuthUser({
    required this.id,
    required this.email,
    required this.roles,
    required this.permissions,
    required this.mustChangePassword,
    this.employee,
  });

  bool hasPermission(String key) => permissions.contains(key);

  bool hasAnyPermission(List<String> keys) =>
      keys.any((k) => permissions.contains(k));

  /// Best-effort human name: employee full name, else the email local-part.
  String get displayName {
    final name = employee?.fullName.trim() ?? '';
    if (name.isNotEmpty) return name;
    final at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : email;
  }

  /// 1–2 letter avatar initials.
  String get initials {
    final e = employee;
    if (e != null) {
      final f = e.firstName.trim();
      final l = e.lastName.trim();
      final a = f.isNotEmpty ? f[0] : '';
      final b = l.isNotEmpty ? l[0] : '';
      final combined = (a + b).toUpperCase();
      if (combined.isNotEmpty) return combined;
    }
    return email.isNotEmpty ? email[0].toUpperCase() : '?';
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String,
        email: json['email'] as String,
        roles: List<String>.from(json['roles'] as List? ?? const []),
        permissions:
            List<String>.from(json['permissions'] as List? ?? const []),
        mustChangePassword: json['mustChangePassword'] as bool? ?? false,
        employee: json['employee'] is Map<String, dynamic>
            ? Employee.fromJson(json['employee'] as Map<String, dynamic>)
            : null,
      );
}

class Employee {
  final String id;
  final String firstName;
  final String lastName;
  final EmployeeDepartment? department;

  const Employee({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.department,
  });

  String get fullName => '$firstName $lastName'.trim();

  factory Employee.fromJson(Map<String, dynamic> json) => Employee(
        id: json['id'] as String? ?? '',
        firstName: json['firstName'] as String? ?? '',
        lastName: json['lastName'] as String? ?? '',
        department: json['department'] is Map<String, dynamic>
            ? EmployeeDepartment.fromJson(
                json['department'] as Map<String, dynamic>)
            : null,
      );
}

class EmployeeDepartment {
  final String id;
  final String name;

  const EmployeeDepartment({required this.id, required this.name});

  factory EmployeeDepartment.fromJson(Map<String, dynamic> json) =>
      EmployeeDepartment(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

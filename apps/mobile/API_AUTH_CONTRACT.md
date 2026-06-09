# Tafsheen Mobile — API Auth Contract

Version: Week 2
Backend base URL: `http://10.0.2.2:3001` (Android emulator) / `http://localhost:3001` (iOS sim)

---

## Authentication Model

- Access token: short-lived JWT (default 15 min), stored **in memory only** (never in SharedPreferences or local storage)
- Refresh token: long-lived (default 7 days), stored in **FlutterSecureStorage** (device keychain)
- Both tokens rotate on every refresh call
- Account locks for 15 minutes after 5 consecutive failed login attempts

---

## Endpoints

### POST /auth/login

Authenticate with email and password.

**Request body**
```json
{
  "email": "admin@tashfeen.com",
  "password": "Admin@123456"
}
```

**Success 200** — returns **tokens only**. Call `GET /auth/me` immediately after
login to load the user, roles, permissions, `mustChangePassword`, and employee
profile (that enriched payload is documented under `/auth/me` below).
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<uuid>"
}
```

**Errors**
| Status | Cause |
|--------|-------|
| 401 | Invalid credentials |
| 429 | Too many requests (throttle) |
| 423 | Account locked (5 failed attempts) |

---

### POST /auth/refresh

Rotate the access token using a refresh token. Old refresh token is invalidated.

**Request body**
```json
{
  "refreshToken": "<uuid stored in secure storage>"
}
```

**Success 201**
```json
{
  "accessToken": "<new jwt>",
  "refreshToken": "<new uuid>"
}
```

**Errors**
| Status | Cause |
|--------|-------|
| 401 | Refresh token invalid, expired, or revoked |

---

### POST /auth/logout

Revokes **all** sessions for the authenticated user.
Requires `Authorization: Bearer <accessToken>` header.

**Request body**: none

**Success 200**
```json
{ "message": "Logged out successfully" }
```

---

### GET /auth/me

Returns the current authenticated user's profile and permissions.
Requires `Authorization: Bearer <accessToken>` header.

**Success 200**
```json
{
  "id": "uuid",
  "email": "admin@tashfeen.com",
  "roles": ["super_admin"],
  "permissions": ["leads.view_all", "leads.create", "..."],
  "mustChangePassword": false,
  "employee": {
    "id": "uuid",
    "firstName": "Admin",
    "lastName": "User",
    "department": { "id": "uuid", "name": "Administration" }
  }
}
```

**Errors**
| Status | Cause |
|--------|-------|
| 401 | Missing or expired access token |

---

### POST /auth/password/change

Change the authenticated user's own password.
Requires `Authorization: Bearer <accessToken>` header.
Must be called immediately when `mustChangePassword: true` is returned.

**Request body**
```json
{
  "currentPassword": "Admin@123456",
  "newPassword": "NewPass@789"
}
```

**Success 200**
```json
{ "message": "Password changed successfully" }
```

**Errors**
| Status | Cause |
|--------|-------|
| 400 | Current password incorrect |
| 422 | New password fails complexity rules |

---

### POST /auth/password/reset-request

Request a password reset email (unauthenticated).
Response is always 200 to prevent user enumeration.

**Request body**
```json
{ "email": "user@tashfeen.com" }
```

**Success 200**
```json
{ "message": "If that email exists, a reset link has been sent." }
```

---

### POST /auth/password/reset

Complete password reset using the token from the email link.

**Request body**
```json
{
  "token": "<reset token from email>",
  "newPassword": "NewPass@789"
}
```

**Success 200**
```json
{ "message": "Password reset successfully" }
```

**Errors**
| Status | Cause |
|--------|-------|
| 400 | Token invalid or expired |

---

## Token Flow (Mobile)

```
App start
  → Read refreshToken from FlutterSecureStorage
  → If exists: POST /auth/refresh
      → Success: store new accessToken in memory, new refreshToken on disk
      → Failure (401): clear all tokens, navigate to /login
  → If not exists: navigate to /login

Every API request
  → Add header: Authorization: Bearer <accessToken>

On any 401 response
  → Dio interceptor auto-calls POST /auth/refresh
  → If refresh succeeds: retry original request once
  → If refresh fails: clear tokens, navigate to /login

Logout (user-initiated)
  → POST /auth/logout (best-effort)
  → Clear FlutterSecureStorage + in-memory token
  → Navigate to /login
```

---

## Permission Keys Reference

The `permissions` array in `/auth/me` and `/auth/login` contains string keys.
Use `AuthUser.hasPermission(key)` in the app to gate UI elements.

| Module | Keys |
|--------|------|
| Leads | `leads.view_all`, `leads.view_assigned`, `leads.create`, `leads.edit`, `leads.delete`, `leads.assign`, `leads.convert`, `leads.export` |
| Clients | `clients.view_all`, `clients.view_assigned`, `clients.create`, `clients.edit` |
| Cases | `cases.view_all`, `cases.view_assigned`, `cases.create`, `cases.edit`, `cases.handover` |
| Documents | `documents.view`, `documents.upload`, `documents.verify`, `documents.reject` |
| Appointments | `appointments.view_all`, `appointments.view_assigned`, `appointments.create`, `appointments.edit`, `appointments.cancel` |
| Finance | `finance.view`, `finance.create_invoice`, `finance.verify_payment`, `finance.refund` |
| Reports | `reports.view`, `reports.export` |
| Users | `users.view`, `users.create`, `users.edit`, `users.deactivate` |
| Roles | `roles.view`, `roles.create`, `roles.edit`, `roles.delete` |
| Settings | `settings.manage` |
| Audit | `audit.view` |

---

## Error Response Format

All API errors follow this shape:

```json
{
  "statusCode": 400,
  "message": "Human readable message or array of validation messages",
  "error": "Bad Request"
}
```

Validation errors (422) may include:
```json
{
  "statusCode": 422,
  "message": ["email must be an email", "password is too weak"],
  "error": "Unprocessable Entity"
}
```

---

## Notes for Flutter Team

1. **Never store the access token on disk.** Use in-memory only. The `TokenStorage` class in `lib/core/auth/token_storage.dart` enforces this.
2. **Never use public URLs for documents.** There is **no** generic `/storage/signed-url` endpoint — file access is **per-entity and permission-checked**. For the sales app the relevant one is **lead files**: `GET /leads/:id/files/:fileId/url` returns a short-lived (5 min) signed URL after a server-side access check (and audits the access). (Other modules expose their own, e.g. `GET /agreements/:id/pdf-url`.)
3. **Permission gate UI elements** using `AuthUser.hasPermission(key)` — but always assume the backend will enforce RBAC independently. Never rely solely on frontend permission hiding.
4. **mustChangePassword flag**: if `true` after login, redirect the user to the change-password screen before allowing any other navigation.
5. **iOS note**: `FlutterSecureStorage` uses the iOS Keychain with `kSecAttrAccessibleWhenUnlocked`. No additional config needed.
6. **Android note**: `AndroidOptions(encryptedSharedPreferences: true)` is already set in `TokenStorage`.

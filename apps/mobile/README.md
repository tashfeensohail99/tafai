# Tafsheen Mobile

Flutter mobile application for the Tafsheen Immigration Solutions platform.

## Flutter SDK Requirement

- Flutter: `>=3.19.0`
- Dart: `>=3.3.0`

## Setup

```bash
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
```

## Run (development)

```bash
# Android emulator (backend at 10.0.2.2:3001)
flutter run

# iOS simulator (backend at localhost:3001)
flutter run --dart-define API_BASE_URL=http://localhost:3001
```

## Project Structure

```
lib/
  core/
    api/          # Dio HTTP client with JWT interceptor + auto-refresh
    auth/         # Token storage (secure storage + in-memory)
    errors/       # Typed AppError sealed class + DioException mapper
    router/       # GoRouter configuration + route constants
    theme/        # Design tokens (mirrors web CSS tokens) + ThemeData
  features/
    auth/
      data/       # AuthRepository (login/logout/refresh/me)
      domain/     # AuthUser model
      presentation/
        screens/  # LoginScreen
        widgets/
    dashboard/
    leads/
    cases/
    documents/
    appointments/
    notifications/
  shared/
    widgets/      # Reusable UI components
    theme/
```

## API Contract

See [API_AUTH_CONTRACT.md](./API_AUTH_CONTRACT.md) for full endpoint documentation,
token storage rules, permission keys reference, and integration notes.

## Architecture Notes

- State: Riverpod (`flutter_riverpod` + `riverpod_annotation`)
- Navigation: GoRouter
- Networking: Dio with auth interceptor
- Tokens: access token in memory only; refresh token in FlutterSecureStorage
- Code generation: `freezed`, `json_serializable`, `riverpod_generator`, `retrofit_generator`

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/app_theme.dart';
import 'core/router/app_router.dart';
import 'features/calls/data/push_service.dart';
import 'features/calls/presentation/call_host.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Initialize Firebase + register the FCM background handler so incoming calls
  // can ring while the app is backgrounded/locked. Guarded: a no-op until a
  // Firebase config (google-services.json) is added.
  await CallPushService.instance.initEarly();
  runApp(const ProviderScope(child: TafsheenApp()));
}

class TafsheenApp extends ConsumerWidget {
  const TafsheenApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: 'Tashfeen',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      // Locked to the polished light theme. The premium cards are designed
      // light-first (white surfaces, light text tokens); honouring the system
      // dark theme made names render dark-on-dark. A dedicated dark theme can
      // be added later as its own design pass.
      themeMode: ThemeMode.light,
      routerConfig: router,
      // Keep the call surface + signaling socket alive above every route.
      builder: (context, child) => CallHost(child: child ?? const SizedBox()),
    );
  }
}

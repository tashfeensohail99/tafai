import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/settings/theme_provider.dart';
import 'core/theme/app_theme.dart';
import 'core/router/app_router.dart';
import 'features/calls/presentation/call_host.dart';

void main() {
  runApp(const ProviderScope(child: TafsheenApp()));
}

class TafsheenApp extends ConsumerWidget {
  const TafsheenApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'Tashfeen',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,
      routerConfig: router,
      // Keep the call surface + signaling socket alive above every route.
      builder: (context, child) => CallHost(child: child ?? const SizedBox()),
    );
  }
}

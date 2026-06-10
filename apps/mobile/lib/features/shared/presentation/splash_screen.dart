import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';

/// Shown while the session is being restored (auth status == unknown).
/// The auth controller flips status on bootstrap, after which the router
/// redirects away from here automatically.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Tashfeen', style: Theme.of(context).textTheme.displayLarge),
            const SizedBox(height: AppTokens.space2),
            Text('Immigration Solutions',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AppTokens.space6),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
          ],
        ),
      ),
    );
  }
}

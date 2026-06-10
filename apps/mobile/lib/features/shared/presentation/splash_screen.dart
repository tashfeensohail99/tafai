import 'package:flutter/material.dart';
import '../../../core/widgets/logo.dart';

/// Shown while the session is being restored (auth status == unknown).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : Colors.white,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TashfeenLogo(
              size: 90,
              showText: true,
              textColor: isDark ? const Color(0xFF94A3B8) : const Color(0xFF6B7280),
            ),
            const SizedBox(height: 52),
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: Color(0xFF2563EB),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

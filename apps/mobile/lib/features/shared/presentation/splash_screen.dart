import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/logo.dart';

/// Shown while the session is being restored (auth status == unknown).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // Always use brand navy — mirrors the company logo banner exactly.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AppTokens.brandNavy,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 104,
                height: 104,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.10),
                  ),
                ),
                alignment: Alignment.center,
                child: const TashfeenLogo(size: 56, showText: false),
              ),
              const SizedBox(height: AppTokens.space6),
              const Text(
                'TASHFEEN',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 5,
                  height: 1.0,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'SALES CRM',
                style: TextStyle(
                  color: AppTokens.brandSilverText,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 3,
                ),
              ),
              const SizedBox(height: 48),
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white.withValues(alpha: 0.5),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

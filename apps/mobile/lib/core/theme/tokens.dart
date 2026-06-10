import 'package:flutter/material.dart';

/// Central design token system — mirrors the web CSS token file.
/// All feature screens must read colors/typography from here,
/// never hardcode hex values directly.
abstract class AppTokens {
  // Brand
  static const primary50 = Color(0xFFEFF6FF);
  static const primary100 = Color(0xFFDBEAFE);
  static const primary500 = Color(0xFF3B82F6);
  static const primary600 = Color(0xFF2563EB);
  static const primary700 = Color(0xFF1D4ED8);
  static const primary800 = Color(0xFF1E40AF);

  // Status
  static const statusSuccess = Color(0xFF16A34A);
  static const statusSuccessBg = Color(0xFFF0FDF4);
  static const statusWarning = Color(0xFFD97706);
  static const statusWarningBg = Color(0xFFFFFBEB);
  static const statusDanger = Color(0xFFDC2626);
  static const statusDangerBg = Color(0xFFFEF2F2);
  static const statusInfo = Color(0xFF2563EB);
  static const statusInfoBg = Color(0xFFEFF6FF);
  static const statusNeutral = Color(0xFF6B7280);
  static const statusNeutralBg = Color(0xFFF9FAFB);

  // Light surface
  static const surfaceLight = Color(0xFFFFFFFF);
  static const surfaceMutedLight = Color(0xFFF9FAFB);
  static const surfaceSubtleLight = Color(0xFFF3F4F6);
  static const borderLight = Color(0xFFE5E7EB);
  static const borderStrongLight = Color(0xFFD1D5DB);

  static const textPrimaryLight = Color(0xFF111827);
  static const textSecondaryLight = Color(0xFF374151);
  static const textMutedLight = Color(0xFF6B7280);
  static const textDisabledLight = Color(0xFF9CA3AF);

  // Dark surface
  static const surfaceDark = Color(0xFF0F172A);
  static const surfaceMutedDark = Color(0xFF1E293B);
  static const surfaceSubtleDark = Color(0xFF334155);
  static const borderDark = Color(0xFF334155);
  static const borderStrongDark = Color(0xFF475569);

  static const textPrimaryDark = Color(0xFFF1F5F9);
  static const textSecondaryDark = Color(0xFFCBD5E1);
  static const textMutedDark = Color(0xFF94A3B8);
  static const textDisabledDark = Color(0xFF64748B);

  // Typography scale
  static const fontSizeXs = 12.0;
  static const fontSizeSm = 14.0;
  static const fontSizeBase = 16.0;
  static const fontSizeLg = 18.0;
  static const fontSizeXl = 20.0;
  static const fontSize2xl = 24.0;
  static const fontSize3xl = 30.0;

  // Spacing
  static const space1 = 4.0;
  static const space2 = 8.0;
  static const space3 = 12.0;
  static const space4 = 16.0;
  static const space5 = 20.0;
  static const space6 = 24.0;
  static const space8 = 32.0;
  static const space10 = 40.0;
  static const space12 = 48.0;
  static const space16 = 64.0;

  // Border radius
  static const radiusSm = Radius.circular(4);
  static const radiusMd = Radius.circular(8);
  static const radiusLg = Radius.circular(12);
  static const radiusXl = Radius.circular(18);
  static const radius2xl = Radius.circular(24);
  static const radiusFull = Radius.circular(9999);

  // WhatsApp chat colors
  static const waTeal = Color(0xFF128C7E);
  static const waTealDark = Color(0xFF075E54);
  static const waBubbleOut = Color(0xFFDCF8C6);
  static const waBubbleOutText = Color(0xFF111827);
  static const waBubbleIn = Color(0xFFFFFFFF);
  static const waBubbleInText = Color(0xFF111827);
  static const waChatBg = Color(0xFFECE5DD);
  // Dark mode WA
  static const waBubbleOutDark = Color(0xFF005C4B);
  static const waBubbleOutTextDark = Color(0xFFE9FFEA);
  static const waBubbleInDark = Color(0xFF1F2C34);
  static const waBubbleInTextDark = Color(0xFFE9EDF0);
  static const waChatBgDark = Color(0xFF0B141A);
  static const waHeaderDark = Color(0xFF1F2C34);
}

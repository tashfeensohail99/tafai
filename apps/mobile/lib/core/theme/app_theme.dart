import 'package:flutter/material.dart';
import 'tokens.dart';

abstract class AppTheme {
  static ThemeData get light => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppTokens.primary600,
          brightness: Brightness.light,
          surface: AppTokens.surfaceLight,
          onSurface: AppTokens.textPrimaryLight,
        ),
        scaffoldBackgroundColor: AppTokens.surfaceMutedLight,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppTokens.surfaceLight,
          foregroundColor: AppTokens.textPrimaryLight,
          elevation: 0,
          surfaceTintColor: Colors.transparent,
        ),
        cardTheme: const CardThemeData(
          color: AppTokens.surfaceLight,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusLg),
            side: BorderSide(color: AppTokens.borderLight),
          ),
        ),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: AppTokens.surfaceLight,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
            borderSide: BorderSide(color: AppTokens.borderStrongLight),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
            borderSide: BorderSide(color: AppTokens.borderStrongLight),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
            borderSide: BorderSide(color: AppTokens.primary600, width: 1.5),
          ),
          contentPadding: EdgeInsets.symmetric(
            horizontal: AppTokens.space4,
            vertical: AppTokens.space3,
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTokens.primary600,
            foregroundColor: Colors.white,
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.all(AppTokens.radiusMd),
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.space6,
              vertical: AppTokens.space3,
            ),
            textStyle: const TextStyle(
              fontSize: AppTokens.fontSizeSm,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        textTheme: const TextTheme(
          displayLarge: TextStyle(fontSize: AppTokens.fontSize3xl, fontWeight: FontWeight.w700, color: AppTokens.textPrimaryLight),
          titleLarge: TextStyle(fontSize: AppTokens.fontSizeXl, fontWeight: FontWeight.w600, color: AppTokens.textPrimaryLight),
          titleMedium: TextStyle(fontSize: AppTokens.fontSizeLg, fontWeight: FontWeight.w600, color: AppTokens.textPrimaryLight),
          bodyLarge: TextStyle(fontSize: AppTokens.fontSizeBase, color: AppTokens.textPrimaryLight),
          bodyMedium: TextStyle(fontSize: AppTokens.fontSizeSm, color: AppTokens.textSecondaryLight),
          bodySmall: TextStyle(fontSize: AppTokens.fontSizeXs, color: AppTokens.textMutedLight),
        ),
      );

  static ThemeData get dark => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppTokens.primary600,
          brightness: Brightness.dark,
          surface: AppTokens.surfaceDark,
          onSurface: AppTokens.textPrimaryDark,
        ),
        scaffoldBackgroundColor: AppTokens.surfaceMutedDark,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppTokens.surfaceDark,
          foregroundColor: AppTokens.textPrimaryDark,
          elevation: 0,
          surfaceTintColor: Colors.transparent,
        ),
        cardTheme: const CardThemeData(
          color: AppTokens.surfaceDark,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusLg),
            side: BorderSide(color: AppTokens.borderDark),
          ),
        ),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: AppTokens.surfaceMutedDark,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
            borderSide: BorderSide(color: AppTokens.borderStrongDark),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
            borderSide: BorderSide(color: AppTokens.borderStrongDark),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
            borderSide: BorderSide(color: AppTokens.primary500, width: 1.5),
          ),
          contentPadding: EdgeInsets.symmetric(
            horizontal: AppTokens.space4,
            vertical: AppTokens.space3,
          ),
        ),
        textTheme: const TextTheme(
          displayLarge: TextStyle(fontSize: AppTokens.fontSize3xl, fontWeight: FontWeight.w700, color: AppTokens.textPrimaryDark),
          titleLarge: TextStyle(fontSize: AppTokens.fontSizeXl, fontWeight: FontWeight.w600, color: AppTokens.textPrimaryDark),
          titleMedium: TextStyle(fontSize: AppTokens.fontSizeLg, fontWeight: FontWeight.w600, color: AppTokens.textPrimaryDark),
          bodyLarge: TextStyle(fontSize: AppTokens.fontSizeBase, color: AppTokens.textPrimaryDark),
          bodyMedium: TextStyle(fontSize: AppTokens.fontSizeSm, color: AppTokens.textSecondaryDark),
          bodySmall: TextStyle(fontSize: AppTokens.fontSizeXs, color: AppTokens.textMutedDark),
        ),
      );
}

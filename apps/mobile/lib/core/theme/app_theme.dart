import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'tokens.dart';

abstract class AppTheme {
  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final surface = isDark ? AppTokens.surfaceDark : AppTokens.surfaceLight;
    final surfaceMuted = isDark ? AppTokens.surfaceMutedDark : AppTokens.surfaceMutedLight;
    final onSurface = isDark ? AppTokens.textPrimaryDark : AppTokens.textPrimaryLight;
    final border = isDark ? AppTokens.borderDark : AppTokens.borderLight;
    final borderStrong = isDark ? AppTokens.borderStrongDark : AppTokens.borderStrongLight;
    final textSecondary = isDark ? AppTokens.textSecondaryDark : AppTokens.textSecondaryLight;
    final textMuted = isDark ? AppTokens.textMutedDark : AppTokens.textMutedLight;

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppTokens.primary600,
        brightness: brightness,
        surface: surface,
        onSurface: onSurface,
      ),
      scaffoldBackgroundColor: isDark ? AppTokens.surfaceDark : AppTokens.pageBackground,
    );

    return base.copyWith(
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: onSurface,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        shadowColor: Colors.black.withValues(alpha: 0.10),
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          color: onSurface,
          letterSpacing: -0.3,
        ),
        iconTheme: IconThemeData(color: onSurface, size: 22),
        actionsIconTheme: IconThemeData(color: onSurface, size: 22),
        systemOverlayStyle: isDark
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark,
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shadowColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.all(AppTokens.radiusCard),
          side: BorderSide(color: border.withValues(alpha: 0.6), width: 0.5),
        ),
        clipBehavior: Clip.antiAlias,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        floatingLabelStyle: const TextStyle(
          color: AppTokens.primary600,
          fontWeight: FontWeight.w500,
        ),
        border: OutlineInputBorder(
          borderRadius: const BorderRadius.all(AppTokens.radiusMd),
          borderSide: BorderSide(color: borderStrong),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: const BorderRadius.all(AppTokens.radiusMd),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(AppTokens.radiusMd),
          borderSide: BorderSide(color: AppTokens.primary600, width: 1.5),
        ),
        errorBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(AppTokens.radiusMd),
          borderSide: BorderSide(color: AppTokens.statusDanger),
        ),
        focusedErrorBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(AppTokens.radiusMd),
          borderSide: BorderSide(color: AppTokens.statusDanger, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppTokens.space4,
          vertical: AppTokens.space3 + 2,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppTokens.primary600,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
          ),
          minimumSize: const Size(double.infinity, 48),
          textStyle: const TextStyle(
            fontSize: AppTokens.fontSizeSm,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.2,
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(AppTokens.radiusMd),
          ),
          textStyle: const TextStyle(
            fontSize: AppTokens.fontSizeSm,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppTokens.primary600,
          textStyle: const TextStyle(
            fontSize: AppTokens.fontSizeSm,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: AppTokens.primary600.withValues(alpha: 0.12),
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? AppTokens.primary600 : textMuted,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppTokens.primary600 : textMuted,
            size: 22,
          );
        }),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AppTokens.surfaceMutedDark : Colors.white,
        selectedColor: AppTokens.brandNavy,
        disabledColor: isDark ? AppTokens.surfaceSubtleDark : AppTokens.borderLight,
        labelStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: isDark ? AppTokens.textPrimaryDark : AppTokens.textSecondaryLight,
        ),
        secondaryLabelStyle: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(20)),
        ),
        side: BorderSide(color: isDark ? AppTokens.borderDark : AppTokens.borderLight),
        elevation: 0,
        pressElevation: 0,
        showCheckmark: false,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          backgroundColor: isDark ? AppTokens.surfaceMutedDark : Colors.white,
          selectedBackgroundColor: AppTokens.brandNavy,
          selectedForegroundColor: Colors.white,
          foregroundColor: isDark ? AppTokens.textMutedDark : AppTokens.textSecondaryLight,
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
          ),
        ),
      ),
      dividerTheme: DividerThemeData(color: border, space: 1, thickness: 1),
      textTheme: TextTheme(
        displayLarge: TextStyle(
          fontSize: AppTokens.fontSize3xl,
          fontWeight: FontWeight.w800,
          color: onSurface,
          letterSpacing: -0.8,
          height: 1.1,
        ),
        displayMedium: TextStyle(
          fontSize: AppTokens.fontSize2xl,
          fontWeight: FontWeight.w700,
          color: onSurface,
          letterSpacing: -0.5,
          height: 1.2,
        ),
        titleLarge: TextStyle(
          fontSize: AppTokens.fontSizeXl,
          fontWeight: FontWeight.w700,
          color: onSurface,
          letterSpacing: -0.3,
        ),
        titleMedium: TextStyle(
          fontSize: AppTokens.fontSizeLg,
          fontWeight: FontWeight.w600,
          color: onSurface,
          letterSpacing: -0.2,
        ),
        titleSmall: TextStyle(
          fontSize: AppTokens.fontSizeBase,
          fontWeight: FontWeight.w600,
          color: onSurface,
        ),
        bodyLarge: TextStyle(
          fontSize: AppTokens.fontSizeBase,
          color: onSurface,
          height: 1.5,
        ),
        bodyMedium: TextStyle(
          fontSize: AppTokens.fontSizeSm,
          color: textSecondary,
          height: 1.4,
        ),
        bodySmall: TextStyle(
          fontSize: AppTokens.fontSizeXs,
          color: textMuted,
          height: 1.3,
        ),
        labelLarge: TextStyle(
          fontSize: AppTokens.fontSizeSm,
          fontWeight: FontWeight.w600,
          color: onSurface,
          letterSpacing: 0.1,
        ),
      ),
    );
  }
}

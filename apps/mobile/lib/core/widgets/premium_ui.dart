/// Shared premium UI component library for the Tashfeen Sales CRM.
///
/// Components:
///   PremiumCard       – white card with multi-layer shadow
///   MetricCard        – KPI card (accent bar + icon + value + label)
///   SectionLabel      – uppercase section header
///   PremiumStatusBadge – refined pill badge with border
///   PremiumSearchBar   – branded search input (ValueListenableBuilder)
///   CrmFilterChip     – navy-selected modern filter chip
///   BucketTabBar      – animated bucket-tab switcher (Overdue / Today / …)
///   CrmActionButton   – filled or outlined CTA button

import 'package:flutter/material.dart';
import '../theme/tokens.dart';

// ─── PremiumCard ──────────────────────────────────────────────────────────────
/// Base card: white background, 14 dp radius, multi-layer shadow.
/// Use instead of [Card] on premium screens.
class PremiumCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? color;
  final BorderRadius? borderRadius;

  const PremiumCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.color,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    final br = borderRadius ?? const BorderRadius.all(AppTokens.radiusCard);
    final bg = color ?? Colors.white;
    final content =
        padding != null ? Padding(padding: padding!, child: child) : child;

    return Container(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: br,
        boxShadow: AppTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: onTap != null
          ? Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onTap,
                borderRadius: br,
                child: content,
              ),
            )
          : content,
    );
  }
}

// ─── MetricCard ───────────────────────────────────────────────────────────────
/// KPI card: 3 px colored top-bar + icon pill + large value + label.
class MetricCard extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  final Color accentColor;

  const MetricCard({
    super.key,
    required this.icon,
    required this.value,
    required this.label,
    required this.accentColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(height: 3, color: accentColor),
          Padding(
            padding: const EdgeInsets.all(AppTokens.space4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: accentColor.withValues(alpha: 0.10),
                    borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                  ),
                  alignment: Alignment.center,
                  child: Icon(icon, color: accentColor, size: 18),
                ),
                const SizedBox(height: AppTokens.space3),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    color: AppTokens.textPrimaryLight,
                    letterSpacing: -0.5,
                    height: 1.0,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppTokens.textMutedLight,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────
class SectionLabel extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const SectionLabel(this.title, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppTokens.textMutedLight,
              letterSpacing: 0.8,
            ),
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

// ─── PremiumStatusBadge ───────────────────────────────────────────────────────
/// Refined pill badge with tinted bg + subtle border.
class PremiumStatusBadge extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;
  final bool compact;

  const PremiumStatusBadge({
    super.key,
    required this.label,
    required this.color,
    this.icon,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : 9,
        vertical: compact ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: const BorderRadius.all(AppTokens.radiusFull),
        border: Border.all(color: color.withValues(alpha: 0.25), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: compact ? 10 : 11, color: color),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: compact ? 10 : 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.1,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── PremiumSearchBar ─────────────────────────────────────────────────────────
/// Branded search input: white card with shadow, navy icon, animated clear.
class PremiumSearchBar extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onChanged;

  const PremiumSearchBar({
    super.key,
    required this.controller,
    required this.hint,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.all(Radius.circular(14)),
            boxShadow: AppTokens.cardShadowSm,
          ),
          child: TextField(
            controller: controller,
            onChanged: onChanged,
            textInputAction: TextInputAction.search,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: AppTokens.textPrimaryLight,
            ),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: const TextStyle(
                color: AppTokens.textMutedLight,
                fontSize: 14,
                fontWeight: FontWeight.w400,
              ),
              prefixIcon: const Padding(
                padding: EdgeInsets.only(left: 4),
                child: Icon(Icons.search_rounded, color: AppTokens.brandNavy, size: 20),
              ),
              prefixIconConstraints: const BoxConstraints(minWidth: 46),
              suffixIcon: value.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close_rounded, size: 18),
                      color: AppTokens.textMutedLight,
                      onPressed: () {
                        controller.clear();
                        onChanged('');
                      },
                    )
                  : null,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: const OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(14)),
                borderSide: BorderSide(
                  color: AppTokens.primary600,
                  width: 1.5,
                ),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 13,
              ),
              isDense: true,
              filled: true,
              fillColor: Colors.white,
            ),
          ),
        );
      },
    );
  }
}

// ─── CrmFilterChip ────────────────────────────────────────────────────────────
/// Modern animated filter chip — navy when selected.
class CrmFilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? selectedColor;
  final int? count;

  const CrmFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.selectedColor,
    this.count,
  });

  @override
  Widget build(BuildContext context) {
    final selColor = selectedColor ?? AppTokens.brandNavy;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? selColor : Colors.white,
          borderRadius: const BorderRadius.all(Radius.circular(20)),
          boxShadow: AppTokens.cardShadowSm,
          border: Border.all(
            color: selected ? selColor : AppTokens.borderLight,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : AppTokens.textSecondaryLight,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
            if (count != null) ...[
              const SizedBox(width: 5),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: selected
                      ? Colors.white.withValues(alpha: 0.25)
                      : AppTokens.borderLight,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    color:
                        selected ? Colors.white : AppTokens.textMutedLight,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ─── BucketTabBar ─────────────────────────────────────────────────────────────
/// Animated pill-tab switcher (Overdue / Today / Upcoming, or Upcoming / Past).
class BucketTabBar extends StatelessWidget {
  final String selected;
  final List<String> buckets;
  final List<String> labels;
  final ValueChanged<String> onSelect;

  const BucketTabBar({
    super.key,
    required this.selected,
    required this.buckets,
    required this.labels,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.all(Radius.circular(12)),
        boxShadow: AppTokens.cardShadowSm,
      ),
      child: Row(
        children: [
          for (var i = 0; i < buckets.length; i++)
            Expanded(child: _TabItem(bucket: buckets[i], label: labels[i], selected: selected, onSelect: onSelect)),
        ],
      ),
    );
  }
}

class _TabItem extends StatelessWidget {
  final String bucket;
  final String label;
  final String selected;
  final ValueChanged<String> onSelect;
  const _TabItem({
    required this.bucket,
    required this.label,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final active = selected == bucket;
    return GestureDetector(
      onTap: () => onSelect(bucket),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppTokens.brandNavy : Colors.transparent,
          borderRadius: const BorderRadius.all(Radius.circular(9)),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            color: active ? Colors.white : AppTokens.textMutedLight,
            fontSize: 13,
            fontWeight: active ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

// ─── CrmActionButton ──────────────────────────────────────────────────────────
/// Premium CTA: filled (navy solid) or outlined (navy border).
class CrmActionButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool filled;
  final Color? color;

  const CrmActionButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.filled = false,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final btnColor = color ?? AppTokens.brandNavy;
    const br = BorderRadius.all(AppTokens.radiusCard);
    const ts = TextStyle(fontSize: 13, fontWeight: FontWeight.w700);
    const sz = Size(0, 36);
    const hPad = EdgeInsets.symmetric(horizontal: 14);

    if (filled) {
      return FilledButton(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: btnColor,
          foregroundColor: Colors.white,
          textStyle: ts,
          minimumSize: sz,
          padding: hPad,
          shape: const RoundedRectangleBorder(borderRadius: br),
        ),
        child: icon != null
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 15),
                  const SizedBox(width: 5),
                  Text(label),
                ],
              )
            : Text(label),
      );
    }

    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: btnColor,
        side: BorderSide(color: btnColor.withValues(alpha: 0.4)),
        textStyle: ts.copyWith(fontWeight: FontWeight.w600),
        minimumSize: sz,
        padding: hPad,
        shape: const RoundedRectangleBorder(borderRadius: br),
      ),
      child: icon != null
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 15),
                const SizedBox(width: 5),
                Text(label),
              ],
            )
          : Text(label),
    );
  }
}

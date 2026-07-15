import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';
import '../domain/processing_models.dart';

/// Shared visual helpers for the Processing module — colour mapping for stages /
/// priorities / doc statuses, plus small reusable widgets (status pill, KPI
/// card, section card). Kept inside the feature dir so it never collides with
/// the other module's helpers.

/// A status colour pair: foreground text + soft background.
class ToneColors {
  final Color fg;
  final Color bg;
  const ToneColors(this.fg, this.bg);
}

ToneColors stageTone(String stage) {
  switch (stage) {
    case 'DOCUMENTS_COLLECTION':
    case 'UNDER_AUTHORITY_REVIEW':
    case 'DOCUMENTS_INCOMPLETE':
    case 'ADDITIONAL_INFO_REQUESTED':
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
    case 'DOCUMENTS_UNDER_REVIEW':
    case 'DECISION_RECEIVED':
    case 'READY_FOR_SUBMISSION':
    case 'SUBMITTED':
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    case 'DOCUMENTS_COMPLETE':
    case 'APPROVED':
    case 'COMPLETED':
      return const ToneColors(AppTokens.statusSuccess, AppTokens.statusSuccessBg);
    case 'REJECTED':
    case 'APPEAL_IN_PROGRESS':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'INTAKE_PENDING':
    case 'CANCELLED':
    case 'JUNK':
    default:
      return const ToneColors(AppTokens.statusNeutral, AppTokens.statusNeutralBg);
  }
}

ToneColors priorityTone(String priority) {
  switch (priority) {
    case 'CRITICAL':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'URGENT':
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
    case 'NORMAL':
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    case 'LOW':
    default:
      return const ToneColors(AppTokens.statusNeutral, AppTokens.statusNeutralBg);
  }
}

ToneColors docStatusTone(String status) {
  switch (status) {
    case 'ACCEPTED':
      return const ToneColors(AppTokens.statusSuccess, AppTokens.statusSuccessBg);
    case 'REJECTED':
    case 'EXPIRED':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'SUBMITTED':
    case 'UPLOADED':
    case 'UNDER_REVIEW':
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    case 'EXPIRING_SOON':
    case 'REQUESTED':
    case 'AWAITING_UPLOAD':
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
    case 'WAIVED':
    case 'NOT_APPLICABLE':
    case 'NOT_SUBMITTED':
    default:
      return const ToneColors(AppTokens.statusNeutral, AppTokens.statusNeutralBg);
  }
}

ToneColors criticalityTone(String criticality) {
  switch (criticality) {
    case 'CRITICAL':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'REQUIRED':
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
    case 'CONDITIONAL':
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    case 'SUPPORTING':
    case 'OPTIONAL':
    default:
      return const ToneColors(AppTokens.statusNeutral, AppTokens.statusNeutralBg);
  }
}

ToneColors taskPriorityTone(String p) {
  switch (p) {
    case 'URGENT':
      return const ToneColors(AppTokens.statusDanger, AppTokens.statusDangerBg);
    case 'HIGH':
      return const ToneColors(AppTokens.statusWarning, AppTokens.statusWarningBg);
    case 'NORMAL':
      return const ToneColors(AppTokens.statusInfo, AppTokens.statusInfoBg);
    case 'LOW':
    default:
      return const ToneColors(AppTokens.statusNeutral, AppTokens.statusNeutralBg);
  }
}

/// A small rounded status pill (label on a soft tinted background).
class StatusPill extends StatelessWidget {
  final String label;
  final ToneColors tone;
  const StatusPill({super.key, required this.label, required this.tone});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: const BorderRadius.all(AppTokens.radiusFull),
        border: Border.all(color: tone.fg.withValues(alpha: 0.22)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: tone.fg,
          fontSize: 11,
          fontWeight: FontWeight.w600,
          height: 1.1,
        ),
      ),
    );
  }
}

/// A premium white card surface — matches the AppTokens card look used across
/// the app (rounded, soft shadow, optional padding).
class SectionCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  const SectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppTokens.space4),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: AppTokens.surfaceLight,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadowSm,
        border: Border.all(color: AppTokens.borderLight),
      ),
      child: child,
    );
  }
}

/// Compact KPI tile for the dashboards.
class KpiCard extends StatelessWidget {
  final String label;
  final String value;
  final String? hint;
  final IconData icon;
  final ToneColors tone;
  const KpiCard({
    super.key,
    required this.label,
    required this.value,
    this.hint,
    required this.icon,
    required this.tone,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTokens.space4),
      decoration: BoxDecoration(
        color: AppTokens.surfaceLight,
        borderRadius: const BorderRadius.all(AppTokens.radiusCard),
        boxShadow: AppTokens.cardShadowSm,
        border: Border.all(color: AppTokens.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: tone.bg,
                  borderRadius: const BorderRadius.all(AppTokens.radiusMd),
                ),
                alignment: Alignment.center,
                child: Icon(icon, size: 16, color: tone.fg),
              ),
              const Spacer(),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: AppTokens.textPrimaryLight,
                  height: 1,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.space2),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppTokens.textPrimaryLight,
            ),
          ),
          if (hint != null) ...[
            const SizedBox(height: 2),
            Text(
              hint!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11,
                color: AppTokens.textMutedLight,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Uppercase muted section label.
class SectionLabel extends StatelessWidget {
  final String text;
  const SectionLabel(this.text, {super.key});

  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
          color: AppTokens.textMutedLight,
        ),
      );
}

/// Person avatar with initials on the single neutral tint.
class InitialsAvatar extends StatelessWidget {
  final String name;
  final double radius;
  const InitialsAvatar({super.key, required this.name, this.radius = 20});

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: radius,
      backgroundColor: AppTokens.avatarTintLight,
      child: Text(
        _initials,
        style: TextStyle(
          color: AppTokens.avatarFg,
          fontWeight: FontWeight.w700,
          fontSize: radius * 0.62,
        ),
      ),
    );
  }
}

/// Convenience: stage pill from a stage code.
StatusPill stagePill(String stage) =>
    StatusPill(label: stageLabel(stage), tone: stageTone(stage));

/// Convenience: priority pill from a priority code.
StatusPill priorityPill(String priority) =>
    StatusPill(label: priorityLabel(priority), tone: priorityTone(priority));

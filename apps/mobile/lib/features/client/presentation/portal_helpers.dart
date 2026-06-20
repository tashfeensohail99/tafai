import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';

/// Shared presentation helpers for the CLIENT portal — colours + small chips
/// used across the Case / Documents / Appointments / Notifications tabs. Kept
/// inside the client feature dir so the module stays self-contained.

/// Tone colour for a backend `severity` ('info' | 'warning' | 'danger' |
/// 'success') used by notifications.
Color severityColor(String severity) => switch (severity) {
      'success' => AppTokens.statusSuccess,
      'warning' => AppTokens.statusWarning,
      'danger' => AppTokens.statusDanger,
      _ => AppTokens.statusInfo,
    };

Color severityBg(String severity) => switch (severity) {
      'success' => AppTokens.statusSuccessBg,
      'warning' => AppTokens.statusWarningBg,
      'danger' => AppTokens.statusDangerBg,
      _ => AppTokens.statusInfoBg,
    };

/// Document-status → (label, fg colour, bg colour). Client-friendly wording.
({String label, Color fg, Color bg}) docStatusStyle(String status) {
  switch (status) {
    case 'ACCEPTED':
    case 'CONDITIONAL_ACCEPT':
      return (
        label: 'Accepted',
        fg: AppTokens.statusSuccess,
        bg: AppTokens.statusSuccessBg
      );
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
      return (
        label: 'Under review',
        fg: AppTokens.statusInfo,
        bg: AppTokens.statusInfoBg
      );
    case 'REJECTED':
    case 'REPLACEMENT_REQUIRED':
      return (
        label: 'Action needed',
        fg: AppTokens.statusDanger,
        bg: AppTokens.statusDangerBg
      );
    case 'EXPIRED':
      return (
        label: 'Expired',
        fg: AppTokens.statusDanger,
        bg: AppTokens.statusDangerBg
      );
    case 'WAIVED':
      return (
        label: 'Not required',
        fg: AppTokens.statusNeutral,
        bg: AppTokens.statusNeutralBg
      );
    default: // NOT_SUBMITTED
      return (
        label: 'Not uploaded',
        fg: AppTokens.statusWarning,
        bg: AppTokens.statusWarningBg
      );
  }
}

/// Appointment-status → (label, fg, bg).
({String label, Color fg, Color bg}) apptStatusStyle(String status) {
  switch (status) {
    case 'CONFIRMED':
      return (
        label: 'Confirmed',
        fg: AppTokens.statusSuccess,
        bg: AppTokens.statusSuccessBg
      );
    case 'COMPLETED':
      return (
        label: 'Completed',
        fg: AppTokens.statusNeutral,
        bg: AppTokens.statusNeutralBg
      );
    case 'CANCELLED':
      return (
        label: 'Cancelled',
        fg: AppTokens.statusDanger,
        bg: AppTokens.statusDangerBg
      );
    case 'NO_SHOW':
      return (
        label: 'Missed',
        fg: AppTokens.statusDanger,
        bg: AppTokens.statusDangerBg
      );
    case 'RESCHEDULED':
      return (
        label: 'Rescheduled',
        fg: AppTokens.statusWarning,
        bg: AppTokens.statusWarningBg
      );
    default: // SCHEDULED
      return (
        label: 'Scheduled',
        fg: AppTokens.statusInfo,
        bg: AppTokens.statusInfoBg
      );
  }
}

/// Icon for a notification `kind`.
IconData notificationIcon(String kind) => switch (kind) {
      'UNREAD_MESSAGE' => Icons.chat_bubble_outline,
      'MISSING_DOCUMENT' => Icons.upload_file_outlined,
      'REJECTED_DOCUMENT' => Icons.report_problem_outlined,
      'EXPIRING_DOCUMENT' => Icons.schedule_outlined,
      'UPCOMING_APPOINTMENT' => Icons.event_outlined,
      'STAGE_CHANGE' => Icons.trending_up,
      _ => Icons.notifications_outlined,
    };

/// A small pill badge with text — used for statuses across the portal tabs.
class PortalPill extends StatelessWidget {
  final String label;
  final Color fg;
  final Color bg;
  final IconData? icon;
  const PortalPill({
    super.key,
    required this.label,
    required this.fg,
    required this.bg,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppTokens.space2, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(AppTokens.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              color: fg,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

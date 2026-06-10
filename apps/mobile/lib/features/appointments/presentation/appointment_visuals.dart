import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';

/// Accent color for an appointment status (badge + dot).
Color appointmentStatusColor(String status) => switch (status) {
      'CONFIRMED' => AppTokens.statusSuccess,
      'SCHEDULED' => AppTokens.statusInfo,
      'RESCHEDULED' => AppTokens.statusWarning,
      'COMPLETED' => AppTokens.statusNeutral,
      'CANCELLED' => AppTokens.statusDanger,
      'NO_SHOW' => AppTokens.statusDanger,
      _ => AppTokens.statusNeutral,
    };

/// Glyph for an appointment type.
IconData appointmentTypeIcon(String type) => switch (type.toUpperCase()) {
      'VIDEO_CALL' => Icons.videocam_outlined,
      'PHONE_CONSULT' => Icons.phone_in_talk_outlined,
      'OFFICE_VISIT' => Icons.meeting_room_outlined,
      'OFFICE_MEETING' => Icons.business_center_outlined,
      _ => Icons.event_outlined,
    };

import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';

Color leadStatusColor(String status) => switch (status) {
      'NEW' => AppTokens.statusInfo,
      'CONTACTED' => AppTokens.primary600,
      'QUALIFIED' => AppTokens.statusSuccess,
      'PROPOSAL_SENT' => AppTokens.statusWarning,
      'FOLLOW_UP' => AppTokens.statusWarning,
      'CONVERTED' => AppTokens.statusSuccess,
      'LOST' => AppTokens.statusDanger,
      _ => AppTokens.statusNeutral,
    };

Color leadPriorityColor(String? priority) => switch (priority) {
      'HOT' => AppTokens.statusDanger,
      'WARM' => AppTokens.statusWarning,
      'COLD' => AppTokens.statusInfo,
      _ => AppTokens.statusNeutral,
    };

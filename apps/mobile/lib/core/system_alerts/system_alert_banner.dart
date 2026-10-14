import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/tokens.dart';
import 'system_alert.dart';

/// Global outage strip shown at the top of every staff shell. Watches
/// [systemAlertsProvider] (polled every 60s) and renders one bar per active
/// alert — red for a critical outage (WhatsApp / calls down), amber for a
/// warning (AI paused). Renders nothing when healthy, and clears the instant
/// the sentinel marks the incident resolved. Mirrors the web SystemAlertBanner.
class SystemAlertBanner extends ConsumerWidget {
  const SystemAlertBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alerts = ref.watch(systemAlertsProvider).valueOrNull ?? const [];
    if (alerts.isEmpty) return const SizedBox.shrink();
    return Material(
      color: Colors.transparent,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [for (final a in alerts) _AlertStrip(alert: a)],
      ),
    );
  }
}

class _AlertStrip extends StatelessWidget {
  const _AlertStrip({required this.alert});

  final SystemAlert alert;

  @override
  Widget build(BuildContext context) {
    final crit = alert.isCritical;
    final fg = crit ? AppTokens.statusDanger : AppTokens.statusWarning;
    final bg = crit ? AppTokens.statusDangerBg : AppTokens.statusWarningBg;
    return Container(
      width: double.infinity,
      color: bg,
      padding: const EdgeInsets.fromLTRB(14, 9, 14, 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            crit ? Icons.error_outline : Icons.warning_amber_rounded,
            color: fg,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${alert.title}. ',
                    style: TextStyle(fontWeight: FontWeight.w700, color: fg),
                  ),
                  TextSpan(text: alert.message, style: TextStyle(color: fg)),
                ],
              ),
              style: const TextStyle(fontSize: 12.5, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

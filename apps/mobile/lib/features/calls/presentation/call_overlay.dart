import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../application/call_controller.dart';
import '../domain/call_models.dart';

/// Full-screen call surface shown above everything when a call is active.
/// Renders an incoming-ring screen or an in-call screen depending on phase.
class CallOverlay extends ConsumerWidget {
  const CallOverlay({super.key});

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(callControllerProvider);
    if (!s.isActive) return const SizedBox.shrink();

    final ctrl = ref.read(callControllerProvider.notifier);
    final isRinging = s.phase == CallPhase.ringing;

    return Positioned.fill(
      child: Material(
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [AppTokens.brandNavy, Color(0xFF142A57)],
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                const SizedBox(height: 48),
                // ── Caller identity ───────────────────────────────────────
                Container(
                  width: 116,
                  height: 116,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white.withValues(alpha: 0.12),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.22),
                      width: 1.5,
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _initials(s.displayName),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 38,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Text(
                    s.displayName,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.3,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                if (s.peerPhone.isNotEmpty && s.peerPhone != s.displayName)
                  Text(
                    s.peerPhone,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.7),
                      fontSize: 14,
                    ),
                  ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (s.phase == CallPhase.connecting ||
                        s.phase == CallPhase.dialing) ...[
                      SizedBox(
                        height: 13,
                        width: 13,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white.withValues(alpha: 0.8),
                        ),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      s.statusLabel,
                      style: TextStyle(
                        color: s.phase == CallPhase.error
                            ? const Color(0xFFFFB4A8)
                            : Colors.white.withValues(alpha: 0.85),
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                        fontFeatures: const [],
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                // ── Controls ──────────────────────────────────────────────
                if (isRinging)
                  _IncomingControls(
                    onAccept: ctrl.acceptIncoming,
                    onDecline: ctrl.decline,
                  )
                else
                  _InCallControls(
                    state: s,
                    onMute: ctrl.toggleMute,
                    onSpeaker: ctrl.toggleSpeaker,
                    onHangup: ctrl.hangup,
                  ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _IncomingControls extends StatelessWidget {
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  const _IncomingControls({required this.onAccept, required this.onDecline});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 48),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _RoundAction(
            icon: Icons.call_end,
            color: AppTokens.statusDanger,
            label: 'Decline',
            onTap: onDecline,
          ),
          _RoundAction(
            icon: Icons.call,
            color: AppTokens.statusSuccess,
            label: 'Accept',
            onTap: onAccept,
          ),
        ],
      ),
    );
  }
}

class _InCallControls extends StatelessWidget {
  final CallState state;
  final VoidCallback onMute;
  final VoidCallback onSpeaker;
  final VoidCallback onHangup;
  const _InCallControls({
    required this.state,
    required this.onMute,
    required this.onSpeaker,
    required this.onHangup,
  });

  @override
  Widget build(BuildContext context) {
    final canControl = state.phase == CallPhase.inCall ||
        state.phase == CallPhase.connecting ||
        state.phase == CallPhase.dialing;
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _SecondaryToggle(
              icon: state.muted ? Icons.mic_off : Icons.mic,
              active: state.muted,
              label: 'Mute',
              onTap: canControl ? onMute : null,
            ),
            const SizedBox(width: 36),
            _SecondaryToggle(
              icon: state.speakerOn ? Icons.volume_up : Icons.volume_down,
              active: state.speakerOn,
              label: 'Speaker',
              onTap: canControl ? onSpeaker : null,
            ),
          ],
        ),
        const SizedBox(height: 30),
        _RoundAction(
          icon: Icons.call_end,
          color: AppTokens.statusDanger,
          label: 'End',
          onTap: onHangup,
        ),
      ],
    );
  }
}

class _RoundAction extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;
  const _RoundAction({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          elevation: 4,
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            child: SizedBox(
              width: 72,
              height: 72,
              child: Icon(icon, color: Colors.white, size: 32),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.85),
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _SecondaryToggle extends StatelessWidget {
  final IconData icon;
  final bool active;
  final String label;
  final VoidCallback? onTap;
  const _SecondaryToggle({
    required this.icon,
    required this.active,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = onTap == null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: active
              ? Colors.white
              : Colors.white.withValues(alpha: disabled ? 0.06 : 0.16),
          shape: const CircleBorder(),
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            child: SizedBox(
              width: 60,
              height: 60,
              child: Icon(
                icon,
                color: active
                    ? AppTokens.brandNavy
                    : Colors.white.withValues(alpha: disabled ? 0.4 : 0.95),
                size: 26,
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.8),
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}

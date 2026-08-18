import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/tokens.dart';
import '../../whatsapp/data/whatsapp_repository.dart';
import '../../whatsapp/domain/wa_thread.dart';
import '../../whatsapp/presentation/thread_screen.dart';
import '../application/call_controller.dart';
import '../domain/call_models.dart';

/// Whether the active-call overlay is minimized to a compact banner so the rep
/// can use the app — open the chat, reply, send media — while the call keeps
/// running (#2 "chat during an active call"). Reset on call end / new ring.
final callMinimizedProvider = StateProvider<bool>((ref) => false);

/// Full-screen call surface shown above everything when a call is active.
/// Renders an incoming-ring screen or an in-call screen depending on phase.
/// Can be minimized to a top banner so the underlying app stays interactive.
class CallOverlay extends ConsumerWidget {
  const CallOverlay({super.key});

  /// Minimize the call and open the caller's WhatsApp chat (resolve by threadId,
  /// else by leadId). The call keeps running under the minimized banner.
  Future<void> _openChat(WidgetRef ref, CallState s) async {
    ref.read(callMinimizedProvider.notifier).state = true;
    try {
      WhatsappThread? t;
      final repo = ref.read(whatsappRepositoryProvider);
      if (s.threadId != null && s.threadId!.isNotEmpty) {
        t = await repo.getThread(s.threadId!);
      } else if (s.leadId != null && s.leadId!.isNotEmpty) {
        t = await repo.byLead(s.leadId!);
      }
      if (t != null) {
        rootNavigatorKey.currentState
            ?.push(MaterialPageRoute(builder: (_) => ThreadScreen(thread: t!)));
      }
    } catch (_) {
      // Best-effort — if the thread can't be resolved the rep can still reach
      // the chat from the inbox (the call stays minimized + running).
    }
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  String _waitingName(CallIncoming w) {
    final n = (w.leadName ?? '').trim();
    return n.isNotEmpty ? n : w.from;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(callControllerProvider);
    if (!s.isActive) return const SizedBox.shrink();

    final ctrl = ref.read(callControllerProvider.notifier);
    final isRinging = s.phase == CallPhase.ringing;
    // Minimized = a compact top banner (an incoming ring is always full-screen).
    final minimized = ref.watch(callMinimizedProvider) && !isRinging;

    if (minimized) {
      return Positioned(
        top: 0,
        left: 0,
        right: 0,
        child: SafeArea(
          bottom: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (s.waiting != null)
                _WaitingCallBanner(
                  name: _waitingName(s.waiting!),
                  onAccept: ctrl.acceptWaiting,
                  onDecline: ctrl.declineWaiting,
                ),
              _MinimizedCallBar(
                state: s,
                onRestore: () =>
                    ref.read(callMinimizedProvider.notifier).state = false,
                onHangup: ctrl.hangup,
              ),
            ],
          ),
        ),
      );
    }

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
                // Call-waiting: a 2nd call arrived while this one is live — show
                // the WhatsApp-style banner at the top so the rep can act on it.
                if (s.waiting != null)
                  _WaitingCallBanner(
                    name: _waitingName(s.waiting!),
                    onAccept: ctrl.acceptWaiting,
                    onDecline: ctrl.declineWaiting,
                  ),
                // Minimize the call → use the app (open the chat, reply) while
                // it keeps running (#2). Incoming rings stay full-screen.
                if (!isRinging)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: IconButton(
                      icon: const Icon(Icons.keyboard_arrow_down,
                          color: Colors.white, size: 30),
                      tooltip: 'Minimize',
                      onPressed: () =>
                          ref.read(callMinimizedProvider.notifier).state = true,
                    ),
                  )
                else
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
                        s.phase == CallPhase.reconnecting ||
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
                    onOpenChat: () => _openChat(ref, s),
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
  final VoidCallback onOpenChat;
  const _InCallControls({
    required this.state,
    required this.onMute,
    required this.onSpeaker,
    required this.onHangup,
    required this.onOpenChat,
  });

  @override
  Widget build(BuildContext context) {
    final canControl = state.phase == CallPhase.inCall ||
        state.phase == CallPhase.reconnecting ||
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
            const SizedBox(width: 28),
            _SecondaryToggle(
              icon: state.speakerOn ? Icons.volume_up : Icons.volume_down,
              active: state.speakerOn,
              label: 'Speaker',
              onTap: canControl ? onSpeaker : null,
            ),
            const SizedBox(width: 28),
            // Open the caller's chat WITHOUT ending the call (minimizes it).
            _SecondaryToggle(
              icon: Icons.chat_bubble_outline,
              active: false,
              label: 'Chat',
              onTap: onOpenChat,
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

/// The compact top banner shown when the call is minimized — caller + status +
/// tap-to-restore + a quick End. Lets the app behind stay interactive so the rep
/// can open the chat and reply while the call keeps running (#2).
class _MinimizedCallBar extends StatelessWidget {
  final CallState state;
  final VoidCallback onRestore;
  final VoidCallback onHangup;
  const _MinimizedCallBar({
    required this.state,
    required this.onRestore,
    required this.onHangup,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
      child: Material(
        color: AppTokens.brandNavy,
        borderRadius: BorderRadius.circular(12),
        elevation: 6,
        child: InkWell(
          onTap: onRestore,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                const Icon(Icons.phone_in_talk, color: Colors.white, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        state.displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 14),
                      ),
                      Text(
                        'On call · ${state.statusLabel} · tap to return',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.75),
                            fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Material(
                  color: AppTokens.statusDanger,
                  shape: const CircleBorder(),
                  child: InkWell(
                    onTap: onHangup,
                    customBorder: const CircleBorder(),
                    child: const SizedBox(
                        width: 40,
                        height: 40,
                        child:
                            Icon(Icons.call_end, color: Colors.white, size: 20)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// WhatsApp-style call-waiting banner: a 2nd inbound call arrived while the rep
/// is already on a call. Shown at the top over the live call. Decline rejects
/// just the new call; the green button ends the current call and answers this one.
class _WaitingCallBanner extends StatelessWidget {
  final String name;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  const _WaitingCallBanner({
    required this.name,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
      child: Material(
        color: const Color(0xFF0F2A1C), // deep green — distinct from the call surface
        borderRadius: BorderRadius.circular(14),
        elevation: 8,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
          child: Row(
            children: [
              const Icon(Icons.phone_in_talk,
                  color: Color(0xFF4ADE80), size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 15),
                    ),
                    const Text(
                      'Incoming WhatsApp call',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _MiniCallButton(
                icon: Icons.call_end,
                color: AppTokens.statusDanger,
                tooltip: 'Decline',
                onTap: onDecline,
              ),
              const SizedBox(width: 10),
              _MiniCallButton(
                icon: Icons.call,
                color: AppTokens.statusSuccess,
                tooltip: 'End current & accept',
                onTap: onAccept,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniCallButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String tooltip;
  final VoidCallback onTap;
  const _MiniCallButton({
    required this.icon,
    required this.color,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: color,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: SizedBox(
            width: 46,
            height: 46,
            child: Icon(icon, color: Colors.white, size: 22),
          ),
        ),
      ),
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

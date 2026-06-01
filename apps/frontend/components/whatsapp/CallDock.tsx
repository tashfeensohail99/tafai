'use client';
// In-CRM WhatsApp softphone (Phase 1). Mounted once globally in EmployeeShell.
// When the backend rings THIS rep (`whatsapp.call.incoming`), a card appears;
// Accept runs the WebRTC handshake (getUserMedia → RTCPeerConnection → answer →
// POST the SDP answer, which the backend relays to Meta) and the rep talks to
// the caller in-browser. Works on laptop + mobile with the tab open.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useWhatsAppEvent } from '@/lib/whatsapp-realtime';

interface IncomingCall {
  callId: string;
  from: string;
  leadName?: string | null;
  leadId?: string | null;
}
type Phase = 'ringing' | 'dialing' | 'connecting' | 'in-call' | 'error';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Resolve once ICE gathering completes (Meta uses non-trickle SDP), capped at 2.5s. */
function waitForIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        clearTimeout(t);
        resolve();
      }
    };
    const t = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    }, 2500);
    pc.addEventListener('icegatheringstatechange', done);
  });
}

export function CallDock() {
  const [call, setCall] = useState<IncomingCall | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Outbound only: a permission-related failure shows a "Request permission"
  // button on the error card so the rep can opt the customer in right there.
  const [showReqPerm, setShowReqPerm] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Outbound: give up ringing the customer after 60s with no answer.
  const dialTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Outbound: the thread we're calling, so the error card can request permission.
  const outboundThreadRef = useRef<string | null>(null);
  // Mirror of the active call id so socket handlers read fresh state.
  const activeIdRef = useRef<string | null>(null);

  const playRingTone = useCallback(() => {
    try {
      let ctx = audioCtxRef.current;
      if (!ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const now = ctx.currentTime;
      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx!.createOscillator();
        const g = ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.3, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g).connect(ctx!.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      };
      tone(523.25, now, 0.4);
      tone(659.25, now + 0.4, 0.5);
    } catch {
      /* best-effort */
    }
  }, []);

  const stopRing = useCallback(() => {
    if (ringRef.current) {
      clearInterval(ringRef.current);
      ringRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    stopRing();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (dialTimeoutRef.current) {
      clearTimeout(dialTimeoutRef.current);
      dialTimeoutRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    activeIdRef.current = null;
    setCall(null);
    setPhase(null);
    setMuted(false);
    setSeconds(0);
    setShowReqPerm(false);
    outboundThreadRef.current = null;
  }, [stopRing]);

  // Incoming-call ring (targeted to this rep by the backend).
  useWhatsAppEvent<IncomingCall>(
    'whatsapp.call.incoming',
    useCallback(
      (data) => {
        if (!data?.callId) return;
        if (activeIdRef.current) return; // already on/handling a call — ignore
        activeIdRef.current = data.callId;
        setError(null);
        setCall(data);
        setPhase('ringing');
        playRingTone();
        stopRing();
        ringRef.current = setInterval(playRingTone, 3000);
        // Safety: auto-clear an unanswered ring after 45s (the bell + callback
        // task already persist the missed call). Cleared on accept/teardown.
        if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = setTimeout(() => {
          if (activeIdRef.current === data.callId) teardown();
        }, 45000);
      },
      [playRingTone, stopRing, teardown],
    ),
  );

  // Caller hung up / call ended server-side.
  useWhatsAppEvent<{ callId: string }>(
    'whatsapp.call.ended',
    useCallback(
      (data) => {
        if (data?.callId && data.callId === activeIdRef.current) teardown();
      },
      [teardown],
    ),
  );

  // Outbound: the customer accepted our call — Meta relayed their SDP answer.
  // Apply it as the remote description; connectionstatechange flips to in-call.
  useWhatsAppEvent<{ callId: string; sdpAnswer: string }>(
    'whatsapp.call.answered',
    useCallback(
      (data) => {
        if (!data?.callId || data.callId !== activeIdRef.current) return;
        const pc = pcRef.current;
        if (!pc || !data.sdpAnswer) return;
        if (dialTimeoutRef.current) {
          clearTimeout(dialTimeoutRef.current);
          dialTimeoutRef.current = null;
        }
        setPhase('connecting');
        pc.setRemoteDescription({ type: 'answer', sdp: data.sdpAnswer }).catch(() => teardown());
      },
      [teardown],
    ),
  );

  // Place an OUTBOUND call. The browser is the offerer: getUserMedia → offer →
  // POST to /outbound (backend relays it to Meta) → wait for the customer's
  // answer (whatsapp.call.answered) → media connects.
  const startOutbound = useCallback(
    async (detail: { threadId: string; name?: string | null; phone?: string | null }) => {
      if (!detail?.threadId) return;
      if (activeIdRef.current) return; // already on / placing a call
      activeIdRef.current = 'pending';
      outboundThreadRef.current = detail.threadId;
      setError(null);
      setShowReqPerm(false);
      setCall({ callId: '', from: detail.phone ?? '', leadName: detail.name ?? null, leadId: null });
      setPhase('dialing');
      try {
        const { iceServers } = await apiFetch<{ iceServers: RTCIceServer[] }>('/whatsapp/calls/ice');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection({ iceServers: iceServers ?? [] });
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.ontrack = (e) => {
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0] ?? null;
        };
        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === 'connected') {
            setPhase('in-call');
            if (!timerRef.current) {
              timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
            }
          } else if (st === 'failed' || st === 'closed' || st === 'disconnected') {
            teardown();
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIce(pc);

        const { callId } = await apiFetch<{ callId: string }>('/whatsapp/calls/outbound', {
          method: 'POST',
          body: JSON.stringify({ threadId: detail.threadId, sdpOffer: pc.localDescription?.sdp ?? '' }),
        });
        if (!callId) throw new Error('No call id returned');
        activeIdRef.current = callId;
        setCall((c) => (c ? { ...c, callId } : c));

        // Give up if the customer doesn't pick up within 60s.
        if (dialTimeoutRef.current) clearTimeout(dialTimeoutRef.current);
        dialTimeoutRef.current = setTimeout(() => {
          if (activeIdRef.current === callId && pcRef.current?.connectionState !== 'connected') {
            void apiFetch(`/whatsapp/calls/${callId}/hangup`, { method: 'POST' }).catch(() => undefined);
            teardown();
          }
        }, 60000);
      } catch (e) {
        if (dialTimeoutRef.current) {
          clearTimeout(dialTimeoutRef.current);
          dialTimeoutRef.current = null;
        }
        // Stop any media we opened, but KEEP the card so the (actionable) error
        // stays visible — e.g. "request call permission first".
        try {
          pcRef.current?.getSenders().forEach((s) => s.track?.stop());
          pcRef.current?.close();
        } catch {
          /* ignore */
        }
        pcRef.current = null;
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        const id = activeIdRef.current;
        if (id && id !== 'pending') {
          try {
            await apiFetch(`/whatsapp/calls/${id}/hangup`, { method: 'POST' });
          } catch {
            /* ignore */
          }
        }
        const m = e instanceof Error ? e.message : 'Could not place the call';
        setError(m);
        // Permission failures get a "Request permission" button on the card.
        setShowReqPerm(/permission|allow/i.test(m));
        setPhase('error');
      }
    },
    [teardown],
  );

  // Bridge: a "Call" button anywhere (e.g. the chat panel) dispatches this
  // window event; the globally-mounted dock owns the WebRTC + UI.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        threadId: string;
        name?: string | null;
        phone?: string | null;
      };
      void startOutbound(detail);
    };
    window.addEventListener('wa:outbound-call', handler);
    return () => window.removeEventListener('wa:outbound-call', handler);
  }, [startOutbound]);

  useEffect(() => () => teardown(), [teardown]);

  async function accept() {
    if (!call) return;
    stopRing();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    setPhase('connecting');
    setError(null);
    try {
      const [{ iceServers }, detail] = await Promise.all([
        apiFetch<{ iceServers: RTCIceServer[] }>('/whatsapp/calls/ice'),
        apiFetch<{ id: string; status: string; sdpOffer: string | null }>(`/whatsapp/calls/${call.callId}`),
      ]);
      if (!detail.sdpOffer) throw new Error('No SDP offer for this call');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const pc = new RTCPeerConnection({ iceServers: iceServers ?? [] });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.ontrack = (e) => {
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0] ?? null;
      };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          setPhase('in-call');
          if (!timerRef.current) {
            timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
          }
        } else if (st === 'failed' || st === 'closed' || st === 'disconnected') {
          teardown();
        }
      };

      await pc.setRemoteDescription({ type: 'offer', sdp: detail.sdpOffer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);

      await apiFetch(`/whatsapp/calls/${call.callId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ sdpAnswer: pc.localDescription?.sdp ?? '' }),
      });
      // connectionstatechange flips us to 'in-call' once media connects.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect the call');
      try {
        if (call) await apiFetch(`/whatsapp/calls/${call.callId}/hangup`, { method: 'POST' });
      } catch {
        /* ignore */
      }
      teardown();
    }
  }

  async function decline() {
    const id = call?.callId;
    teardown();
    if (id) {
      try {
        await apiFetch(`/whatsapp/calls/${id}/reject`, { method: 'POST' });
      } catch {
        /* ignore */
      }
    }
  }

  async function hangup() {
    const id = call?.callId;
    teardown();
    if (id) {
      try {
        await apiFetch(`/whatsapp/calls/${id}/hangup`, { method: 'POST' });
      } catch {
        /* ignore */
      }
    }
  }

  // Outbound: send the customer a call-permission request (after a call was
  // blocked for missing permission). They tap Allow in their WhatsApp client,
  // then the rep can call again.
  async function requestPermission() {
    const threadId = outboundThreadRef.current;
    if (!threadId) return;
    try {
      await apiFetch('/whatsapp/calls/permission', {
        method: 'POST',
        body: JSON.stringify({ threadId }),
      });
      setShowReqPerm(false);
      setError('Permission request sent. Once the customer taps “Allow”, call again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the permission request');
    }
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  if (!call) return <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />;

  const who = call.leadName?.trim() || call.from;

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
      <div
        role="dialog"
        aria-label="WhatsApp call"
        className="sos-glass sos-glass--strong"
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          zIndex: 2000,
          width: 300,
          padding: 16,
          borderRadius: 16,
          borderLeft: '3px solid var(--sos-status-success)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'var(--sos-status-success-soft)',
              color: 'var(--sos-status-success)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Phone size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {who}
            </div>
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
              {phase === 'ringing' && 'Incoming WhatsApp call…'}
              {phase === 'dialing' && 'Calling…'}
              {phase === 'connecting' && 'Connecting…'}
              {phase === 'in-call' && `In call · ${fmt(seconds)}`}
              {phase === 'error' && 'Call failed'}
            </div>
          </div>
        </div>

        {call.from && phase === 'ringing' ? (
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary)', marginBottom: 10 }}>{call.from}</div>
        ) : null}

        {error ? (
          <div style={{ fontSize: 12, color: 'var(--sos-status-danger)', marginBottom: 10 }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          {phase === 'ringing' ? (
            <>
              <button
                type="button"
                onClick={() => void accept()}
                className="sos-btn sos-btn--success"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Phone size={15} /> Accept
              </button>
              <button
                type="button"
                onClick={() => void decline()}
                className="sos-btn sos-btn--danger"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <PhoneOff size={15} /> Decline
              </button>
            </>
          ) : phase === 'error' ? (
            <>
              {showReqPerm ? (
                <button
                  type="button"
                  onClick={() => void requestPermission()}
                  className="sos-btn sos-btn--success"
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Phone size={15} /> Request permission
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => teardown()}
                className="sos-btn sos-btn--ghost"
                style={{ flex: 1 }}
              >
                Close
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleMute}
                disabled={phase !== 'in-call'}
                className="sos-btn sos-btn--ghost"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {muted ? <MicOff size={15} /> : <Mic size={15} />} {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                type="button"
                onClick={() => void hangup()}
                className="sos-btn sos-btn--danger"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <PhoneOff size={15} /> Hang up
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

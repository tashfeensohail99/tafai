'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';

const SPEEDS = [1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Compact audio player with a WhatsApp-style playback-speed toggle (tap the pill
 * to cycle 1× → 1.5× → 2×). Used for voice notes in the chat thread and for call
 * recordings on the admin Calls console. Wraps a hidden <audio> element and drives
 * play / seek / speed from React state so we control the speed button ourselves
 * (the native <audio controls> has no speed UI on most browsers).
 */
export function AudioPlayer({ src, style }: { src: string; style?: CSSProperties }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);

  // Keep the element's rate in sync whenever the speed changes or the src reloads.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.playbackRate = speed;
      void a.play();
    } else {
      a.pause();
    }
  };
  const cycleSpeed = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  const seek = (v: number) => {
    const a = audioRef.current;
    if (a) {
      a.currentTime = v;
      setCurrent(v);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 210, maxWidth: 340, ...style }}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: '50%',
          border: 'none',
          background: 'var(--wa-accent, #00a884)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        {playing ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 1 }} />}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(current, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Seek"
        style={{ flex: 1, minWidth: 60, accentColor: 'var(--wa-accent, #00a884)', cursor: 'pointer' }}
      />
      <span
        style={{ fontSize: 11, color: 'var(--sos-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}
      >
        {fmt(current > 0 ? current : duration)}
      </span>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label="Playback speed"
        title="Playback speed"
        style={{
          flexShrink: 0,
          minWidth: 34,
          height: 22,
          padding: '0 7px',
          borderRadius: 11,
          border: '1px solid var(--sos-border-subtle)',
          background: speed === 1 ? 'transparent' : 'var(--wa-accent, #00a884)',
          color: speed === 1 ? 'var(--sos-text-secondary)' : '#fff',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {speed}×
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(Number.isFinite(el.duration) ? el.duration : 0);
          el.playbackRate = speed;
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        style={{ display: 'none' }}
      />
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sosRef } from '@repo/contracts/sos';
import { Button, cn } from '@repo/ui-web';
import { createClient } from '@/lib/supabase/client';

export interface LiveLabels {
  live: string;
  connecting: string;
  paused: string;
  soundOn: string;
  soundOff: string;
  dismiss: string;
  /** With {{ref}} still in them; filled in here. */
  /** no_accept_*: plan §11, the team that did not respond ({{missed}}) and the next one offered ({{next}}). */
  alarm: { raised: string; no_accept: string; no_accept_team: string; no_accept_nearest: string };
}

/** Refreshes at most this often when pushes arrive (positions come every few seconds). */
const REFRESH_GAP_MS = 2_000;
/** Polling: always, so a lost push is never a lost update. */
const POLL_LIVE_MS = 30_000;
const POLL_PAUSED_MS = 10_000;
const SOUND_KEY = 'cc.alarmSound';

/** Three short high beeps. Browsers only allow sound after the user turned it on here. */
function beep(ctx: AudioContext) {
  for (let n = 0; n < 3; n++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(ctx.destination);
    const at = ctx.currentTime + n * 0.3;
    osc.start(at);
    osc.stop(at + 0.18);
  }
}

/**
 * The command center's live layer: subscribes to the desk channels
 * (`desk:all` for operations, `desk:{siteId}` for a community desk), re-renders
 * the board on every change, raises an alarm banner (and sound, if turned on)
 * for a new SOS or a ring nobody answered (naming the teams), and polls as a fallback.
 */
export function LiveBoard({ topics, labels }: { topics: string[]; labels: LiveLabels }) {
  const router = useRouter();
  const [status, setStatus] = useState<'connecting' | 'live' | 'paused'>('connecting');
  const [alarms, setAlarms] = useState<{ key: string; text: string; incidentId: string }[]>([]);
  // Remembered per browser; it changes only the button until the user arms it with a click.
  const [sound, setSound] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
      return false;
    }
  });
  /** Sound was turned on with a click on this page, so the browser lets it play. */
  const [armed, setArmed] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(false);
  const lastRefresh = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topicKey = topics.join(',');

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) return;
      const wait = Math.max(0, lastRefresh.current + REFRESH_GAP_MS - Date.now());
      pending.current = setTimeout(() => {
        pending.current = null;
        lastRefresh.current = Date.now();
        router.refresh();
      }, wait);
    };
    const alarm = (why: keyof LiveLabels['alarm'], incidentId: string, vars: Record<string, string> = {}) => {
      const text = Object.entries({ ref: sosRef(incidentId), ...vars }).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), labels.alarm[why]);
      setAlarms((a) => [{ key: `${why}:${incidentId}:${Date.now()}`, text, incidentId }, ...a].slice(0, 3));
      if (soundRef.current && audio.current) {
        void audio.current.resume().then(() => beep(audio.current!));
      }
    };

    const supabase = createClient();
    const channels = topics.map((topic) =>
      supabase.channel(topic, { config: { private: true } }).on('broadcast', { event: '*' }, ({ event, payload }: { event: string; payload: unknown }) => {
        const p = payload as { incidentId?: string; state?: string; why?: string; missed?: string | null; offeredTo?: string | null };
        if (event === 'alarm' && p.incidentId && p.why === 'no_accept') {
          if (!p.missed) alarm('no_accept', p.incidentId);
          else if (p.offeredTo) alarm('no_accept_team', p.incidentId, { missed: p.missed, next: p.offeredTo });
          else alarm('no_accept_nearest', p.incidentId, { missed: p.missed });
        }
        if (event === 'state' && p.state === 'raised' && p.incidentId) alarm('raised', p.incidentId);
        refresh();
      }),
    );
    let cancelled = false;
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      for (const ch of channels) {
        ch.subscribe((s: string) => {
          if (s === 'SUBSCRIBED') setStatus('live');
          else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('paused');
        });
      }
    });
    return () => {
      cancelled = true;
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      for (const ch of channels) void supabase.removeChannel(ch);
    };
    // topicKey stands in for topics; labels are fixed per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, router]);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), status === 'live' ? POLL_LIVE_MS : POLL_PAUSED_MS);
    return () => clearInterval(id);
  }, [status, router]);

  // A remembered "on" still needs a click on this page before the browser plays sound.
  const soundReady = sound && armed;
  const toggleSound = () => {
    const next = !soundReady;
    if (next) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      setArmed(true);
    }
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered; fine for this visit.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span role="status" className={cn('inline-flex items-center gap-2 rounded-pill px-3 py-1 text-caption font-bold', status === 'live' ? 'bg-success-soft text-success-text' : status === 'paused' ? 'bg-warning-soft text-warning-text' : 'bg-surface-raised text-text-muted')}>
          <span aria-hidden className={cn('size-2 rounded-pill', status === 'live' ? 'bg-success' : status === 'paused' ? 'bg-warning' : 'bg-text-muted')} />
          {status === 'live' ? labels.live : status === 'paused' ? labels.paused : labels.connecting}
        </span>
        <Button type="button" variant="outline" onClick={toggleSound} aria-pressed={soundReady} className="min-h-tap text-small">
          {soundReady ? labels.soundOff : labels.soundOn}
        </Button>
      </div>
      {alarms.length > 0 ? (
        <ul aria-live="assertive" className="flex flex-col gap-2">
          {alarms.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center gap-3 rounded-control border border-danger-border bg-danger-soft px-4 py-3 font-semibold text-danger-text">
              <a href={`/?incident=${a.incidentId}`} className="flex-1 underline-offset-4 hover:underline">
                {a.text}
              </a>
              <button type="button" onClick={() => setAlarms((all) => all.filter((x) => x.key !== a.key))} className="min-h-tap rounded-control px-3 text-small text-danger-text hover:bg-surface">
                {labels.dismiss}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "6:12" since `iso`, ticking every second. */
export function Since({ iso, template }: { iso: string; template: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Rendered on the server without a time (it would not match the browser's clock).
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (now === null) return null;
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  const time = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return <span className="font-mono tabular-nums">{template.replace('{{time}}', time)}</span>;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonVariants, cn, Icon, type IconName } from '@repo/ui-web';
import type { ServiceItem, Step } from '../_lib/copy';
import { serviceStyle } from '../_lib/services';

export function ServicesTabs({ items, tabsLabel, ctaTemplate }: { items: ServiceItem[]; tabsLabel: string; ctaTemplate: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cur = items[active]!;
  const s = serviceStyle[cur.key];

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  function onKey(e: React.KeyboardEvent, i: number) {
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + items.length) % items.length;
    setActive(n);
    refs.current[n]?.focus();
  }

  return (
    <div className="flex flex-wrap items-stretch gap-5">
      <div role="tablist" aria-label={tabsLabel} aria-orientation="vertical" className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
        {items.map((it, i) => {
          const st = serviceStyle[it.key];
          const on = i === active;
          return (
            <button
              key={it.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`svc-tab-${it.key}`}
              aria-selected={on}
              aria-controls="svc-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn('flex w-full items-center gap-3.5 rounded-panel border px-4 py-3.5 text-left', on ? cn('bg-surface', st.ring) : 'border-border bg-transparent')}
            >
              <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-sm', st.soft, st.fg)}>
                <Icon name={st.icon} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-bold">{it.name}</span>
                <span className="text-small text-text-muted">{it.short}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="svc-panel" aria-labelledby={`svc-tab-${cur.key}`} className="flex min-w-0 flex-[2_1_520px] flex-col gap-5 rounded-section border border-border bg-surface p-7">
        <div className="flex items-center gap-3.5">
          <span className={cn('flex size-15 shrink-0 items-center justify-center rounded-md', s.soft, s.fg)}>
            <Icon name={s.icon} size={28} />
          </span>
          <div className="flex flex-col gap-1">
            <span className={cn('text-caption font-bold tracking-widest uppercase', s.fg)}>{cur.tagline}</span>
            <h3 className="font-display text-h2 font-bold">{cur.name}</h3>
          </div>
        </div>
        <p className="text-body-lg text-text-muted">{cur.desc}</p>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {cur.points.map((p) => (
            <li key={p} className="flex items-start gap-2.5">
              <span className={cn('flex size-5.5 shrink-0 items-center justify-center rounded-pill', s.soft, s.fg)}>
                <Icon name="check" size={14} strokeWidth={2.4} />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <ol className="flex flex-wrap gap-3.5 rounded-panel border border-border bg-bg p-4">
          {cur.flow.map((f, i) => (
            <li key={f} className="flex min-w-0 flex-[1_1_140px] items-center gap-2.5">
              <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-pill font-mono text-caption font-bold text-on-service', s.fill)}>{i + 1}</span>
              <span className="text-small font-semibold">{f}</span>
            </li>
          ))}
        </ol>
        <a href="#signup" className={cn('self-start rounded-sm px-5 py-3 font-bold text-on-service', s.fill)}>
          {ctaTemplate.replace('{{name}}', cur.name)}
        </a>
      </div>
    </div>
  );
}

const sosIcons: IconName[] = ['siren', 'bell', 'gate', 'heart', 'doc'];

export function SosStory({ steps, labels, children }: { steps: { t: string; sub: string }[]; labels: { play: string; playing: string; replay: string; now: string; done: string }; children: React.ReactNode }) {
  const [step, setStep] = useState(-1);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  function play() {
    clearInterval(timer.current);
    setStep(0);
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s + 1 >= steps.length) clearInterval(timer.current);
        return s + 1;
      });
    }, 1100);
  }

  const playing = step >= 0 && step < steps.length;
  return (
    <div className="flex flex-wrap items-center gap-12">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4.5">
        {children}
        <button type="button" onClick={play} disabled={playing} className={cn(buttonVariants({ variant: 'danger', size: 'lg' }), 'self-start')}>
          {playing ? labels.playing : step >= steps.length ? labels.replay : labels.play}
        </button>
      </div>
      <ol className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5" aria-live="polite">
        {steps.map((s, i) => {
          const done = step > i;
          const now = step === i;
          return (
            <li key={s.t} className={cn('flex items-center gap-3.5 rounded-panel border bg-surface px-4 py-3.5 transition-colors', now ? 'border-danger' : 'border-border')}>
              <span className={cn('flex size-9.5 shrink-0 items-center justify-center rounded-sm', done ? 'bg-accent-soft text-accent-text' : now ? 'bg-danger text-on-danger' : 'bg-danger-soft text-danger-text')}>
                <Icon name={sosIcons[i] ?? 'siren'} />
              </span>
              <span className="flex grow flex-col gap-0.5">
                <span className="font-bold">{s.t}</span>
                <span className="text-small text-text-muted">{s.sub}</span>
              </span>
              {done || now ? <span className={cn('text-caption font-bold', done ? 'text-accent-text' : 'text-danger-text')}>{done ? labels.done : labels.now}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function HowTabs({ groupLabel, tabs, steps }: { groupLabel: string; tabs: Record<string, string>; steps: Record<string, Step[]> }) {
  const keys = Object.keys(tabs);
  const [active, setActive] = useState(keys[0]!);
  return (
    <>
      <div role="group" aria-label={groupLabel} className="flex flex-wrap gap-1 self-start rounded-control border border-border bg-surface p-1">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={active === k}
            onClick={() => setActive(k)}
            className={cn('min-h-tap rounded-sm px-4.5 font-bold', active === k ? 'bg-accent text-on-accent' : 'text-text-muted')}
          >
            {tabs[k]}
          </button>
        ))}
      </div>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        {(steps[active] ?? []).map((s, i) => (
          <li key={s.t} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-6">
            <span className="flex size-10 items-center justify-center rounded-sm bg-accent font-mono font-bold text-on-accent">{i + 1}</span>
            <h3 className="font-display text-title font-bold">{s.t}</h3>
            <p className="text-small leading-relaxed text-text-muted">{s.b}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

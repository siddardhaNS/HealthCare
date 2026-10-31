'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button, buttonVariants, cn } from '@repo/ui-web';
import { submitter, useHydrated } from '../_coverage/action-form';
import type { ActionState } from './actions';

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface FormLabels {
  confirm: string;
  saving: string;
  reason: string;
  reasonOptional: string;
}

const field = 'min-h-tap w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-text';

/**
 * One command-center action: a button that opens a small form (reason,
 * optional crew) and confirms. Nothing changes until "Confirm".
 */
export function DeskAction(props: {
  action: Action;
  label: string;
  hint: string;
  labels: FormLabels;
  reason: 'required' | 'optional' | 'none';
  crews?: { options: { id: string; label: string }[]; label: string; none?: string; emptyText: string; /** Form field name (default crewId). */ name?: string };
  variant?: 'danger' | 'outline';
  testId: string;
}) {
  const [state, run, pending] = useActionState(props.action, { error: null, done: 0 });
  const box = useRef<HTMLDetailsElement>(null);
  const ready = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.done > 0 && box.current) box.current.open = false;
    if (state.done > 0) form.current?.reset();
  }, [state.done]);
  const noCrews = !!props.crews && props.crews.options.length === 0 && !props.crews.none;

  return (
    <details ref={box} className="group rounded-control">
      <summary data-testid={props.testId} className={cn(buttonVariants({ variant: props.variant ?? 'outline' }), 'w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
        {props.label}
      </summary>
      <form ref={form} onSubmit={submitter(run)} className="mt-2 flex flex-col gap-3 rounded-control border border-border bg-surface-raised p-3">
        <p className="text-small text-text-muted">{props.hint}</p>
        {props.crews ? (
          noCrews ? (
            <p className="text-small text-warning-text">{props.crews.emptyText}</p>
          ) : (
            <label className="flex flex-col gap-1 text-small font-semibold">
              {props.crews.label}
              <select name={props.crews.name ?? 'crewId'} required={!props.crews.none} className={field} defaultValue="">
                {props.crews.none ? <option value="">{props.crews.none}</option> : <option value="" disabled />}
                {props.crews.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : null}
        {props.reason !== 'none' ? (
          <label className="flex flex-col gap-1 text-small font-semibold">
            {props.reason === 'required' ? props.labels.reason : props.labels.reasonOptional}
            <textarea name="reason" required={props.reason === 'required'} maxLength={200} rows={2} className={field} />
          </label>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-small text-danger-text">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" variant={props.variant === 'danger' ? 'danger' : 'accent'} disabled={pending || noCrews || !ready}>
          {pending ? props.labels.saving : props.labels.confirm}
        </Button>
      </form>
    </details>
  );
}

export function TestSosForm(props: { action: Action; sites: { id: string; name: string; city: string }[]; label: string; siteLabel: string; saving: string }) {
  const [state, run, pending] = useActionState(props.action, { error: null, done: 0 });
  const ready = useHydrated();
  return (
    <form onSubmit={submitter(run)} className="flex flex-wrap items-end gap-3">
      {props.sites.length > 1 ? (
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-small font-semibold">
          {props.siteLabel}
          <select name="siteId" required className={field}>
            {props.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.city}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="siteId" value={props.sites[0]?.id ?? ''} />
      )}
      <Button type="submit" variant="danger" disabled={pending || !ready} data-testid="run-test-sos">
        {pending ? props.saving : props.label}
      </Button>
      {state.error ? (
        <p role="alert" className="w-full text-small text-danger-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

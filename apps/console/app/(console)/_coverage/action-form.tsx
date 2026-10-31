'use client';

import { startTransition, useActionState, useEffect, useRef, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { cn } from '@repo/ui-web';
import type { ActionState } from '../_command/actions';

type State = ActionState & { changed?: number };

/**
 * False until React has hydrated the page. These forms submit through an onSubmit
 * handler, so a click before hydration (slow network, busy laptop) would do a plain
 * browser GET instead of the action: their buttons stay disabled until then.
 */
const noSubscribe = () => () => {};
export function useHydrated() {
  // The server snapshot (false) is used while hydrating, the client one (true) after.
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

/** onSubmit handler that runs a useActionState dispatch without React's automatic form reset. */
export function submitter(run: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => run(data));
  };
}

/**
 * A form posting to a server action: disables its fields while saving, shows
 * the API's message on failure, and clears itself after a success (`reset`).
 * Submitted by hand rather than through `action`, so React does not clear
 * what the user typed when the API refuses it.
 */
export function ActionForm(props: {
  action: (prev: State, form: FormData) => Promise<State>;
  children: ReactNode;
  className?: string;
  reset?: boolean;
  /** Shown after a success; {{count}} is the number of changes, if the action reports one. */
  doneText?: string;
  label?: string;
}) {
  const [state, run, pending] = useActionState(props.action, { error: null, done: 0 });
  const form = useRef<HTMLFormElement>(null);
  const ready = useHydrated();
  useEffect(() => {
    if (state.done > 0 && props.reset) form.current?.reset();
  }, [state.done, props.reset]);

  return (
    <form ref={form} onSubmit={submitter(run)} aria-label={props.label} className={props.className}>
      <fieldset disabled={pending || !ready} className={cn('contents', pending && 'opacity-70')}>
        {props.children}
      </fieldset>
      {state.error ? (
        <p role="alert" className="w-full text-small text-danger-text">
          {state.error}
        </p>
      ) : state.done > 0 && props.doneText ? (
        <p role="status" className="w-full text-small text-success-text">
          {props.doneText.replace('{{count}}', String(state.changed ?? ''))}
        </p>
      ) : null}
    </form>
  );
}

import { useId, type InputHTMLAttributes } from 'react';

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="text-small font-semibold text-text-muted">{label}</span>
      <input
        id={id}
        className="min-h-12 rounded-control border border-border-strong bg-surface px-4 text-body-lg text-text outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-border"
        {...props}
      />
    </label>
  );
}

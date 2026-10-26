import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

// shadcn/ui button, restyled with semantic token utilities only.
export const buttonVariants = cva(
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-control px-5 font-body text-body font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        accent: 'bg-accent text-on-accent',
        danger: 'bg-danger text-on-danger',
        outline: 'border border-border-strong bg-transparent text-text',
        ghost: 'bg-transparent text-text-muted hover:text-text',
      },
      size: {
        md: '',
        lg: 'min-h-12 px-6 text-body-lg',
      },
    },
    defaultVariants: { variant: 'accent', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

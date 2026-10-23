import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary:     'bg-accent text-accent-foreground hover:bg-accent/90',
        secondary:   'bg-muted text-foreground hover:bg-muted/70',
        outline:     'border border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
        ghost:       'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        sm:   'h-7 px-3 text-xs',
        md:   'h-9 px-4',
        lg:   'h-11 px-6',
        icon: 'h-8 w-8 rounded-lg p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

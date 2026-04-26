import clsx from 'clsx';

type BadgeVariant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'indigo';

interface BadgeProps {
  variant: BadgeVariant;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  gray: 'bg-slate-700 text-slate-300',
  blue: 'bg-blue-900/60 text-blue-300',
  green: 'bg-green-900/60 text-green-300',
  yellow: 'bg-yellow-900/60 text-yellow-300',
  red: 'bg-red-900/60 text-red-300',
  indigo: 'bg-indigo-900/60 text-indigo-300',
};

export function Badge({ variant, pulse = false, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        variantClasses[variant],
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

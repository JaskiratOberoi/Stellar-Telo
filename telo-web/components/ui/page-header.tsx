import { cn } from '@/lib/utils';

/**
 * Standard page masthead for the Telo 2.0 layout — a small gradient-dotted
 * eyebrow (the section/channel name), a large display-face title, an optional
 * one-line description, and a right-aligned actions slot that wraps below on
 * mobile. Server component; pairs with the `.stagger` utility on the page
 * body so the masthead leads the entrance cascade.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-primary to-[hsl(var(--brand-2))]" />
            {eyebrow}
          </span>
        )}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

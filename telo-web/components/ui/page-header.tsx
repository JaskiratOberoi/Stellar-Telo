import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Consistent page-level header for every (shop) screen: optional back link,
 * title + description on the left, action buttons on the right. Wraps to a
 * column on phones so actions stay tappable. Server component.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Renders a "← back" link above the title. */
  backHref?: string;
  backLabel?: string;
  /** Right-aligned actions (buttons/links). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden',
        className,
      )}
    >
      <div className="min-w-0 animate-fade-in-up">
        {backHref && (
          <Link
            href={backHref}
            className="mb-1.5 inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {backLabel ?? 'Back'}
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

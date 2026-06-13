import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';

/**
 * Small version pill shown next to the Telo wordmark everywhere the brand
 * appears (nav, login, landing). Pure/server-safe — no hooks — so it can drop
 * into both server and client components. Reads the single APP_VERSION source.
 */
export function VersionBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground',
        className,
      )}
    >
      {APP_VERSION}
    </span>
  );
}

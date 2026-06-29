'use client';

import { useMemo, useState, useTransition } from 'react';
import { saveProfileInterpretationAction } from '@/actions/admin.actions';
import type { ProfileInterpRow } from '@/db/read/profileInterpretations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Admin editor for profile-level clinical significance. Searchable list of all
 * active profiles; each row has an editable textarea + Save (upserts the Telo
 * sidecar). A green "has text" dot flags profiles that already have one.
 */
export function InterpretationManagement({ initial }: { initial: ProfileInterpRow[] }) {
  const [rows, setRows] = useState<ProfileInterpRow[]>(initial);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.code.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const withText = rows.filter((r) => (r.interpretation ?? '').trim()).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search profiles by name or code…"
          className="max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          {withText} of {rows.length} profiles have an interpretation
        </span>
      </div>

      <div className="space-y-2">
        {filtered.map((row) => (
          <ProfileRow
            key={row.profileId}
            row={row}
            onSaved={(text) =>
              setRows((prev) =>
                prev.map((r) =>
                  r.profileId === row.profileId ? { ...r, interpretation: text } : r,
                ),
              )
            }
          />
        ))}
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No profiles match “{q}”.
          </p>
        )}
      </div>
    </div>
  );
}

function ProfileRow({
  row,
  onSaved,
}: {
  row: ProfileInterpRow;
  onSaved: (text: string) => void;
}) {
  const [text, setText] = useState(row.interpretation ?? '');
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = text !== (row.interpretation ?? '');
  const hasText = (row.interpretation ?? '').trim().length > 0;

  function save() {
    setStatus('idle');
    setError(null);
    startTransition(async () => {
      const res = await saveProfileInterpretationAction({
        profileId: row.profileId,
        interpretation: text,
      });
      if (res.ok) {
        onSaved(text);
        setStatus('saved');
      } else {
        setStatus('error');
        setError(res.error ?? 'Save failed.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-foreground/5 bg-card/50 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              hasText ? 'bg-secondary' : 'bg-foreground/20'
            }`}
            title={hasText ? 'Has interpretation' : 'No interpretation yet'}
          />
          <span className="text-sm font-medium">{row.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
        </div>
        <div className="flex items-center gap-2">
          {status === 'saved' && !dirty && (
            <span className="text-xs text-secondary">Saved</span>
          )}
          {status === 'error' && <span className="text-xs text-destructive">{error}</span>}
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('idle');
        }}
        rows={3}
        placeholder="Clinical significance for this profile…"
        className="w-full resize-y rounded-md border border-foreground/10 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
    </div>
  );
}

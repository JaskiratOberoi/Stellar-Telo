import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/auth/config';
import type { TeloUser } from '@/types/auth';

/** Server-side session guard for the (shop) layout / server components. */
export async function requireSession(): Promise<TeloUser> {
  const session = await auth();
  if (!session?.telo) redirect('/login');
  return session.telo;
}

export async function currentUser(): Promise<TeloUser | null> {
  const session = await auth();
  return session?.telo ?? null;
}

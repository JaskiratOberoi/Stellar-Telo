'use server';

import { signOut } from '@/auth/config';

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}

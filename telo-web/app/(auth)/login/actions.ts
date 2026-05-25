'use server';

import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { signIn } from '@/auth/config';

export type LoginState = { error: string | null };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!username || !password) {
    return { error: 'Enter your username and password.' };
  }

  try {
    await signIn('credentials', {
      username,
      password,
      redirectTo: '/dashboard',
    });
    return { error: null };
  } catch (err) {
    // signIn throws a redirect on success — let it propagate.
    if (isRedirectError(err)) throw err;
    return { error: 'Invalid username or password.' };
  }
}

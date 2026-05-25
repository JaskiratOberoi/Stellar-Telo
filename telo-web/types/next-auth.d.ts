import type { TeloUser } from '@/types/auth';

declare module 'next-auth' {
  interface Session {
    telo?: TeloUser;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    telo?: TeloUser;
  }
}

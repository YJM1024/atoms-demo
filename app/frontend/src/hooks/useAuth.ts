import { useEffect, useState } from 'react';
import { client } from '@/lib/api';

export type AuthState = 'loading' | 'authenticated' | 'anonymous';

export interface AuthUser {
  id?: string;
  name?: string;
  email?: string;
}

/** Session comes from the SDK (token in storage), so it survives a page reload. */
export function useAuth() {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.auth
      .me()
      .then((res) => {
        if (cancelled) return;
        const data = res?.data as AuthUser | undefined;
        setUser(data ?? null);
        setState(data ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setState('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    state,
    user,
    /** Display name for the account badge; falls back to the email local part. */
    displayName: user?.name || user?.email?.split('@')[0] || '我的账号',
    login: () => client.auth.toLogin(),
    logout: async () => {
      await client.auth.logout();
      setUser(null);
      setState('anonymous');
    },
  };
}

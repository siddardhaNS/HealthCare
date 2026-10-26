import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createApiClient, type ApiClient } from '@repo/api-client';
import { createSupabase } from './supabase';

export interface MobileConfig {
  apiUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

interface SessionState {
  supabase: SupabaseClient;
  api: ApiClient;
  session: Session | null;
  /** True until the stored session has been read. */
  loading: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

/** Supabase session + typed API client for a mobile app. Config comes from the app's EXPO_PUBLIC_* env. */
export function SessionProvider({ config, children }: { config: MobileConfig; children: ReactNode }) {
  const supabase = useMemo(() => createSupabase(config.supabaseUrl, config.supabasePublishableKey), [config.supabaseUrl, config.supabasePublishableKey]);
  const api = useMemo(
    () => createApiClient({ baseUrl: config.apiUrl, getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token }),
    [config.apiUrl, supabase],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const value = useMemo(() => ({ supabase, api, session, loading }), [supabase, api, session, loading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

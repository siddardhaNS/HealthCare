// Public settings (plan §11): the community desk number for the no-network SOS
// fallback, and the languages the super admin has switched on. Read without
// signing in and kept on the phone, so both still work when we are unreachable.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import type { Schemas } from '@repo/api-client';
import type { Language } from '@repo/i18n';
import { useSession } from '@repo/mobile';
import { unwrap } from './data';

export type AppConfig = Schemas['AppConfig'];

const CONFIG_KEY = 'app.config';
/** Before the first download: English only, and no desk number (its button stays hidden). */
const FIRST_RUN: AppConfig = { deskPhone: null, languages: ['en'] };

export function useAppConfig(): AppConfig {
  const { api } = useSession();
  const [stored, setStored] = useState<AppConfig | null>(null);
  const fresh = useQuery({ queryKey: ['config'], queryFn: () => unwrap(api.GET('/v1/config')), staleTime: 5 * 60_000, retry: 2 });

  useEffect(() => {
    void AsyncStorage.getItem(CONFIG_KEY)
      .then((raw) => raw && setStored(JSON.parse(raw) as AppConfig))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (fresh.data) void AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(fresh.data)).catch(() => undefined);
  }, [fresh.data]);

  return fresh.data ?? stored ?? FIRST_RUN;
}

/** The person's language if it is switched on, else English. */
export function offeredLanguage(config: AppConfig, wanted: string | null | undefined): Language {
  return wanted && (config.languages as string[]).includes(wanted) ? (wanted as Language) : 'en';
}

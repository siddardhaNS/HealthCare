// Resident SOS: docs/plans/phase-3-sos.md §3.1–3.2 and §3.6.
// Never block the person on the network: raising retries in the background
// while the 108 / desk buttons are on screen, and live updates come from
// Realtime with polling underneath, so a lost push is never a lost update.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import type { Schemas } from '@repo/api-client';
import { distanceM, estimateEtaS } from '@repo/contracts/sos';
import { useSession } from '@repo/mobile';
import { ApiError, unwrap, useHousehold } from './data';
import { raiseWithRetry } from './raise';

export type ResidentSos = Schemas['ResidentSos'];
type GeoPoint = NonNullable<Schemas['GeoPoint']>;

/** Polling: often while the live channel is down, as a safety net while it is up (brief: ETA every 30 s). */
export const POLL_LIVE_MS = 30_000;
export const POLL_FALLBACK_MS = 5_000;

export const sosKeys = {
  current: ['sos', 'current'] as const,
  one: (id: string) => ['sos', id] as const,
};

// ── Location ────────────────────────────────────────────────────────────

const toPoint = (l: Location.LocationObject): GeoPoint => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  ...(l.coords.accuracy != null ? { accuracyM: Math.min(Math.round(l.coords.accuracy), 10_000) } : {}),
});

/** India only (the API refuses points outside it); anything else is sent without GPS. */
const inIndia = (p: GeoPoint) => p.lat >= 6 && p.lat <= 37.5 && p.lng >= 68 && p.lng <= 97.5;

/**
 * Starts looking for the person's location the moment the countdown opens:
 * last known at once, then a fresh high-accuracy fix. `best()` returns
 * whatever is there when the alert goes, never waiting for GPS.
 */
export function useSosLocation() {
  const best = useRef<GeoPoint | null>(null);
  useEffect(() => {
    let live = true;
    const keep = (l: Location.LocationObject | null, fresh: boolean) => {
      if (!live || !l) return;
      const p = toPoint(l);
      if (inIndia(p) && (fresh || !best.current)) best.current = p;
    };
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && !(await Location.requestForegroundPermissionsAsync()).granted) return;
        keep(await Location.getLastKnownPositionAsync(), false);
        keep(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), true);
      } catch {
        // No GPS, or it is switched off: the SOS goes without a location and dispatch uses the home's.
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return useCallback(() => best.current, []);
}

// ── Raising ─────────────────────────────────────────────────────────────

export type RaiseState =
  | { status: 'idle' }
  | { status: 'sending'; attempt: number; slow: boolean }
  | { status: 'sent'; incident: ResidentSos }
  /** Refused for good (e.g. rate limited): only the phone fallbacks remain. */
  | { status: 'refused'; message: string };

const retryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 408;

/**
 * Calls `wake` when the phone goes from offline to online (not on every
 * network event), so the SOS retries the moment it can. Unknown (null) counts
 * as online: only a definite "no connection" is offline.
 */
function onBackOnline(wake: () => void) {
  let offline = false;
  return NetInfo.addEventListener((state) => {
    const nowOffline = state.isConnected === false || state.isInternetReachable === false;
    if (offline && !nowOffline) wake();
    offline = nowOffline;
  });
}

/**
 * Raises the SOS with one idempotency key for this press, so retries and a
 * second press can only ever create one incident. Each attempt gives up
 * after 4 s; after the first slow or failed attempt `slow` is set and the
 * screen shows "Call community desk" / "Call 108" while retries go on.
 */
export function useRaiseSos() {
  const { api } = useSession();
  const qc = useQueryClient();
  const [state, setState] = useState<RaiseState>({ status: 'idle' });
  const stopped = useRef(false);
  const key = useRef<string | null>(null);

  useEffect(
    () => () => {
      stopped.current = true;
    },
    [],
  );

  const send = useCallback(
    async (location: GeoPoint | null) => {
      key.current ??= randomUUID();
      const body: Schemas['SosRaise'] = { idempotencyKey: key.current, ...(location ? { location } : {}) };
      const outcome = await raiseWithRetry({
        attempt: (signal) => unwrap(api.POST('/v1/sos', { body, signal })),
        retryable,
        onAttempt: (attempt) => setState((s) => ({ status: 'sending', attempt, slow: s.status === 'sending' && s.slow })),
        onSlow: () => setState((s) => (s.status === 'sending' ? { ...s, slow: true } : s)),
        stopped: () => stopped.current,
        subscribeOnline: onBackOnline,
      });
      if (outcome.status === 'sent') {
        const incident = outcome.value;
        qc.setQueryData(sosKeys.current, incident);
        qc.setQueryData(sosKeys.one(incident.id), incident);
        setState({ status: 'sent', incident });
        return incident;
      }
      if (outcome.status === 'refused') setState({ status: 'refused', message: (outcome.error as Error).message });
      return null;
    },
    [api, qc],
  );

  return { state, send };
}

// ── Following an incident ───────────────────────────────────────────────

/** My open SOS, checked on launch and on the home screen. */
export function useCurrentSos() {
  const { api, session } = useSession();
  return useQuery({
    queryKey: sosKeys.current,
    enabled: !!session,
    queryFn: () => unwrap(api.GET('/v1/sos/current')),
    refetchInterval: (q) => (q.state.data ? POLL_LIVE_MS : false),
  });
}

/** The ambulance moved: new position, and distance / ETA to where it is heading, without waiting for a refetch. */
function withPosition(sos: ResidentSos, p: { lat: number; lng: number; at: string }): ResidentSos {
  if (!sos.crew) return sos;
  const to = sos.location;
  const m = to ? distanceM(p, to) : sos.crew.distanceM;
  return { ...sos, crew: { ...sos.crew, position: p, distanceM: m, etaS: m === null ? sos.crew.etaS : estimateEtaS(m) } };
}

/**
 * One incident, live: subscribes to its private channel `sos:{id}` (state
 * changes and ambulance positions) and polls underneath, every 30 s while
 * the channel is up and every 5 s while it is not.
 */
export function useLiveSos(id: string | null) {
  const { api, supabase } = useSession();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  const query = useQuery({
    queryKey: sosKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: () => unwrap(api.GET('/v1/sos/{id}', { params: { path: { id: id! } } })),
    refetchInterval: (q) => (q.state.data && !open(q.state.data.state) ? false : connected ? POLL_LIVE_MS : POLL_FALLBACK_MS),
    staleTime: 0,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const channel = supabase.channel(`sos:${id}`, { config: { private: true } });
    channel
      .on('broadcast', { event: 'state' }, () => void qc.invalidateQueries({ queryKey: sosKeys.one(id) }))
      .on('broadcast', { event: 'position' }, ({ payload }) => {
        const p = payload as { lat?: unknown; lng?: unknown; at?: unknown };
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || typeof p.at !== 'string') return;
        qc.setQueryData<ResidentSos>(sosKeys.one(id), (old) =>
          old ? withPosition(old, { lat: p.lat as number, lng: p.lng as number, at: p.at as string }) : old,
        );
      });
    // Private channels need the user's token on the socket before joining.
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    });
    return () => {
      cancelled = true;
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [id, supabase, qc]);

  // Keep the home screen's "SOS active" card in step.
  useEffect(() => {
    if (query.data) qc.setQueryData(sosKeys.current, open(query.data.state) ? query.data : null);
  }, [query.data, qc]);

  return { ...query, connected };
}

const open = (s: ResidentSos['state']) => s !== 'closed' && s !== 'cancelled';

export function useCancelSos(id: string) {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/v1/sos/{id}/cancel', { params: { path: { id } }, body: {} })),
    onSuccess: (v) => {
      qc.setQueryData(sosKeys.one(id), v);
      qc.setQueryData(sosKeys.current, null);
    },
  });
}

// ── Phone fallbacks ─────────────────────────────────────────────────────

const DESK_PHONE_KEY = 'sos.deskPhone';

/**
 * The community desk's number, kept on the phone so "Call community desk"
 * works when the network does not. Null for a household without a community.
 */
export function useDeskPhone(): string | null {
  const household = useHousehold();
  const [stored, setStored] = useState<string | null>(null);
  const fromApi = household.data ? (household.data.household?.community?.deskPhone ?? null) : undefined;

  useEffect(() => {
    void AsyncStorage.getItem(DESK_PHONE_KEY)
      .then(setStored)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (fromApi === undefined) return;
    void (fromApi ? AsyncStorage.setItem(DESK_PHONE_KEY, fromApi) : AsyncStorage.removeItem(DESK_PHONE_KEY)).catch(() => undefined);
  }, [fromApi]);

  return fromApi === undefined ? stored : fromApi;
}

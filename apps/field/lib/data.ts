import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Schemas } from '@repo/api-client';
import { useSession } from '@repo/mobile';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 0, retry: 1 } },
});

/** How often an on-duty crew checks for offers, and for changes to a job (cancel, reassign), until ringing push lands. */
export const OFFER_POLL_MS = 3_000;
export const JOB_POLL_MS = 5_000;

/** Thrown by hooks when the API answers with an error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (response.ok) return data as T;
  const e = (error as { error?: { code?: string; message?: string } } | undefined)?.error;
  throw new ApiError(response.status, e?.code ?? 'error', e?.message ?? 'Something went wrong');
}

export const keys = {
  crew: ['crew'] as const,
  job: ['crew', 'job'] as const,
  offers: ['crew', 'offers'] as const,
};

// ── Ambulance crew ──────────────────────────────────────────────────────

export function useCrewStatus() {
  const { api } = useSession();
  // A 403 (no crew record) is an answer, not a blip: don't retry it.
  return useQuery({ queryKey: keys.crew, queryFn: () => unwrap(api.GET('/v1/crew/me')), retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 1 });
}

/** The job this crew has taken. Polled so a cancel or a desk reassignment shows up. */
export function useCrewJob(enabled: boolean) {
  const { api } = useSession();
  return useQuery({ queryKey: keys.job, enabled, queryFn: () => unwrap(api.GET('/v1/crew/job')), refetchInterval: JOB_POLL_MS });
}

/** Open offers while on duty and free. Polling stops in the background (ringing push comes with FCM). */
export function useOffers(enabled: boolean) {
  const { api } = useSession();
  return useQuery({ queryKey: keys.offers, enabled, queryFn: () => unwrap(api.GET('/v1/crew/offers')), refetchInterval: OFFER_POLL_MS });
}

export function useSetDuty() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas['CrewDuty']) => unwrap(api.PUT('/v1/crew/duty', { body })),
    onSuccess: (status) => qc.setQueryData(keys.crew, status),
  });
}

export function useAcceptOffer() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/v1/dispatch/offers/{id}/accept', { params: { path: { id } } })),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: keys.job }), qc.invalidateQueries({ queryKey: keys.offers })]),
  });
}

export function useDeclineOffer() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/v1/dispatch/offers/{id}/decline', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.offers }),
  });
}

/** A status button. The API treats a repeated step as a no-op, so a retry after a dropped answer is safe. */
export function useAdvanceJob() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: Schemas['CrewStep'] }) => unwrap(api.POST('/v1/sos/{id}/status', { params: { path: { id } }, body: { to } })),
    // Handed over: the job is finished for the crew.
    onSuccess: (job) => qc.setQueryData(keys.job, job.nextStep === null ? null : job),
    onError: () => qc.invalidateQueries({ queryKey: keys.job }),
  });
}

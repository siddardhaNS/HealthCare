import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Schemas } from '@repo/api-client';
import { purposeMeta, type ConsentPurpose } from '@repo/contracts/consent';
import { useSession } from '@repo/mobile';
import { useTranslation } from 'react-i18next';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

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

/** The signed-in person's user id. */
export function useMyId(): string {
  return useSession().session?.user.id ?? '';
}

export const keys = {
  profile: ['profile'] as const,
  household: ['household'] as const,
  invites: ['invites'] as const,
  consents: ['consents'] as const,
  consentHistory: ['consents', 'history'] as const,
  summary: (who: string) => ['health', who, 'summary'] as const,
  series: (who: string, type: string) => ['health', who, 'series', type] as const,
  list: (who: string, kind: 'vaccinations' | 'insurance' | 'devices') => ['health', who, kind] as const,
  contacts: (who: string) => ['contacts', who] as const,
};

// ── Profile, household, consent ─────────────────────────────────────────

export function useProfile() {
  const { api, session } = useSession();
  return useQuery({ queryKey: keys.profile, enabled: !!session, queryFn: () => unwrap(api.GET('/v1/me/profile')) });
}

export function useSaveProfile() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas['Profile']) => unwrap(api.PUT('/v1/me/profile', { body })),
    onSuccess: (p) => qc.setQueryData(keys.profile, p),
  });
}

export function useHousehold() {
  const { api, session } = useSession();
  return useQuery({ queryKey: keys.household, enabled: !!session, queryFn: () => unwrap(api.GET('/v1/households/me')) });
}

export function useCreateHousehold() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas['CreateHousehold']) => unwrap(api.POST('/v1/households', { body })),
    onSuccess: (v) => qc.setQueryData(keys.household, v),
  });
}

export function useMyInvites() {
  const { api } = useSession();
  return useQuery({ queryKey: keys.invites, queryFn: () => unwrap(api.GET('/v1/me/invites')) });
}

export function useAcceptInvite() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/v1/me/invites/{id}/accept', { params: { path: { id } } })),
    onSuccess: (v) => {
      qc.setQueryData(keys.household, v);
      void qc.invalidateQueries({ queryKey: keys.invites });
    },
  });
}

export function useInvite() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas['InviteCreate']) => unwrap(api.POST('/v1/households/invites', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.household }),
  });
}

export function useRevokeInvite() {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/v1/households/invites/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.household }),
  });
}

export function useConsents() {
  const { api, session } = useSession();
  return useQuery({ queryKey: keys.consents, enabled: !!session, queryFn: () => unwrap(api.GET('/v1/consents')) });
}

export function useConsentHistory() {
  const { api } = useSession();
  return useQuery({ queryKey: keys.consentHistory, queryFn: () => unwrap(api.GET('/v1/consents/history')) });
}

/** Grant or withdraw one consent, always against the notice version in force. */
export function useSetConsent() {
  const { api } = useSession();
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { purpose: ConsentPurpose; granted: boolean; scopeKey?: string }) =>
      unwrap(
        api.POST('/v1/consents', {
          body: {
            purpose: v.purpose,
            scopeKey: v.scopeKey ?? '',
            status: v.granted ? 'granted' : 'withdrawn',
            noticeVersion: purposeMeta[v.purpose].noticeVersion,
            language: (['en', 'te', 'hi'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'te' | 'hi',
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.consents });
      void qc.invalidateQueries({ queryKey: keys.household });
    },
  });
}

// ── Health record ───────────────────────────────────────────────────────

export function useHealthSummary(who: string) {
  const { api } = useSession();
  return useQuery({ queryKey: keys.summary(who), enabled: !!who, queryFn: () => unwrap(api.GET('/v1/people/{userId}/health/summary', { params: { path: { userId: who } } })) });
}

export function useVitalSeries(who: string, type: Schemas['VitalType']) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.series(who, type),
    enabled: !!who,
    queryFn: () => unwrap(api.GET('/v1/people/{userId}/health/vitals/{type}', { params: { path: { userId: who, type }, query: { limit: 7 } } })),
  });
}

/** Any change to the record refreshes the summary and every series for that person. */
function useHealthMutation<TVars, TOut>(who: string, fn: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['health', who] }) });
}

export function useLogReading(who: string) {
  const { api } = useSession();
  return useHealthMutation(who, (body: Schemas['VitalReadingInput']) => unwrap(api.POST('/v1/people/{userId}/health/vitals', { params: { path: { userId: who } }, body })));
}

export function useAddCondition(who: string) {
  const { api } = useSession();
  return useHealthMutation(who, (body: Schemas['ConditionInput']) => unwrap(api.POST('/v1/people/{userId}/health/conditions', { params: { path: { userId: who } }, body })));
}

export function useAddAllergy(who: string) {
  const { api } = useSession();
  return useHealthMutation(who, (body: Schemas['AllergyInput']) => unwrap(api.POST('/v1/people/{userId}/health/allergies', { params: { path: { userId: who } }, body })));
}

export function useRemove(who: string, kind: 'conditions' | 'allergies' | 'medications' | 'vaccinations' | 'insurance' | 'devices') {
  const { api } = useSession();
  return useHealthMutation(who, (id: string) =>
    unwrap(api.DELETE(`/v1/people/{userId}/health/${kind}/{id}` as '/v1/people/{userId}/health/conditions/{id}', { params: { path: { userId: who, id } } })),
  );
}

export function useMarkDose(who: string) {
  const { api } = useSession();
  return useHealthMutation(who, (v: { medicationId: string } & Schemas['DoseMark']) =>
    unwrap(api.POST('/v1/people/{userId}/health/medications/{id}/doses', { params: { path: { userId: who, id: v.medicationId } }, body: { date: v.date, time: v.time, status: v.status } })),
  );
}

export function useHealthList<K extends 'vaccinations' | 'insurance' | 'devices'>(who: string, kind: K) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.list(who, kind),
    enabled: !!who,
    queryFn: () => unwrap(api.GET(`/v1/people/{userId}/health/${kind}` as '/v1/people/{userId}/health/vaccinations', { params: { path: { userId: who } } })) as Promise<
      K extends 'vaccinations' ? Schemas['VaccinationList'] : K extends 'insurance' ? Schemas['InsuranceList'] : Schemas['DeviceList']
    >,
  });
}

// ── Emergency contacts ──────────────────────────────────────────────────

export function useContacts(who: string) {
  const { api } = useSession();
  return useQuery({ queryKey: keys.contacts(who), enabled: !!who, queryFn: () => unwrap(api.GET('/v1/people/{userId}/emergency-contacts', { params: { path: { userId: who } } })) });
}

export function useAddContact(who: string) {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas['EmergencyContactInput']) => unwrap(api.POST('/v1/people/{userId}/emergency-contacts', { params: { path: { userId: who } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.contacts(who) }),
  });
}

export function useRemoveContact(who: string) {
  const { api } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/v1/people/{userId}/emergency-contacts/{id}', { params: { path: { userId: who, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.contacts(who) }),
  });
}

/** What still needs doing before the main app opens. */
export function useOnboardingStep(): { loading: boolean; error: boolean; retry: () => void; step: 'profile' | 'household' | 'consent' | null } {
  const { session } = useSession();
  const profile = useProfile();
  const household = useHousehold();
  const consents = useConsents();
  const retry = () => {
    void profile.refetch();
    void household.refetch();
    void consents.refetch();
  };
  const base = { loading: false, error: false, retry };
  if (!session) return { ...base, step: null };
  if (profile.isError || household.isError || consents.isError) return { ...base, error: true, step: null };
  if (profile.isPending || household.isPending || consents.isPending) return { ...base, loading: true, step: null };
  if (!profile.data) return { ...base, step: 'profile' };
  if (!household.data?.household) return { ...base, step: 'household' };
  const care = consents.data?.consents.find((c) => c.purpose === 'care_record');
  if (!care || care.status !== 'granted' || care.outdated) return { ...base, step: 'consent' };
  return { ...base, step: null };
}

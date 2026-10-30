'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createI18n } from '@repo/i18n';
import { serverApi } from '@/lib/api';

export interface ActionState {
  error: string | null;
  /** Bumped on every success, so forms can close themselves. */
  done: number;
}

type ApiResult = { error?: { error?: { message?: string } }; response: Response };

const reasonOf = (form: FormData) => String(form.get('reason') ?? '').trim();

/** The API's own message (it explains what is not allowed now), else a generic one. */
function finish(prev: ActionState, r: ApiResult): ActionState {
  if (!r.response.ok) return { error: r.error?.error?.message ?? createI18n('en').t('console.genericError'), done: prev.done };
  revalidatePath('/');
  return { error: null, done: prev.done + 1 };
}

export async function cancelSos(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/desk/sos/{id}/cancel', { params: { path: { id } }, body: { reason: reasonOf(form) } }));
}

export async function reassignSos(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  const crewId = String(form.get('crewId') ?? '') || undefined;
  return finish(prev, await api.POST('/v1/desk/sos/{id}/reassign', { params: { path: { id } }, body: { reason: reasonOf(form), crewId } }));
}

export async function offerSos(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/desk/sos/{id}/offers', { params: { path: { id } }, body: { crewId: String(form.get('crewId') ?? '') } }));
}

export async function handOverSos(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/desk/sos/{id}/hand-over', { params: { path: { id } }, body: { reason: reasonOf(form) } }));
}

export async function closeSos(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  const reason = reasonOf(form);
  return finish(prev, await api.POST('/v1/desk/sos/{id}/close', { params: { path: { id } }, body: reason ? { reason } : {} }));
}

export async function runTestSos(prev: ActionState, form: FormData): Promise<ActionState> {
  const api = await serverApi();
  const r = await api.POST('/v1/desk/sos/test', { body: { siteId: String(form.get('siteId') ?? '') } });
  if (!r.data) return finish(prev, r);
  revalidatePath('/');
  redirect(`/?incident=${r.data.id}`);
}

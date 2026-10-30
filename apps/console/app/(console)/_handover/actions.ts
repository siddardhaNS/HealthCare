'use server';

import { revalidatePath } from 'next/cache';
import { createI18n } from '@repo/i18n';
import { serverApi } from '@/lib/api';
import type { ActionState } from '../_command/actions';

type ApiResult = { error?: { error?: { message?: string } }; response: Response };

function finish(prev: ActionState, r: ApiResult, path: string): ActionState {
  if (!r.response.ok) return { error: r.error?.error?.message ?? createI18n('en').t('console.genericError'), done: prev.done };
  revalidatePath(path);
  return { error: null, done: prev.done + 1 };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/** Command center: choose or change the receiving hospital. */
export async function redirectHospital(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(
    prev,
    await api.POST('/v1/desk/sos/{id}/hospital', { params: { path: { id } }, body: { hospitalId: text(form, 'hospitalId'), reason: text(form, 'reason') } }),
    '/',
  );
}

/** Partner portal: the ER received the patient. */
export async function confirmHandover(id: string, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/partner/handovers/{id}/confirm', { params: { path: { id } } }), '/handovers');
}

/** Partner portal: ER accepting or full. */
export async function setCapacity(hasCapacity: boolean, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.PUT('/v1/partner/capacity', { body: { hasCapacity } }), '/handovers');
}

export async function addHospital(prev: ActionState, form: FormData) {
  const api = await serverApi();
  const address = text(form, 'address');
  const city = text(form, 'city');
  const r = await api.POST('/v1/hospitals', {
    body: {
      name: text(form, 'name'),
      ...(address ? { address } : {}),
      ...(city ? { city } : {}),
      location: { lat: Number(form.get('lat')), lng: Number(form.get('lng')) },
      erPhone: text(form, 'erPhone'),
    },
  });
  return finish(prev, r, '/hospitals');
}

export async function updateHospital(id: string, patch: { active?: boolean; hasCapacity?: boolean }, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.PATCH('/v1/hospitals/{id}', { params: { path: { id } }, body: patch }), '/hospitals');
}

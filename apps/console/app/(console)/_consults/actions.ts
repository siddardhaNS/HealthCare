'use server';

import { revalidatePath } from 'next/cache';
import { createI18n } from '@repo/i18n';
import { serverApi } from '@/lib/api';
import type { ActionState } from '../_command/actions';

type ApiResult = { error?: { error?: { message?: string } }; response: Response };

function finish(prev: ActionState, r: ApiResult, ...paths: string[]): ActionState {
  if (!r.response.ok) return { error: r.error?.error?.message ?? createI18n('en').t('console.genericError'), done: prev.done };
  for (const p of paths) revalidatePath(p);
  return { error: null, done: prev.done + 1 };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const list = (form: FormData, key: string) =>
  text(form, key)
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
/** Rupees typed in the form → paise; empty = that consult type is not offered. */
const fee = (form: FormData, key: string) => {
  const v = text(form, key);
  return v === '' ? null : Math.round(Number(v) * 100);
};
type Lang = 'en' | 'te' | 'hi';
type Type = 'video' | 'audio' | 'clinic';

// ── Specialties ──────────────────────────────────────────────────────────

const specialtyFields = (form: FormData) => ({
  names: { en: text(form, 'name_en'), te: text(form, 'name_te'), hi: text(form, 'name_hi') },
  keywords: { en: list(form, 'kw_en'), te: list(form, 'kw_te'), hi: list(form, 'kw_hi') },
});

export async function addSpecialty(prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/console/specialties', { body: { code: text(form, 'code'), ...specialtyFields(form), active: true } }), '/specialties');
}

export async function updateSpecialty(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.PATCH('/v1/console/specialties/{id}', { params: { path: { id } }, body: specialtyFields(form) }), '/specialties');
}

export async function setSpecialtyActive(id: string, active: boolean, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.PATCH('/v1/console/specialties/{id}', { params: { path: { id } }, body: { active } }), '/specialties');
}

// ── Doctors ──────────────────────────────────────────────────────────────

const doctorFields = (form: FormData) => ({
  fullName: text(form, 'fullName'),
  qualification: text(form, 'qualification'),
  registrationNo: text(form, 'registrationNo'),
  council: text(form, 'council'),
  feeVideoPaise: fee(form, 'feeVideo'),
  feeAudioPaise: fee(form, 'feeAudio'),
  feeClinicPaise: fee(form, 'feeClinic'),
  slotMinutes: Number(text(form, 'slotMinutes') || 15) as 10 | 15 | 20 | 30,
  languages: form.getAll('languages').map(String) as Lang[],
  clinicAddress: text(form, 'clinicAddress') || null,
  specialtyIds: form.getAll('specialtyIds').map(String),
});

export async function addDoctor(prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/console/doctors', { body: { email: text(form, 'email'), ...doctorFields(form) } }), '/doctors');
}

export async function updateDoctor(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.PATCH('/v1/console/doctors/{id}', { params: { path: { id } }, body: doctorFields(form) }), '/doctors', `/doctors/${id}`);
}

export async function verifyDoctor(id: string, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.POST('/v1/console/doctors/{id}/verify', { params: { path: { id } } }), '/doctors', `/doctors/${id}`);
}

export async function setDoctorActive(id: string, active: boolean, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.PUT('/v1/console/doctors/{id}/active', { params: { path: { id } }, body: { active } }), '/doctors', `/doctors/${id}`);
}

// ── The doctor's own schedule ─────────────────────────────────────────────

/** Two windows per weekday in the form: h{weekday}_{0|1}_start / _end / _types. Empty rows are skipped. */
export async function saveHours(prev: ActionState, form: FormData) {
  const hours = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
    [0, 1].flatMap((i) => {
      const start = text(form, `h${weekday}_${i}_start`);
      const end = text(form, `h${weekday}_${i}_end`);
      const types = form.getAll(`h${weekday}_${i}_types`).map(String) as Type[];
      return start && end && types.length ? [{ weekday, start, end, types }] : [];
    }),
  );
  const api = await serverApi();
  return finish(prev, await api.PUT('/v1/partner/schedule/hours', { body: { hours } }), '/schedule');
}

export async function addException(prev: ActionState, form: FormData) {
  const kind = text(form, 'kind') === 'extra' ? 'extra' : 'off';
  const api = await serverApi();
  const types = form.getAll('types').map(String) as Type[];
  return finish(
    prev,
    await api.POST('/v1/partner/schedule/exceptions', {
      body: { from: text(form, 'from'), to: text(form, 'to') || text(form, 'from'), kind, ...(kind === 'extra' ? { start: text(form, 'start'), end: text(form, 'end'), ...(types.length ? { types } : {}) } : {}) },
    }),
    '/schedule',
  );
}

export async function removeException(id: string, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.DELETE('/v1/partner/schedule/exceptions/{id}', { params: { path: { id } } }), '/schedule');
}

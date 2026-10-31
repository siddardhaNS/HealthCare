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

export async function saveThresholds(siteId: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  const r = await api.PUT('/v1/sos-settings/{siteId}', {
    params: { path: { siteId } },
    body: { widenAfterS: Number(form.get('widenAfterS')), escalateAfterS: Number(form.get('escalateAfterS')) },
  });
  return finish(prev, r, '/sos-settings');
}

export async function createTeam(prev: ActionState, form: FormData) {
  const api = await serverApi();
  const area = text(form, 'area');
  return finish(prev, await api.POST('/v1/coverage/teams', { body: { name: text(form, 'name'), ...(area ? { area } : {}) } }), '/coverage');
}

export async function updateTeam(id: string, prev: ActionState, form: FormData) {
  const api = await serverApi();
  return finish(prev, await api.PATCH('/v1/coverage/teams/{id}', { params: { path: { id } }, body: { name: text(form, 'name'), area: text(form, 'area') || null } }), '/coverage');
}

export async function setTeamActive(id: string, active: boolean, prev: ActionState) {
  const api = await serverApi();
  return finish(prev, await api.PATCH('/v1/coverage/teams/{id}', { params: { path: { id } }, body: { active } }), '/coverage');
}

/** Adds (teamId from the form or bound) or removes (teamId null) a crew member. */
export async function setCrewTeam(teamId: string | null, prev: ActionState, form: FormData) {
  const api = await serverApi();
  const id = text(form, 'crewId');
  return finish(prev, await api.PUT('/v1/coverage/crews/{id}/team', { params: { path: { id } }, body: { teamId } }), '/coverage');
}

export async function setAmbulanceTeam(teamId: string | null, prev: ActionState, form: FormData) {
  const api = await serverApi();
  const id = text(form, 'ambulanceId');
  return finish(prev, await api.PUT('/v1/coverage/ambulances/{id}/team', { params: { path: { id } }, body: { teamId } }), '/coverage');
}

export async function assignPlaces(prev: ActionState & { changed?: number }, form: FormData): Promise<ActionState & { changed?: number }> {
  const api = await serverApi();
  const team = text(form, 'teamId');
  const r = await api.PUT('/v1/coverage/assignments', {
    // "as" comes from the button pressed: Set as primary, or Add as backup.
    body: { teamId: team === 'none' ? null : team, as: text(form, 'as') === 'backup' ? 'backup' : 'primary', sites: form.getAll('site').map(String), households: form.getAll('household').map(String) },
  });
  const next = finish(prev, r, '/coverage/places');
  revalidatePath('/coverage');
  return { ...next, changed: r.data?.changed };
}

/** Saves a place's backup teams in this order; a team chosen in the form (teamId) is added at the end. */
export async function setBackups(kind: 'site' | 'household', id: string, teamIds: string[], prev: ActionState, form: FormData) {
  const api = await serverApi();
  const added = text(form, 'teamId');
  const r = await api.PUT('/v1/coverage/backups', { body: { kind, id, teamIds: added ? [...teamIds, added] : teamIds } });
  const next = finish(prev, r, `/coverage/places/${kind}/${id}`);
  revalidatePath('/coverage/places');
  return next;
}

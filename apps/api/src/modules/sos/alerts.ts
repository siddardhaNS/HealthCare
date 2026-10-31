// SOS notifications (docs/plans/phase-3-sos.md §13): WhatsApp alerts to the
// resident's emergency contacts, the community desk and the gate when an SOS is
// raised, SMS for any not delivered in 60 s, and a final update to the contacts.
// Real SOS only, never drills. No message carries health details.
import type { Language } from '@repo/contracts';
import { sosRef } from '@repo/contracts/sos';
import { and, emergencyContacts, eq, homes, hospitalHandovers, hospitals, households, opsSettings, profiles, siteSosSettings, sites, sql, type Db } from '@repo/db';
import type { ConsentRepo } from '../consent/repo';
import { isGranted } from '../consent/policy';
import { alertSmsFallback, sendAlert, type MessagingDeps } from '../messaging/service';
import type { IncidentRow, SosRepo } from './repo';

/** Who an SOS is told to, and how the person and their home are named in the messages. */
export interface SosAudience {
  name: string;
  language: Language;
  /** Emergency contacts the resident confirmed agreed to alerts, minus any who replied STOP. */
  family: string[];
  deskPhone: string | null;
  gatePhone: string | null;
  /** e.g. "B-1204, Green Meadows", or the household's city for a stand-alone home. */
  place: string;
}

export interface SosAlertsRepo {
  audience(incident: IncidentRow): Promise<SosAudience>;
  /** The receiving hospital's name, once the crew has chosen one. */
  hospitalName(incidentId: string): Promise<string | null>;
}

export interface SosNotifyDeps {
  sos: SosRepo;
  consents: ConsentRepo;
  sosAlertsRepo: SosAlertsRepo;
  messaging: MessagingDeps;
}

/** Each SOS gets one notification run (a Vercel Workflow). */
export interface SosNotifyRunner {
  start(incidentId: string): Promise<void>;
}

/** How long a WhatsApp alert has to be delivered before it is re-sent by SMS. */
export const ALERT_SMS_AFTER_S = 60;
const PURPOSE = 'sos_alert';
const ctx = (incidentId: string) => ({ type: 'sos', id: incidentId });

const familyAllowed = async (d: SosNotifyDeps, i: IncidentRow) => isGranted(await d.consents.historyForStaff(i.userId), 'family_sos_alert');

/** On raise: WhatsApp to the family (if the resident allows it), the desk and the gate. Safe to retry: a second run sends nothing new. */
export async function sendSosAlerts(d: SosNotifyDeps, incidentId: string): Promise<{ family: number; desk: boolean; gate: boolean } | null> {
  const i = await d.sos.get(incidentId);
  if (!i || i.isDrill) return null;
  if (await d.messaging.repo.anySent(ctx(i.id), PURPOSE)) return null;
  const a = await d.sosAlertsRepo.audience(i);
  const family = (await familyAllowed(d, i)) ? a.family : [];
  const send = (to: string, template: 'sos_alert_family' | 'sos_alert_desk' | 'sos_alert_gate', variables: string[], language: Language = 'en') =>
    sendAlert(d.messaging, { to, template, language, variables, purpose: PURPOSE, context: ctx(i.id) });
  await Promise.all([
    ...family.map((to) => send(to, 'sos_alert_family', [a.name], a.language)),
    ...(a.deskPhone ? [send(a.deskPhone, 'sos_alert_desk', [a.name, a.place, sosRef(i.id)])] : []),
    ...(a.gatePhone && i.siteId ? [send(a.gatePhone, 'sos_alert_gate', [a.place])] : []),
  ]);
  const sent = { family: family.length, desk: !!a.deskPhone, gate: !!(a.gatePhone && i.siteId) };
  // Counts only: who was told is in message_log.
  await d.sos.recordAction(i.id, 'sos_alerts_sent', { subject_id: i.userId, ...sent });
  return sent;
}

/** After ALERT_SMS_AFTER_S: SMS for every alert not delivered or read on WhatsApp. */
export async function sendSosAlertFallback(d: SosNotifyDeps, incidentId: string): Promise<number> {
  return alertSmsFallback(d.messaging, ctx(incidentId), PURPOSE);
}

/** The family's final update when the crew hands over at the hospital or the SOS is cancelled. WhatsApp only. */
export async function sendFinalUpdate(d: SosNotifyDeps, i: IncidentRow): Promise<number> {
  if (i.isDrill || (i.state !== 'handed_over' && i.state !== 'cancelled')) return 0;
  if (!(await familyAllowed(d, i))) return 0;
  const a = await d.sosAlertsRepo.audience(i);
  if (a.family.length === 0) return 0;
  const hospital = i.state === 'handed_over' ? await d.sosAlertsRepo.hospitalName(i.id) : null;
  await Promise.all(
    a.family.map((to) =>
      i.state === 'handed_over' && hospital
        ? sendAlert(d.messaging, { to, template: 'sos_update_handed_over', language: a.language, variables: [a.name, hospital], purpose: 'sos_update', context: ctx(i.id) })
        : i.state === 'cancelled'
          ? sendAlert(d.messaging, { to, template: 'sos_update_cancelled', language: a.language, variables: [a.name], purpose: 'sos_update', context: ctx(i.id) })
          : Promise.resolve('failed' as const),
    ),
  );
  return a.family.length;
}

/** Sends the final update when a state change ends the emergency for the family. Never fails the state change. */
export function notifyingSosRepo(repo: SosRepo, deps: () => SosNotifyDeps): SosRepo {
  return {
    ...repo,
    async transition(id, from, to, actor, reason, assign) {
      const next = await repo.transition(id, from, to, actor, reason, assign);
      if (next && (to === 'handed_over' || to === 'cancelled')) {
        try {
          await sendFinalUpdate(deps(), next);
        } catch (err) {
          console.error(JSON.stringify({ level: 'error', event: 'sos_final_update_failed', incidentId: id, name: (err as Error).name }));
        }
      }
      return next;
    },
  };
}

export function drizzleSosAlertsRepo(db: Db): SosAlertsRepo {
  return {
    async audience(i) {
      const [profile, contacts, ops, site, home] = await Promise.all([
        db.select({ name: profiles.fullName, language: profiles.language }).from(profiles).where(eq(profiles.userId, i.userId)),
        db
          .select({ phone: emergencyContacts.phone })
          .from(emergencyContacts)
          .where(
            and(
              eq(emergencyContacts.userId, i.userId),
              sql`${emergencyContacts.alertsAgreedAt} is not null`,
              // The latest WhatsApp opt-in decides: a STOP reply after the resident's confirmation wins.
              sql`(select o.status from messaging_optins o where o.phone = ${emergencyContacts.phone} and o.channel = 'whatsapp' order by o.created_at desc limit 1) = 'opted_in'`,
            ),
          )
          .orderBy(emergencyContacts.priority, emergencyContacts.createdAt),
        db.select({ deskPhone: opsSettings.deskPhone }).from(opsSettings).where(eq(opsSettings.id, true)),
        i.siteId
          ? db.select({ name: sites.name, city: sites.city, gatePhone: siteSosSettings.gatePhone }).from(sites).leftJoin(siteSosSettings, eq(siteSosSettings.siteId, sites.id)).where(eq(sites.id, i.siteId))
          : Promise.resolve([]),
        i.householdId
          ? db.select({ tower: homes.tower, number: homes.number, city: households.city }).from(households).leftJoin(homes, eq(homes.id, households.homeId)).where(eq(households.id, i.householdId))
          : Promise.resolve([]),
      ]);
      const h = home[0];
      const flat = h?.number ? [h.tower, h.number].filter(Boolean).join('-') : null;
      const place = [flat, site[0]?.name ?? h?.city ?? null].filter(Boolean).join(', ') || '—';
      return {
        name: profile[0]?.name ?? '—',
        language: (profile[0]?.language as Language | null) ?? 'en',
        family: [...new Set(contacts.map((c) => c.phone))],
        deskPhone: ops[0]?.deskPhone ?? null,
        gatePhone: site[0]?.gatePhone ?? null,
        place,
      };
    },
    async hospitalName(incidentId) {
      const [r] = await db.select({ name: hospitals.name }).from(hospitalHandovers).innerJoin(hospitals, eq(hospitals.id, hospitalHandovers.hospitalId)).where(eq(hospitalHandovers.incidentId, incidentId));
      return r?.name ?? null;
    },
  };
}

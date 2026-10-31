// Per-community escalation thresholds (plan ⚑2). Incidents copy the values
// when raised, so a change applies to the next SOS, never one in progress.
import { sosThresholds } from '@repo/contracts/sos';
import { asc, auditEvents, eq, inArray, siteSosSettings, sites, type Db } from '@repo/db';

export interface SiteSettingsRow {
  siteId: string;
  name: string;
  city: string;
  widenAfterS: number;
  custom: boolean;
  updatedAt: Date | null;
}

export interface SosSettingsRepo {
  list(siteIds: string[] | 'all'): Promise<SiteSettingsRow[]>;
  /** Null if there is no such site. Audited with the values before and after. */
  set(siteId: string, v: { widenAfterS: number }, actor: string): Promise<SiteSettingsRow | null>;
}

export function drizzleSosSettingsRepo(db: Db): SosSettingsRepo {
  const list: SosSettingsRepo['list'] = async (siteIds) => {
    if (siteIds !== 'all' && siteIds.length === 0) return [];
    const rows = await db
      .select({ siteId: sites.id, name: sites.name, city: sites.city, widen: siteSosSettings.widenAfterS, updatedAt: siteSosSettings.updatedAt })
      .from(sites)
      .leftJoin(siteSosSettings, eq(siteSosSettings.siteId, sites.id))
      .where(siteIds === 'all' ? undefined : inArray(sites.id, siteIds))
      .orderBy(asc(sites.name));
    return rows.map((r) => ({
      siteId: r.siteId,
      name: r.name,
      city: r.city,
      widenAfterS: r.widen ?? sosThresholds.widenDefault,
      custom: r.widen !== null,
      updatedAt: r.updatedAt,
    }));
  };
  return {
    list,
    async set(siteId, v, actor) {
      const [before] = await list([siteId]);
      if (!before) return null;
      await db.transaction(async (tx) => {
        await tx
          .insert(siteSosSettings)
          .values({ siteId, ...v, updatedBy: actor })
          .onConflictDoUpdate({ target: siteSosSettings.siteId, set: { ...v, updatedBy: actor } });
        await tx.insert(auditEvents).values({
          actorUserId: actor,
          actorRole: 'super_admin',
          action: 'sos_thresholds_changed',
          entityType: 'site',
          entityId: siteId,
          metadata: { from: { widen: before.widenAfterS }, to: { widen: v.widenAfterS } },
        });
      });
      return (await list([siteId]))[0] ?? null;
    },
  };
}

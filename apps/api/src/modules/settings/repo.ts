// Platform-wide settings (plan §11): one row, changed by the super admin, audited.
import { auditEvents, eq, opsSettings, type Db } from '@repo/db';

export type AppLanguage = 'en' | 'te' | 'hi';
const ORDER: AppLanguage[] = ['en', 'te', 'hi'];

export interface OpsSettingsRepo {
  deskPhone(): Promise<string | null>;
  /** Always starts with 'en'. */
  languages(): Promise<AppLanguage[]>;
  /** English is always kept. Audited with the list before and after. */
  setLanguages(enabled: Exclude<AppLanguage, 'en'>[], actor: string): Promise<AppLanguage[]>;
  /** Audited with the number before and after. */
  setDeskPhone(phone: string | null, actor: string): Promise<void>;
}

export function drizzleOpsSettingsRepo(db: Db): OpsSettingsRepo {
  const languages = async () => {
    const [r] = await db.select({ languages: opsSettings.languages }).from(opsSettings).where(eq(opsSettings.id, true));
    return ORDER.filter((l) => l === 'en' || r?.languages.includes(l));
  };
  return {
    languages,
    async setLanguages(enabled, actor) {
      const next = ORDER.filter((l) => l === 'en' || (enabled as AppLanguage[]).includes(l));
      await db.transaction(async (tx) => {
        const [before] = await tx.select({ languages: opsSettings.languages }).from(opsSettings).where(eq(opsSettings.id, true)).for('update');
        await tx.insert(opsSettings).values({ id: true, languages: next, updatedBy: actor }).onConflictDoUpdate({ target: opsSettings.id, set: { languages: next, updatedBy: actor } });
        await tx.insert(auditEvents).values({ actorUserId: actor, actorRole: 'super_admin', action: 'languages_changed', entityType: 'ops_settings', entityId: null, metadata: { from: before?.languages ?? ['en'], to: next } });
      });
      return languages();
    },
    async deskPhone() {
      const [r] = await db.select({ deskPhone: opsSettings.deskPhone }).from(opsSettings).where(eq(opsSettings.id, true));
      return r?.deskPhone ?? null;
    },
    async setDeskPhone(phone, actor) {
      await db.transaction(async (tx) => {
        const [before] = await tx.select({ deskPhone: opsSettings.deskPhone }).from(opsSettings).where(eq(opsSettings.id, true)).for('update');
        await tx
          .insert(opsSettings)
          .values({ id: true, deskPhone: phone, updatedBy: actor })
          .onConflictDoUpdate({ target: opsSettings.id, set: { deskPhone: phone, updatedBy: actor } });
        await tx.insert(auditEvents).values({
          actorUserId: actor,
          actorRole: 'super_admin',
          action: 'desk_phone_changed',
          entityType: 'ops_settings',
          entityId: null,
          metadata: { from: before?.deskPhone ?? null, to: phone },
        });
      });
    },
  };
}

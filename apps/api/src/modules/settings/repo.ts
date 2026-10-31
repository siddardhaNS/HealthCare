// Platform-wide settings (plan §11): one row, changed by the super admin, audited.
import { auditEvents, eq, opsSettings, type Db } from '@repo/db';

export interface OpsSettingsRepo {
  deskPhone(): Promise<string | null>;
  /** Audited with the number before and after. */
  setDeskPhone(phone: string | null, actor: string): Promise<void>;
}

export function drizzleOpsSettingsRepo(db: Db): OpsSettingsRepo {
  return {
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

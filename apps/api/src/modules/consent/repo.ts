import type { ConsentPurpose } from '@repo/contracts';
import { asUser, consents, desc, eq, type Db } from '@repo/db';
import type { ConsentRow } from './policy';

export interface ConsentRepo {
  /** All consent events for a person, newest first (read as that person: RLS applies). */
  history(userId: string): Promise<ConsentRow[]>;
  /** Appends one consent event, written as the acting user so RLS checks it. */
  record(actorId: string, row: Omit<ConsentRow, 'createdAt' | 'actedBy'>): Promise<ConsentRow>;
}

function toRow(r: typeof consents.$inferSelect): ConsentRow {
  return {
    purpose: r.purpose as ConsentPurpose,
    scopeKey: r.scopeKey,
    status: r.status,
    noticeVersion: r.noticeVersion,
    language: r.language,
    actedBy: r.actedBy,
    userId: r.userId,
    createdAt: r.createdAt,
  };
}

export function drizzleConsentRepo(db: Db): ConsentRepo {
  return {
    history: (userId) => asUser(db, { sub: userId }, async (tx) => (await tx.select().from(consents).where(eq(consents.userId, userId)).orderBy(desc(consents.createdAt))).map(toRow)),
    record: (actorId, row) =>
      asUser(db, { sub: actorId }, async (tx) => {
        const [r] = await tx
          .insert(consents)
          .values({ ...row, actedBy: actorId })
          .returning();
        return toRow(r!);
      }),
  };
}

import { randomInt } from 'node:crypto';
import type { Lead, LeadRequest } from '@repo/contracts';
import { desc, eq, leads, type Db } from '@repo/db';

type LeadStatus = Lead['status'];

export interface LeadsRepo {
  create(input: Omit<LeadRequest, 'consent' | 'website'>): Promise<{ id: string; ref: string }>;
  list(filter: { status?: LeadStatus; limit: number }): Promise<Lead[]>;
  setStatus(id: string, status: LeadStatus, by: string): Promise<Lead | null>;
}

// Crockford base32 without I, L, O, U: easy to read out on a call.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Neutral, speakable reference such as L-7K3Q9P (no brand initials). */
export function newLeadRef(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `L-${s}`;
}

function toLead(r: typeof leads.$inferSelect): Lead {
  return {
    id: r.id,
    ref: r.ref,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    orgType: r.orgType as Lead['orgType'],
    orgName: r.orgName,
    city: r.city,
    area: r.area,
    size: r.size,
    contactName: r.contactName,
    contactRole: r.contactRole as Lead['contactRole'],
    phone: r.phone,
    email: r.email,
    services: r.services as Lead['services'],
    plan: r.plan as Lead['plan'],
    walkthrough: r.walkthrough as Lead['walkthrough'],
    notes: r.notes,
  };
}

export function drizzleLeadsRepo(db: Db): LeadsRepo {
  return {
    async create(input) {
      const values = { ...input, orgName: input.orgName ?? null, area: input.area ?? null, pin: input.pin ?? null, towers: input.towers ?? null, notes: input.notes ?? null };
      // A clash in 32^6 refs is very unlikely; retry once on the unique constraint.
      for (let attempt = 0; ; attempt++) {
        try {
          const [row] = await db
            .insert(leads)
            .values({ ...values, ref: newLeadRef() })
            .returning({ id: leads.id, ref: leads.ref });
          return row!;
        } catch (err) {
          if (attempt >= 1 || (err as { code?: string }).code !== '23505') throw err;
        }
      }
    },
    async list({ status, limit }) {
      const q = db.select().from(leads).orderBy(desc(leads.createdAt)).limit(limit);
      const rows = status ? await q.where(eq(leads.status, status)) : await q;
      return rows.map(toLead);
    },
    async setStatus(id, status, by) {
      const [row] = await db.update(leads).set({ status, statusChangedBy: by }).where(eq(leads.id, id)).returning();
      return row ? toLead(row) : null;
    },
  };
}

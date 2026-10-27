import type { Redis } from '@upstash/redis';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A position older than this is not used for dispatch (the phone went quiet). */
export const POSITION_FRESH_S = 10 * 60;

/** Live positions of on-duty crews (plan §4: `geo:crews:on_duty`, `pos:crew:{id}`). */
export interface CrewLocator {
  set(crewId: string, at: LatLng): Promise<void>;
  remove(crewId: string): Promise<void>;
  /** Crews with a fresh position within `radiusM` of `from`, nearest first. */
  nearby(from: LatLng, radiusM: number, limit: number): Promise<{ crewId: string; distanceM: number }[]>;
  /** Straight-line distance to each crew with a fresh position (others are left out). */
  distances(from: LatLng, crewIds: string[]): Promise<Map<string, number>>;
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

const GEO_KEY = 'geo:crews:on_duty';
const posKey = (crewId: string) => `pos:crew:${crewId}`;

export function upstashCrewLocator(redis: Redis): CrewLocator {
  return {
    async set(crewId, at) {
      await redis.geoadd(GEO_KEY, { latitude: at.lat, longitude: at.lng, member: crewId });
      // The timestamped copy expires, which is how stale positions drop out.
      await redis.set(posKey(crewId), at, { ex: POSITION_FRESH_S });
    },
    async remove(crewId) {
      await redis.zrem(GEO_KEY, crewId);
      await redis.del(posKey(crewId));
    },
    async nearby(from, radiusM, limit) {
      const hits = await redis.geosearch<string>(GEO_KEY, { type: 'FROMLONLAT', coordinate: { lon: from.lng, lat: from.lat } }, { type: 'BYRADIUS', radius: radiusM, radiusType: 'M' }, 'ASC', {
        count: { limit: limit * 3 },
        withDist: true,
      });
      if (hits.length === 0) return [];
      const fresh = await redis.mget<(LatLng | null)[]>(...hits.map((h) => posKey(h.member)));
      return hits.filter((_, i) => fresh[i]).slice(0, limit).map((h) => ({ crewId: h.member, distanceM: Math.round(h.dist ?? 0) }));
    },
    async distances(from, crewIds) {
      if (crewIds.length === 0) return new Map();
      const at = await redis.mget<(LatLng | null)[]>(...crewIds.map(posKey));
      return new Map(
        crewIds.flatMap((id, i) => {
          const p = at[i];
          return p ? [[id, distanceM(from, p)] as const] : [];
        }),
      );
    },
  };
}

/** Tests and single-process local development. */
export function memoryCrewLocator(now: () => number = Date.now): CrewLocator {
  const positions = new Map<string, LatLng & { at: number }>();
  const fresh = (id: string) => {
    const p = positions.get(id);
    return p && now() - p.at < POSITION_FRESH_S * 1000 ? p : null;
  };
  return {
    async set(crewId, at) {
      positions.set(crewId, { ...at, at: now() });
    },
    async remove(crewId) {
      positions.delete(crewId);
    },
    async nearby(from, radiusM, limit) {
      return [...positions.keys()]
        .flatMap((crewId) => {
          const p = fresh(crewId);
          return p ? [{ crewId, distanceM: distanceM(from, p) }] : [];
        })
        .filter((c) => c.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, limit);
    },
    async distances(from, crewIds) {
      return new Map(
        crewIds.flatMap((id) => {
          const p = fresh(id);
          return p ? [[id, distanceM(from, p)] as const] : [];
        }),
      );
    },
  };
}

/** See processMemoryKv: request handlers and workflow steps must share one locator locally. */
export function processMemoryCrewLocator(): CrewLocator {
  const g = globalThis as Record<symbol, CrewLocator | undefined>;
  return (g[Symbol.for('api.memoryCrewLocator')] ??= memoryCrewLocator());
}

import type { DeskIncident, FleetCrew } from '@repo/contracts';
import { cn } from '@repo/ui-web';

const W = 800;
const H = 420;
const PAD = 48;
/** Never zoom in closer than this (km across), so one incident does not fill the map. */
const MIN_SPAN_KM = 3;

type Pt = { lat: number; lng: number };

/** Equirectangular projection fitted to the points, keeping distances true in both directions. */
function projector(points: Pt[]) {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.57;
  const xs = points.map((p) => p.lng * kx);
  const ys = points.map((p) => p.lat * ky);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, ((maxY - minY) * (W - 2 * PAD)) / (H - 2 * PAD), MIN_SPAN_KM);
  const scale = (W - 2 * PAD) / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { at: (p: Pt) => ({ x: W / 2 + (p.lng * kx - cx) * scale, y: H / 2 - (p.lat * ky - cy) * scale }), kmPx: scale };
}

/** A scale bar length that reads well: 0.5, 1, 2, 5 or 10 km. */
const niceKm = (kmPx: number) => [0.5, 1, 2, 5, 10, 20].find((k) => k * kmPx >= 60) ?? 20;

export function EmergencyMap(props: {
  incidents: DeskIncident[];
  crews: FleetCrew[];
  selectedId: string | null;
  labels: { title: string; a11y: string; note: string; empty: string; sos: string; free: string; busy: string; drill: string; scale: string };
}) {
  const sos = props.incidents.filter((i): i is DeskIncident & { location: Pt } => !!i.location);
  const crews = props.crews.filter((c): c is FleetCrew & { position: Pt } => c.onDuty && !!c.position);
  const points: Pt[] = [...sos.map((i) => i.location), ...crews.map((c) => c.position)];
  const p = points.length ? projector(points) : null;
  const scaleKm = p ? niceKm(p.kmPx) : 1;

  return (
    <section aria-labelledby="map-title" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <h2 id="map-title" className="flex-1 font-display text-title font-bold">
          {props.labels.title}
        </h2>
        <Legend className="bg-danger" text={props.labels.sos} round />
        <Legend className="bg-map-ambulance" text={props.labels.free} />
        <Legend className="bg-danger" text={props.labels.busy} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={props.labels.a11y} className="block h-auto w-full bg-map-bg">
        <rect width={W} height={H} className="fill-map-bg" />
        {[1, 2, 3].map((n) => (
          <g key={n} className="stroke-map-road" strokeWidth={10} opacity={0.6}>
            <line x1={0} x2={W} y1={(H / 4) * n} y2={(H / 4) * n} />
            <line y1={0} y2={H} x1={(W / 4) * n} x2={(W / 4) * n} />
          </g>
        ))}
        {!p ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-map-label font-body text-body">
            {props.labels.empty}
          </text>
        ) : null}
        {p
          ? crews.map((c) => {
              const a = p.at(c.position);
              const job = c.incidentId ? sos.find((i) => i.id === c.incidentId) : undefined;
              const to = job ? p.at(job.location) : null;
              return (
                <g key={c.crewId}>
                  {to ? <line x1={a.x} y1={a.y} x2={to.x} y2={to.y} className="stroke-danger" strokeWidth={4} strokeDasharray="9 7" strokeLinecap="round" /> : null}
                  {c.incidentId ? (
                    <g>
                      <circle cx={a.x} cy={a.y} r={15} className="fill-danger" />
                      <path d={`M${a.x} ${a.y - 7}v14M${a.x - 7} ${a.y}h14`} className="stroke-on-danger" strokeWidth={2.6} strokeLinecap="round" />
                    </g>
                  ) : (
                    <rect x={a.x - 10} y={a.y - 8} width={20} height={16} rx={4} className="fill-map-ambulance" />
                  )}
                  {c.registration ? (
                    <text x={a.x + 18} y={a.y + 4} className="fill-map-label font-mono text-caption">
                      {c.registration}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
        {p
          ? sos.map((i) => {
              const a = p.at(i.location);
              const selected = i.id === props.selectedId;
              return (
                <a key={i.id} href={`/?incident=${i.id}`} aria-label={i.ref}>
                  <circle cx={a.x} cy={a.y} r={selected ? 34 : 26} className="fill-danger" opacity={0.14} />
                  <circle cx={a.x} cy={a.y} r={selected ? 20 : 15} className="fill-danger" opacity={0.24} />
                  <circle cx={a.x} cy={a.y} r={9} className="fill-danger stroke-map-bg" strokeWidth={3} />
                  <text x={a.x + 14} y={a.y - 14} className={cn('fill-map-text font-mono text-small', selected && 'font-bold')}>
                    {i.isDrill ? `${i.ref} · ${props.labels.drill}` : i.ref}
                  </text>
                </a>
              );
            })
          : null}
        {p ? (
          <g className="fill-map-label stroke-map-label">
            <line x1={24} x2={24 + scaleKm * p.kmPx} y1={H - 24} y2={H - 24} strokeWidth={3} />
            <text x={24} y={H - 32} stroke="none" className="font-body text-caption">
              {props.labels.scale.replace('{{km}}', String(scaleKm))}
            </text>
          </g>
        ) : null}
      </svg>
      <p className="px-5 py-3 text-caption text-text-muted">{props.labels.note}</p>
    </section>
  );
}

function Legend({ className, text, round }: { className: string; text: string; round?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-small text-text-muted">
      <span aria-hidden className={cn('inline-block size-3', round ? 'rounded-pill' : 'rounded-xs', className)} />
      {text}
    </span>
  );
}

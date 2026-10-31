'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { CoveragePlace } from '@repo/contracts';
import { Button, cn } from '@repo/ui-web';
import { ActionForm } from '../../_coverage/action-form';
import { assignPlaces } from '../../_coverage/actions';

export interface PlacesLabels {
  selectAll: string;
  select: string;
  kind: { site: string; household: string };
  households: string;
  noTeam: string;
  assignTo: string;
  chooseTeam: string;
  unassign: string;
  setPrimary: string;
  addBackup: string;
  primary: string;
  backupsLine: string;
  editBackups: string;
  editBackupsA11y: string;
  assigned: string;
  unnamedHome: string;
  community: string;
  coveredBy: string;
}

const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';

/** Places with checkboxes, and "set as primary" / "add as backup" for the selected ones at the bottom (plan §11). */
export function PlacesForm({ places, teams, labels }: { places: CoveragePlace[]; teams: { id: string; name: string; active: boolean }[]; labels: PlacesLabels }) {
  const table = useRef<HTMLTableElement>(null);
  const toggleAll = (on: boolean) => table.current?.querySelectorAll<HTMLInputElement>('input[data-place]').forEach((c) => (c.checked = on));

  return (
    <ActionForm action={assignPlaces} reset doneText={labels.assigned} className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-panel border border-border bg-surface">
        <table ref={table} className="w-full min-w-150 text-left text-small">
          <thead className="border-b border-border text-text-muted">
            <tr>
              <th scope="col" className="w-12 px-4 py-3">
                <input type="checkbox" aria-label={labels.selectAll} onChange={(e) => toggleAll(e.currentTarget.checked)} className="size-5" />
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {labels.community}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {labels.coveredBy}
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">{labels.editBackups}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {places.map((p) => {
              const name = p.name || labels.unnamedHome;
              return (
                <tr key={`${p.kind}:${p.id}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <input type="checkbox" name={p.kind} value={p.id} data-place aria-label={`${labels.select} ${name}`} className="size-5" />
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-semibold">{name}</div>
                    <div className="text-caption text-text-muted">
                      {[labels.kind[p.kind], p.city, p.kind === 'site' ? labels.households.replace('{{count}}', String(p.households)) : null].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className={cn(!p.teamName && 'text-warning-text')}>{p.teamName ? labels.primary.replace('{{team}}', p.teamName) : labels.noTeam}</div>
                    {p.backups.length > 0 ? (
                      <div className="text-caption text-text-muted">{labels.backupsLine.replace('{{teams}}', p.backups.map((b, i) => `${i + 1}. ${b.teamName}`).join(', '))}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/coverage/places/${p.kind}/${p.id}`}
                      aria-label={labels.editBackupsA11y.replace('{{place}}', name)}
                      className="inline-flex min-h-tap items-center text-small font-semibold text-accent-text underline-offset-4 hover:underline"
                    >
                      {labels.editBackups}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-small font-semibold">
          {labels.assignTo}
          <select name="teamId" required defaultValue="" className={field}>
            <option value="" disabled>
              {labels.chooseTeam}
            </option>
            {teams
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            <option value="none">{labels.unassign}</option>
          </select>
        </label>
        <Button type="submit" name="as" value="primary">
          {labels.setPrimary}
        </Button>
        <Button type="submit" name="as" value="backup" variant="outline">
          {labels.addBackup}
        </Button>
      </div>
    </ActionForm>
  );
}

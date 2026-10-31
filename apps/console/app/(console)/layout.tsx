import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { brand } from '@repo/brand';
import { createI18n } from '@repo/i18n';
import { Button } from '@repo/ui-web';
import { getStaffClaims } from '@/lib/supabase/server';
import { signOut } from '../actions';

// Every console page: a staff role and a TOTP-verified (aal2) session.
// proxy.ts routes the same way; this is the server-side check.
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const claims = await getStaffClaims();
  if (!claims) redirect('/sign-in');
  if (claims.roles.length === 0) redirect('/sign-in?error=role');
  if (claims.aal !== 'aal2') redirect('/mfa');

  const { t } = createI18n('en');
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex flex-col gap-2 border-b border-border bg-surface-raised p-5 md:w-64 md:border-r md:border-b-0">
        <span className="font-display text-title font-bold">{brand.shortName}</span>
        <nav aria-label="Console" className="mt-4 flex flex-col gap-1">
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations' || r === 'support' || r === 'community_desk') ? (
            <Link href="/" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.commandCenter')}
            </Link>
          ) : null}
          {claims.roles.includes('hospital') ? (
            <Link href="/handovers" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.partner.title')}
            </Link>
          ) : null}
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations' || r === 'support' || r === 'community_desk') ? (
            <Link href="/residents" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.residents.title')}
            </Link>
          ) : null}
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations') ? (
            <Link href="/coverage" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.coverage.title')}
            </Link>
          ) : null}
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations') ? (
            <Link href="/hospitals" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.hospitals.title')}
            </Link>
          ) : null}
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations' || r === 'support' || r === 'community_desk') ? (
            <Link href="/sos-settings" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.thresholds.title')}
            </Link>
          ) : null}
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations') ? (
            <Link href="/leads" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.leads.title')}
            </Link>
          ) : null}
          {claims.roles.some((r) => r === 'super_admin' || r === 'operations') ? (
            <Link href="/settings" className="rounded-control px-3 py-2 font-semibold text-text-muted hover:bg-surface hover:text-text">
              {t('console.settings.title')}
            </Link>
          ) : null}
        </nav>
        <div className="mt-auto flex flex-col gap-2 pt-6">
          {claims.email ? <span className="text-small text-text-muted">{t('console.signedInAs', { email: claims.email })}</span> : null}
          <form action={signOut}>
            <Button variant="ghost" type="submit" className="px-0">
              {t('console.signOut')}
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex flex-1 flex-col gap-6 p-6 md:p-10">{children}</main>
    </div>
  );
}

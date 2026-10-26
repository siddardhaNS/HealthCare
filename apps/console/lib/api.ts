import { createApiClient } from '@repo/api-client';
import { createClient } from './supabase/server';

/** Typed API client for server code, authenticated as the signed-in staff member. */
export async function serverApi() {
  const supabase = await createClient();
  return createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    // The API verifies the JWT itself; the cookie session only carries it.
    getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
  });
}

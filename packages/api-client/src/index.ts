// Typed API client for every app. Types are generated from the API's OpenAPI
// document: run `pnpm openapi` at the repo root after changing a route.
import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './generated/schema';

export type { components, paths };
export type Schemas = components['schemas'];

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Supabase access token, if signed in. */
  getAccessToken?: () => Promise<string | null | undefined>;
}

export function createApiClient({ baseUrl, getAccessToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl });
  if (getAccessToken) {
    const auth: Middleware = {
      async onRequest({ request }) {
        const token = await getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

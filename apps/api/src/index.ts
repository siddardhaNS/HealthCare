// Vercel zero-config entry: the default export is the Hono app, served as
// Vercel Functions (Fluid compute) in bom1 per vercel.json.
import { createApp } from './app';

const app = createApp();

export default app;

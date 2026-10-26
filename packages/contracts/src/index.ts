// Shared request/response schemas. Source of the OpenAPI spec (the API
// registers these with @hono/zod-openapi) and of the types every app uses.
// `z` comes from @hono/zod-openapi so schemas can carry `.openapi()` metadata.
import { z } from '@hono/zod-openapi';
import { appRoles } from './roles';

export { z };

export const ErrorBody = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'not_found' }),
      message: z.string().openapi({ example: 'Resource not found' }),
      requestId: z.string().optional(),
    }),
  })
  .openapi('ErrorBody');
export type ErrorBody = z.infer<typeof ErrorBody>;

export const HealthStatus = z
  .object({
    status: z.literal('ok'),
    region: z.string().openapi({ example: 'bom1' }),
    version: z.string().openapi({ example: '0.0.0' }),
    time: z.string().datetime(),
  })
  .openapi('HealthStatus');
export type HealthStatus = z.infer<typeof HealthStatus>;

/** Indian mobile number in E.164 form. */
export const PhoneIN = z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number').openapi({ example: '+919876543210' });

/** Client-generated key so retried writes (e.g. POST /sos) are applied once. */
export const IdempotencyKey = z.string().uuid().openapi({ example: '2f1c6c2e-8b1f-4a8e-9d3a-3c2e9f6b7a10' });

/** Customer organisation types; a household may belong to none of them. */
export const OrganisationType = z.enum(['community', 'senior_home', 'employer']).openapi('OrganisationType');

export const Language = z.enum(['en', 'te', 'hi']).openapi('Language');
export type Language = z.infer<typeof Language>;

// ── Auth ────────────────────────────────────────────────────────────────

export * from './roles';

export const AppRole = z.enum(appRoles).openapi('AppRole');
export type AppRole = z.infer<typeof AppRole>;

export const OtpChannel = z.enum(['whatsapp', 'sms']).openapi('OtpChannel');
export type OtpChannel = z.infer<typeof OtpChannel>;

export const OtpIntentRequest = z
  .object({
    phone: PhoneIN,
    channel: OtpChannel,
    language: Language.default('en'),
  })
  .openapi('OtpIntentRequest');
export type OtpIntentRequest = z.infer<typeof OtpIntentRequest>;

export const WhatsappOptinRequest = z
  .object({
    /** Version of the WhatsApp notice shown on the sign-in screen. */
    consentVersion: z.string().min(1).max(40),
  })
  .openapi('WhatsappOptinRequest');
export type WhatsappOptinRequest = z.infer<typeof WhatsappOptinRequest>;

export const Me = z
  .object({
    userId: z.string().uuid(),
    phone: z.string().nullable(),
    roles: z.array(AppRole),
    aal: z.enum(['aal1', 'aal2']),
  })
  .openapi('Me');
export type Me = z.infer<typeof Me>;

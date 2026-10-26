// Dependency-free role constants, safe to import from the mobile apps
// (the main entry pulls in the OpenAPI tooling).

/** Mirrors the app_role enum in supabase/migrations/*_auth.sql. */
export const appRoles = [
  'super_admin',
  'operations',
  'community_desk',
  'support',
  'doctor',
  'pharmacy',
  'lab',
  'hospital',
  'crew',
  'phlebotomist',
  'companion',
  'rider',
] as const;
export type AppRole = (typeof appRoles)[number];

/** Roles that sign in to the console (email + TOTP, aal2 required). */
export const consoleRoles = ['super_admin', 'operations', 'community_desk', 'support', 'doctor', 'pharmacy', 'lab', 'hospital'] as const satisfies readonly AppRole[];

/** Roles that use the field app (phone OTP). */
export const fieldRoles = ['crew', 'phlebotomist', 'companion', 'rider'] as const satisfies readonly AppRole[];
export type FieldRole = (typeof fieldRoles)[number];

export const isFieldRole = (r: string): r is FieldRole => (fieldRoles as readonly string[]).includes(r);

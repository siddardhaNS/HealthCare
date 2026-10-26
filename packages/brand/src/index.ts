import data from '../brand.json' with { type: 'json' };

export interface Brand {
  /** Display name inserted wherever copy uses {{brand}}. */
  name: string;
  shortName: string;
  legalEntityName: string;
  tagline: string;
  domains: {
    primary: string;
    web: string;
    console: string;
    api: string;
    /** Host for universal links (iOS) and app links (Android). */
    links: string;
    /** Sending domain for transactional email. */
    email: string;
  };
  support: { phone: string; email: string };
  whatsappDisplayName: string;
  /** DLT-registered 6-character SMS sender header. */
  smsSenderHeader: string;
  logo: { source: string };
  /** Names used before a rename; the CI brand check also blocks these. */
  formerNames: string[];
  /** Domains used before a rename; keep them redirecting. */
  previousDomains: string[];
}

export const brand: Brand = data;

/** Values every i18n string can interpolate, e.g. "Open {{brand}}". */
export const brandVars = {
  brand: brand.name,
  brandShort: brand.shortName,
  supportPhone: brand.support.phone,
  supportEmail: brand.support.email,
} as const;

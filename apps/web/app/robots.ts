import type { MetadataRoute } from 'next';
import { brand } from '@repo/brand';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `https://${brand.domains.web}/sitemap.xml`,
  };
}

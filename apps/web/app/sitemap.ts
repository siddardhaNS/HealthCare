import type { MetadataRoute } from 'next';
import { brand } from '@repo/brand';

// One page today; add routes here as the site grows.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `https://${brand.domains.web}`, changeFrequency: 'monthly', priority: 1 }];
}

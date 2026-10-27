import type { IconName } from '@repo/ui-web';
import type { ServiceKey } from './copy';

// Literal class names so Tailwind generates them. Every value is a semantic
// service token; the colours themselves live in @repo/tokens.
export const serviceStyle: Record<ServiceKey, { icon: IconName; fg: string; fill: string; soft: string; ring: string }> = {
  consult: { icon: 'steth', fg: 'text-service-consult', fill: 'bg-service-consult', soft: 'bg-service-consult-soft', ring: 'border-service-consult ring-1 ring-service-consult' },
  pharmacy: { icon: 'pill', fg: 'text-service-pharmacy', fill: 'bg-service-pharmacy', soft: 'bg-service-pharmacy-soft', ring: 'border-service-pharmacy ring-1 ring-service-pharmacy' },
  lab: { icon: 'flask', fg: 'text-service-lab', fill: 'bg-service-lab', soft: 'bg-service-lab-soft', ring: 'border-service-lab ring-1 ring-service-lab' },
  companion: { icon: 'people', fg: 'text-service-companion', fill: 'bg-service-companion', soft: 'bg-service-companion-soft', ring: 'border-service-companion ring-1 ring-service-companion' },
  sos: { icon: 'siren', fg: 'text-service-sos', fill: 'bg-service-sos', soft: 'bg-service-sos-soft', ring: 'border-service-sos ring-1 ring-service-sos' },
};

export const serviceOrder: ServiceKey[] = ['consult', 'pharmacy', 'lab', 'companion', 'sos'];

// The SOS notification run on the Workflow runtime (plan §13): alerts at once,
// a durable 60 s sleep (fast-forwarded here), then SMS for what WhatsApp didn't deliver.
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getRun, start } from 'workflow/api';
import { waitForSleep } from '@workflow/vitest';
import { memoryKv } from '../src/lib/kv';
import type { SmsSend, WhatsAppSend } from '../src/modules/messaging/providers';
import type { SosAlertsRepo, SosNotifyDeps } from '../src/modules/sos/alerts';
import { NOTIFY_DEPS, sosNotify } from '../src/modules/sos/notify';
import { raise } from '../src/modules/sos/service';
import { fakeHouseholds } from './fake-households';
import { fakeSos } from './fake-sos';
import { fakeRepo } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';

let sos: ReturnType<typeof fakeSos>;
let store: ReturnType<typeof fakeRepo>;
let whatsapp: WhatsAppSend[];
let sms: SmsSend[];

beforeEach(() => {
  sos = fakeSos();
  store = fakeRepo();
  whatsapp = [];
  sms = [];
  const audience: SosAlertsRepo = {
    async audience() {
      return { name: 'Lakshmi Rao', language: 'en', family: [], deskPhone: '+914023456789', gatePhone: null, place: 'B-1204, Green Meadows' };
    },
    async hospitalName() {
      return null;
    },
  };
  const deps: SosNotifyDeps = {
    sos: sos.repo,
    consents: { history: async () => [], historyForStaff: async () => [], record: async () => { throw new Error('unused'); } },
    sosAlertsRepo: audience,
    messaging: {
      kv: memoryKv(),
      repo: store.repo,
      whatsapp: { sendTemplate: async (m) => (whatsapp.push(m), { messageId: `wamid.${whatsapp.length}` }) },
      sms: { sendTemplate: async (m) => (sms.push(m), { requestId: `sms-${sms.length}` }) },
      fallbackKey: randomBytes(32),
      smsTemplateIds: { otp_code: 'dlt-otp', sos_alert_desk: 'dlt-sos-desk' },
    },
  };
  (globalThis as Record<symbol, unknown>)[NOTIFY_DEPS] = deps;
});

describe('SOS notification workflow', () => {
  it('alerts the desk now, sleeps 60 s, then sends SMS because WhatsApp never confirmed delivery', async () => {
    const { incident } = await raise({ sos: sos.repo, households: fakeHouseholds([]).repo }, { id: MOM, role: 'resident' }, MOM, { idempotencyKey: randomUUID() });
    const run = getRun<number>((await start(sosNotify, [incident.id])).runId);
    const sleeping = await waitForSleep(run);
    expect(whatsapp.map((m) => m.template)).toEqual(['sos_alert_desk']);
    expect(sms).toHaveLength(0);
    await run.wakeUp({ correlationIds: [sleeping] });
    expect(await run.returnValue).toBe(1);
    expect(sms.map((m) => [m.to, m.templateId])).toEqual([['+914023456789', 'dlt-sos-desk']]);
  });
});

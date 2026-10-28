// Shared request/response schemas. Source of the OpenAPI spec (the API
// registers these with @hono/zod-openapi) and of the types every app uses.
// `z` comes from @hono/zod-openapi so schemas can carry `.openapi()` metadata.
import { z } from '@hono/zod-openapi';
import { leadOnsite, leadOrgTypes, leadPlans, leadRoles, leadSeniorShares, leadServices, leadStatuses, leadWalkthroughs } from './leads';
import { consentPurposes } from './consent';
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

// ── Leads (landing site sign-ups) ───────────────────────────────────────

export * from './leads';

export const LeadRequest = z
  .object({
    orgType: z.enum(leadOrgTypes),
    /** Community / organisation name; not asked for families. */
    orgName: z.string().trim().max(120).optional(),
    city: z.string().trim().min(1, 'Enter the city').max(80),
    area: z.string().trim().max(80).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'PIN code should be 6 digits')
      .optional(),
    /** Homes, employees or people to cover, depending on orgType. */
    size: z.number().int().min(1).max(100000),
    towers: z.number().int().min(1).max(500).optional(),
    seniorShare: z.enum(leadSeniorShares).default('unknown'),
    onsite: z.array(z.enum(leadOnsite)).max(leadOnsite.length).default([]),
    contactName: z.string().trim().min(1, 'Enter your name').max(80),
    contactRole: z.enum(leadRoles),
    phone: PhoneIN,
    email: z.string().trim().email('Enter a valid email address').max(160),
    services: z.array(z.enum(leadServices)).min(1, 'Pick at least one service').max(leadServices.length),
    plan: z.enum(leadPlans),
    walkthrough: z.enum(leadWalkthroughs),
    notes: z.string().trim().max(1000).optional(),
    /** The "agree to be contacted" box; the request is rejected without it. */
    consent: z.literal(true, { message: 'Please agree so we can contact you' }),
    /** Version of the consent sentence shown. */
    consentVersion: z.string().min(1).max(40),
    /** Honeypot: hidden from people, filled in by bots. The API answers as if saved and stores nothing. */
    website: z.string().max(500).optional(),
  })
  .refine((v) => v.orgType === 'family' || !!v.orgName, { message: 'Enter the name', path: ['orgName'] })
  .openapi('LeadRequest');
export type LeadRequest = z.infer<typeof LeadRequest>;

export const LeadCreated = z.object({ ref: z.string().openapi({ example: 'L-7K3Q9P' }) }).openapi('LeadCreated');
export type LeadCreated = z.infer<typeof LeadCreated>;

export const Lead = z
  .object({
    id: z.string().uuid(),
    ref: z.string(),
    createdAt: z.string().datetime(),
    status: z.enum(leadStatuses),
    orgType: z.enum(leadOrgTypes),
    orgName: z.string().nullable(),
    city: z.string(),
    area: z.string().nullable(),
    size: z.number().int(),
    contactName: z.string(),
    contactRole: z.enum(leadRoles),
    phone: z.string(),
    email: z.string(),
    services: z.array(z.enum(leadServices)),
    plan: z.enum(leadPlans),
    walkthrough: z.enum(leadWalkthroughs),
    notes: z.string().nullable(),
  })
  .openapi('Lead');
export type Lead = z.infer<typeof Lead>;

export const LeadList = z.object({ leads: z.array(Lead) }).openapi('LeadList');
export const LeadStatusUpdate = z.object({ status: z.enum(leadStatuses) }).openapi('LeadStatusUpdate');

// ── Consent ─────────────────────────────────────────────────────────────

export * from './consent';

export const ConsentPurposeSchema = z.enum(consentPurposes).openapi('ConsentPurpose');

export const ConsentState = z
  .object({
    purpose: ConsentPurposeSchema,
    scopeKey: z.string(),
    status: z.enum(['granted', 'withdrawn', 'not_asked']),
    noticeVersion: z.string().nullable(),
    /** Newer notice text exists; ask again before relying on this consent. */
    outdated: z.boolean(),
    updatedAt: z.string().datetime().nullable(),
  })
  .openapi('ConsentState');
export type ConsentState = z.infer<typeof ConsentState>;

export const ConsentList = z.object({ consents: z.array(ConsentState) }).openapi('ConsentList');

export const ConsentUpdate = z
  .object({
    purpose: ConsentPurposeSchema,
    /** Manager's user id for 'manager'; booking id for 'doctor_share'; omitted otherwise. */
    scopeKey: z.string().max(64).default(''),
    status: z.enum(['granted', 'withdrawn']),
    /** The notice version the person was shown; must be the current one. */
    noticeVersion: z.string().min(1).max(64),
    language: Language,
  })
  .openapi('ConsentUpdate');
export type ConsentUpdate = z.infer<typeof ConsentUpdate>;

export const ConsentEvent = z
  .object({ purpose: ConsentPurposeSchema, scopeKey: z.string(), status: z.enum(['granted', 'withdrawn']), noticeVersion: z.string(), language: Language, createdAt: z.string().datetime(), byManager: z.boolean() })
  .openapi('ConsentEvent');
export const ConsentHistory = z.object({ events: z.array(ConsentEvent) }).openapi('ConsentHistory');

// ── Profiles, households and family ─────────────────────────────────────

export const Profile = z
  .object({ fullName: z.string().trim().min(1, 'Enter your name').max(80), language: Language })
  .openapi('Profile');
export type Profile = z.infer<typeof Profile>;

export const Relation = z.string().trim().max(40).openapi({ example: 'son' });

export const CreateHousehold = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('standalone'),
      name: z.string().trim().max(80).optional(),
      city: z.string().trim().min(1, 'Enter the city').max(80),
      address: z.string().trim().max(200).optional(),
      pin: z.string().trim().regex(/^\d{6}$/, 'PIN code should be 6 digits').optional(),
    }),
    z.object({
      mode: z.literal('join'),
      joinCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,10}$/, 'Enter the code from your association'),
      tower: z.string().trim().max(20).optional(),
      number: z.string().trim().min(1, 'Enter your villa or flat number').max(20),
    }),
  ])
  .openapi('CreateHousehold');
export type CreateHousehold = z.infer<typeof CreateHousehold>;

export const HouseholdMember = z
  .object({
    userId: z.string().uuid(),
    fullName: z.string().nullable(),
    relation: z.string().nullable(),
    role: z.enum(['owner', 'member']),
    isMe: z.boolean(),
    /** This person may manage my care (I granted it). */
    managesMe: z.boolean(),
    /** I may manage this person's care (they granted it). */
    iManage: z.boolean(),
  })
  .openapi('HouseholdMember');

export const HouseholdInvite = z
  .object({ id: z.string().uuid(), phone: z.string(), relation: z.string().nullable(), expiresAt: z.string().datetime() })
  .openapi('HouseholdInvite');

export const HouseholdView = z
  .object({
    household: z
      .object({
        id: z.string().uuid(),
        name: z.string().nullable(),
        city: z.string().nullable(),
        community: z.object({ name: z.string(), kind: z.string(), deskPhone: z.string().nullable() }).nullable(),
        home: z.object({ tower: z.string().nullable(), number: z.string() }).nullable(),
      })
      .nullable(),
    members: z.array(HouseholdMember),
    invites: z.array(HouseholdInvite),
  })
  .openapi('HouseholdView');
export type HouseholdView = z.infer<typeof HouseholdView>;

export const InviteCreate = z.object({ phone: PhoneIN, relation: Relation.optional() }).openapi('InviteCreate');

export const MyInvite = z
  .object({ id: z.string().uuid(), householdName: z.string().nullable(), invitedBy: z.string().nullable(), relation: z.string().nullable(), expiresAt: z.string().datetime() })
  .openapi('MyInvite');
export const MyInvites = z.object({ invites: z.array(MyInvite) }).openapi('MyInvites');

export const EmergencyContactInput = z
  .object({ name: z.string().trim().min(1, 'Enter a name').max(80), relation: Relation.optional(), phone: PhoneIN, priority: z.number().int().min(1).max(5).default(1) })
  .openapi('EmergencyContactInput');
export const EmergencyContact = EmergencyContactInput.extend({ id: z.string().uuid(), relation: z.string().nullable() }).openapi('EmergencyContact');
export const EmergencyContacts = z.object({ contacts: z.array(EmergencyContact) }).openapi('EmergencyContacts');

// ── Console: residents directory ────────────────────────────────────────

export const ResidentRow = z
  .object({
    userId: z.string().uuid(),
    fullName: z.string().nullable(),
    community: z.string().nullable(),
    tower: z.string().nullable(),
    number: z.string().nullable(),
    city: z.string().nullable(),
    /** Always masked: staff never see residents' personal numbers. */
    phone: z.string().nullable(),
    role: z.enum(['owner', 'member']),
  })
  .openapi('ResidentRow');
export type ResidentRow = z.infer<typeof ResidentRow>;
export const ResidentList = z.object({ residents: z.array(ResidentRow) }).openapi('ResidentList');

export const ResidentDetail = ResidentRow.extend({
  householdSize: z.number().int(),
  /** Care team only; null for the community desk. */
  consents: z.array(ConsentState).nullable(),
  /** Whether this viewer may see medical details (care team + the person's proactive_care consent). */
  medicalAccess: z.enum(['granted', 'not_granted', 'not_permitted']),
}).openapi('ResidentDetail');
export type ResidentDetail = z.infer<typeof ResidentDetail>;

// ── Health record ───────────────────────────────────────────────────────

export * from './vitals';
import { vitalTypes as _vitalTypes } from './vitals';

export const VitalTypeSchema = z.enum(_vitalTypes).openapi('VitalType');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const HealthProfile = z
  .object({
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable(),
    heightCm: z.number().min(50).max(250).nullable(),
    dateOfBirth: isoDate.nullable(),
    sex: z.enum(['female', 'male', 'other']).nullable(),
  })
  .openapi('HealthProfile');
export type HealthProfile = z.infer<typeof HealthProfile>;

export const VitalStatusSchema = z.object({ key: z.string(), level: z.enum(['ok', 'warn', 'danger']) }).openapi('VitalStatus');

export const VitalReadingInput = z
  .object({
    type: VitalTypeSchema,
    value: z.number(),
    /** Diastolic, for blood pressure only. */
    value2: z.number().optional(),
    context: z.enum(['fasting', 'post_meal', 'random']).optional(),
    takenAt: z.string().datetime().optional(),
  })
  .openapi('VitalReadingInput');
export type VitalReadingInput = z.infer<typeof VitalReadingInput>;

export const VitalReading = z
  .object({
    id: z.string().uuid(),
    type: VitalTypeSchema,
    value: z.number(),
    value2: z.number().nullable(),
    unit: z.string(),
    context: z.string().nullable(),
    source: z.string(),
    takenAt: z.string().datetime(),
    status: VitalStatusSchema,
    /** Entered by someone other than the person (a manager or the care team). */
    enteredByOther: z.boolean(),
  })
  .openapi('VitalReading');
export type VitalReading = z.infer<typeof VitalReading>;

export const VitalSeries = z
  .object({ type: VitalTypeSchema, unit: z.string(), target: z.object({ low: z.number(), high: z.number() }).nullable(), readings: z.array(VitalReading) })
  .openapi('VitalSeries');

export const ConditionInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    status: z.enum(['controlled', 'monitoring', 'active', 'resolved']),
    diagnosedOn: isoDate.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .openapi('ConditionInput');
export const Condition = ConditionInput.extend({ id: z.string().uuid(), diagnosedOn: isoDate.nullable(), notes: z.string().nullable() }).openapi('Condition');
export type Condition = z.infer<typeof Condition>;

export const AllergyInput = z
  .object({ substance: z.string().trim().min(1).max(120), severity: z.enum(['mild', 'moderate', 'severe']), reaction: z.string().trim().max(200).optional() })
  .openapi('AllergyInput');
export const Allergy = AllergyInput.extend({ id: z.string().uuid(), reaction: z.string().nullable() }).openapi('Allergy');
export type Allergy = z.infer<typeof Allergy>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const MedicationInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    strength: z.string().trim().max(40).optional(),
    dose: z.string().trim().max(60).optional(),
    frequency: z.string().trim().max(60).optional(),
    /** Local times doses are due. */
    schedule: z.array(hhmm).max(8).default([]),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .openapi('MedicationInput');
export const DoseToday = z.object({ time: hhmm, status: z.enum(['taken', 'missed', 'skipped', 'due']) }).openapi('DoseToday');
export const Medication = MedicationInput.extend({
  id: z.string().uuid(),
  strength: z.string().nullable(),
  dose: z.string().nullable(),
  frequency: z.string().nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  active: z.boolean(),
  /** Taken ÷ scheduled over the last 30 days, 0–100; null without a schedule or history. */
  adherence30: z.number().int().min(0).max(100).nullable(),
  today: z.array(DoseToday),
}).openapi('Medication');
export type Medication = z.infer<typeof Medication>;

export const DoseMark = z.object({ time: hhmm, date: isoDate, status: z.enum(['taken', 'skipped']) }).openapi('DoseMark');

export const HealthSummary = z
  .object({
    profile: HealthProfile,
    age: z.number().int().nullable(),
    bmi: z.number().nullable(),
    latest: z.object({ bp: VitalReading.nullable(), pulse: VitalReading.nullable(), spo2: VitalReading.nullable(), sugar: VitalReading.nullable(), temp: VitalReading.nullable(), weight: VitalReading.nullable() }),
    conditions: z.array(Condition),
    allergies: z.array(Allergy),
    medications: z.array(Medication),
  })
  .openapi('HealthSummary');
export type HealthSummary = z.infer<typeof HealthSummary>;

export const VaccinationInput = z
  .object({ name: z.string().trim().min(1).max(120), doseLabel: z.string().trim().max(40).optional(), givenOn: isoDate.optional(), nextDue: isoDate.optional() })
  .openapi('VaccinationInput');
export const Vaccination = VaccinationInput.extend({ id: z.string().uuid(), doseLabel: z.string().nullable(), givenOn: isoDate.nullable(), nextDue: isoDate.nullable(), dueSoon: z.boolean() }).openapi('Vaccination');
export const VaccinationList = z.object({ vaccinations: z.array(Vaccination) }).openapi('VaccinationList');

export const InsuranceInput = z
  .object({ insurer: z.string().trim().min(1).max(120), policyNumber: z.string().trim().max(60).optional(), memberId: z.string().trim().max(60).optional(), validUntil: isoDate.optional() })
  .openapi('InsuranceInput');
export const Insurance = z
  .object({
    id: z.string().uuid(),
    insurer: z.string(),
    policyNumber: z.string().nullable(),
    memberId: z.string().nullable(),
    validUntil: isoDate.nullable(),
    expired: z.boolean(),
    /** An e-card image is on file (upload arrives with file storage). */
    hasCard: z.boolean(),
  })
  .openapi('Insurance');
export const InsuranceList = z.object({ policies: z.array(Insurance) }).openapi('InsuranceList');

/** Bluetooth meters come later (brief); manual and phone health-app imports first. */
export const DeviceInput = z
  .object({ kind: z.enum(['bp_monitor', 'glucometer', 'oximeter', 'scale', 'thermometer', 'phone']), name: z.string().trim().min(1).max(80), connection: z.enum(['manual', 'health_connect', 'healthkit']) })
  .openapi('DeviceInput');
export const Device = z
  .object({ id: z.string().uuid(), kind: DeviceInput.shape.kind, name: z.string(), connection: z.enum(['manual', 'bluetooth', 'health_connect', 'healthkit']), lastSyncAt: z.string().datetime().nullable() })
  .openapi('Device');
export const DeviceList = z.object({ devices: z.array(Device) }).openapi('DeviceList');

// ── SOS ─────────────────────────────────────────────────────────────────

export * from './sos';
import { crewSteps as _crewSteps, sosStates as _sosStates } from './sos';

export const SosStateSchema = z.enum(_sosStates).openapi('SosState');

export const GeoPoint = z
  .object({ lat: z.number().min(6).max(37.5), lng: z.number().min(68).max(97.5), accuracyM: z.number().min(0).max(10000).optional() })
  .openapi('GeoPoint', { description: 'WGS84; bounds cover India' });

export const SosRaise = z
  .object({
    /** Generated once per press on the phone; retries reuse it so only one incident is created. */
    idempotencyKey: z.string().uuid(),
    /** Best location at the time (last known, then a fresh fix). Optional: never block an SOS on GPS. */
    location: GeoPoint.optional(),
  })
  .openapi('SosRaise');

export const SosCancel = z.object({ reason: z.string().trim().max(200).optional() }).openapi('SosCancel');

export const SosEvent = z
  .object({ at: z.string().datetime(), from: SosStateSchema.nullable(), to: SosStateSchema, by: z.enum(['resident', 'crew', 'desk', 'system']), reason: z.string().nullable() })
  .openapi('SosEvent');

export const SosIncident = z
  .object({
    id: z.string().uuid(),
    state: SosStateSchema,
    isDrill: z.boolean(),
    createdAt: z.string().datetime(),
    location: GeoPoint.nullable(),
    widenAfterS: z.number().int(),
    escalateAfterS: z.number().int(),
    timeline: z.array(SosEvent),
  })
  .openapi('SosIncident');
export type SosIncident = z.infer<typeof SosIncident>;

/** The ambulance on its way, as the resident sees it: no crew names or personal numbers. */
export const SosCrewView = z
  .object({
    ambulance: z.object({ registration: z.string(), equipment: z.enum(['bls', 'als']) }).nullable(),
    /** Company-issued number (plan ⚑6); null when no ambulance is linked yet. */
    workPhone: z.string().nullable(),
    position: z.object({ lat: z.number(), lng: z.number(), at: z.string().datetime() }).nullable(),
    distanceM: z.number().int().nullable(),
    etaS: z.number().int().nullable(),
  })
  .openapi('SosCrewView');
export type SosCrewView = z.infer<typeof SosCrewView>;

/** An SOS as the person (or their family manager) sees it: the incident plus the ambulance while one is assigned. */
export const ResidentSos = SosIncident.extend({ crew: SosCrewView.nullable() }).openapi('ResidentSos');
export type ResidentSos = z.infer<typeof ResidentSos>;

// ── Dispatch (field app) ────────────────────────────────────────────────

export const CrewDuty = z
  .object({
    onDuty: z.boolean(),
    /** Where the crew is now; going on duty without one leaves them out of distance-based offers until the first location update. */
    location: GeoPoint.optional(),
  })
  .openapi('CrewDuty');

export const CrewLocation = z
  .object({
    /** Batched fixes, oldest first (the app sends every 3–5 s during a job, less often on standby). */
    points: z.array(GeoPoint.extend({ at: z.string().datetime() })).min(1).max(50),
  })
  .openapi('CrewLocation');

export const CrewStatus = z
  .object({ crewId: z.string().uuid(), onDuty: z.boolean(), team: z.string().nullable(), drillParticipant: z.boolean() })
  .openapi('CrewStatus');

/** What a crew sees when an SOS rings: where to go and how far, never medical details. */
export const DispatchOffer = z
  .object({
    id: z.string().uuid(),
    incidentId: z.string().uuid(),
    ring: z.number().int(),
    offeredAt: z.string().datetime(),
    isDrill: z.boolean(),
    location: GeoPoint.nullable(),
    distanceM: z.number().int().nullable(),
    etaS: z.number().int().nullable(),
  })
  .openapi('DispatchOffer');
export type DispatchOffer = z.infer<typeof DispatchOffer>;

export const CrewStepSchema = z.enum(_crewSteps).openapi('CrewStep');

/** The job a crew has taken: the incident (no medical details) and the next status button. */
export const CrewJob = z
  .object({ incident: SosIncident, nextStep: z.enum(_crewSteps).nullable() })
  .openapi('CrewJob');
export type CrewJob = z.infer<typeof CrewJob>;

export const CrewStepUpdate = z.object({ to: CrewStepSchema }).openapi('CrewStepUpdate');

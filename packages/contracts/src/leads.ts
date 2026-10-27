// Dependency-free lead constants, safe for browser bundles (the main entry
// pulls in the OpenAPI tooling).

export const leadOrgTypes = ['gated', 'apartment', 'township', 'senior_home', 'employer', 'family'] as const;
export const leadServices = ['consult', 'pharmacy', 'lab', 'companion', 'sos'] as const;
export const leadOnsite = ['guard', 'clinic', 'ambulance', 'pharmacy'] as const;
export const leadRoles = ['association', 'committee', 'facility', 'builder', 'hr', 'family', 'resident', 'other'] as const;
export const leadSeniorShares = ['unknown', 'lt10', '10to25', '25to50', 'gt50'] as const;
export const leadPlans = ['essentials', 'complete', 'custom', 'unsure'] as const;
export const leadWalkthroughs = ['this_week', 'this_weekend', 'next_week', 'call_me'] as const;
export const leadStatuses = ['new', 'contacted', 'walkthrough_booked', 'live'] as const;

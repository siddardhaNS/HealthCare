/** Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX), or null if invalid. */
export function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : null;
  return local && /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** For logs: +91******0001. */
export function maskPhone(phone: string): string {
  return phone.length > 7 ? `${phone.slice(0, 3)}******${phone.slice(-4)}` : '***';
}

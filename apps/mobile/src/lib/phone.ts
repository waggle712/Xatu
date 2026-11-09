/** Indian mobile numbers: 10 digits starting 6-9. Returns E.164 (+91...) or null. */
export function toIndianE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** "+919876543210" -> "+91 98765 43210" */
export function formatIndianPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export function isOtpCode(input: string): boolean {
  return /^\d{6}$/.test(input);
}

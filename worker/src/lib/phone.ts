/** Bangladesh mobile numbers: 01[3-9]XXXXXXXX. Accepts +880 / 880 prefixes, spaces and dashes. */
export function normalizeBdPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).replace(/[\s\-().]/g, '');
  s = s.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  if (s.startsWith('+880')) s = '0' + s.slice(4);
  else if (s.startsWith('880')) s = '0' + s.slice(3);
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

export function maskPhone(phone: string): string {
  return phone.length >= 11 ? `${phone.slice(0, 3)}XXXXX${phone.slice(-3)}` : phone;
}

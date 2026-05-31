import { LicenseFile, LicenseState } from './LicenseTypes';

const SECRET: string | undefined = import.meta.env.VITE_LICENSE_SECRET;

async function hmacSign(data: string): Promise<string> {
  if (!SECRET) throw new Error('VITE_LICENSE_SECRET не налаштовано');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function validateLicenseFile(raw: string): Promise<LicenseState> {
  try {
    const file: LicenseFile = JSON.parse(raw);
    if (!file.payload || !file.signature) throw new Error('Invalid format');

    const expected = await hmacSign(JSON.stringify(file.payload));
    if (expected !== file.signature) {
      return { tier: 'free', license: null, isValid: false, errorMessage: 'Підпис ліцензії недійсний' };
    }

    const now = new Date();
    const expires = new Date(file.payload.expiresAt);
    if (now > expires) {
      return { tier: 'free', license: file.payload, isValid: false, errorMessage: 'Ліцензія прострочена' };
    }

    const methods = file.payload.methods;
    const isPaid = methods.includes('All') || (methods.length > 1);
    return {
      tier: isPaid ? 'paid' : 'free',
      license: file.payload,
      isValid: true
    };
  } catch (e: any) {
    return { tier: 'free', license: null, isValid: false, errorMessage: e.message || 'Помилка читання ліцензії' };
  }
}

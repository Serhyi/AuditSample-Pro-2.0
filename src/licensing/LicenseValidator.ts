import { LicenseFile, LicenseState } from './LicenseTypes';

const SECRET: string | undefined = import.meta.env.VITE_LICENSE_SECRET;

async function hmacHex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns first 8 chars of HMAC so user can verify the key matches the generator
export async function getLicenseKeyFingerprint(): Promise<string | null> {
  if (!SECRET) return null;
  const h = await hmacHex(SECRET, 'asp-fingerprint-v1');
  return h.slice(0, 8);
}

export async function validateLicenseFile(raw: string): Promise<LicenseState> {
  try {
    if (!SECRET) {
      return { tier: 'free', license: null, isValid: false, errorMessage: 'VITE_LICENSE_SECRET не налаштовано — перезапустіть dev-сервер або перебудуйте exe після створення .env' };
    }

    const file: LicenseFile = JSON.parse(raw);
    if (!file.payload || !file.signature) throw new Error('Невірна структура файлу ліцензії');

    const expected = await hmacHex(SECRET, JSON.stringify(file.payload));
    if (expected !== file.signature) {
      const fp = await getLicenseKeyFingerprint();
      return { tier: 'free', license: null, isValid: false, errorMessage: `Підпис не збігається. Відбиток ключа у додатку: [${fp}]. Перевір чи той самий ключ використовувався у license-manager.html` };
    }

    const now = new Date();
    const expires = new Date(file.payload.expiresAt);
    if (now > expires) {
      return { tier: 'free', license: file.payload, isValid: false, errorMessage: 'Ліцензія прострочена' };
    }

    const methods = file.payload.methods;
    const isPaid = methods.includes('All') || (methods.length > 1);
    return { tier: isPaid ? 'paid' : 'free', license: file.payload, isValid: true };
  } catch (e: any) {
    return { tier: 'free', license: null, isValid: false, errorMessage: e.message || 'Помилка читання ліцензії' };
  }
}

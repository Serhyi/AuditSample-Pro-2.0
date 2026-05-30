// Run with: npx ts-node src/licensing/LicenseGenerator.ts
// Requires: VITE_LICENSE_SECRET env var or uses dev key
import * as crypto from 'crypto';
import * as fs from 'fs';

const SECRET = process.env.VITE_LICENSE_SECRET || 'ASP-DEV-KEY-2024';

function generateId(entityCode: string): string {
  const year = new Date().getFullYear();
  const code = entityCode.slice(0, 4).padEnd(4, '0');
  const digits = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  const raw = `${year}${code}${digits}`;
  const checksum = crypto.createHmac('sha256', SECRET).update(raw).digest('hex').slice(0, 4);
  return `ASP-${year}-${code}-${digits}-${checksum}`;
}

function sign(payload: object): string {
  return crypto.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');
}

const payload = {
  licenseId: generateId('12345678'),
  entityName: 'ТОВ Тест',
  entityCode: '12345678',
  email: 'test@example.com',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  methods: ['All'],
  version: '1' as const
};

const licenseFile = { payload, signature: sign(payload) };
fs.writeFileSync('license.asp', JSON.stringify(licenseFile, null, 2));
console.log('License written to license.asp');
console.log('License ID:', payload.licenseId);

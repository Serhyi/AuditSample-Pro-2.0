export type LicenseMethod = 'StopOrGo' | 'MUS' | 'Classical' | 'All';

export interface LicensePayload {
  licenseId: string;       // ASP-{year}-{code}-{5digits}-{4hex}
  entityName: string;      // юридична/фізична особа
  entityCode: string;      // ЄДРПОУ / ІПН
  email: string;
  issuedAt: string;        // ISO date
  expiresAt: string;       // ISO date
  methods: LicenseMethod[];  // ['All'] for full, ['StopOrGo'] for free
  version: '1';
}

export interface LicenseFile {
  payload: LicensePayload;
  signature: string;       // HMAC-SHA256 hex of JSON.stringify(payload)
}

export type LicenseTier = 'free' | 'paid';

export interface LicenseState {
  tier: LicenseTier;
  license: LicensePayload | null;
  isValid: boolean;
  errorMessage?: string;
}

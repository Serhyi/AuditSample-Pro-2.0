import { useState, useEffect, useCallback } from 'react';
import { LicenseState } from './LicenseTypes';
import { validateLicenseFile } from './LicenseValidator';

const STORAGE_KEY = 'asp_license';

const FREE_STATE: LicenseState = { tier: 'free', license: null, isValid: false };

function isElectronWithLicense(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.api?.license?.loadFromDisk === 'function';
}

export function useLicense() {
  const [licenseState, setLicenseState] = useState<LicenseState>(FREE_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // 1. Try loading .asp file placed next to the exe (Electron only)
      if (isElectronWithLicense()) {
        try {
          const raw = await window.api.license.loadFromDisk();
          console.log('[license] disk file present:', !!raw);
          if (raw) {
            const state = await validateLicenseFile(raw);
            console.log('[license] disk validation:', state.isValid ? 'OK' : 'FAILED', state.errorMessage || '');
            if (state.isValid) {
              setLicenseState(state);
              setLoading(false);
              return; // file-based license wins, no need to check localStorage
            }
          }
        } catch (e) {
          console.warn('[license] disk load failed:', e);
          // IPC failed — fall through to localStorage
        }
      } else {
        console.log('[license] disk loading unavailable (web version or no preload)');
      }

      // 2. Fall back to manually activated license in localStorage
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { setLoading(false); return; }
      const state = await validateLicenseFile(raw);
      setLicenseState(state);
      setLoading(false);
    })();
  }, []);

  const activateLicense = useCallback(async (fileContent: string): Promise<LicenseState> => {
    const state = await validateLicenseFile(fileContent);
    if (state.isValid) {
      localStorage.setItem(STORAGE_KEY, fileContent);
      setLicenseState(state);
    }
    return state;
  }, []);

  const removeLicense = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setLicenseState(FREE_STATE);
  }, []);

  return { licenseState, loading, activateLicense, removeLicense };
}

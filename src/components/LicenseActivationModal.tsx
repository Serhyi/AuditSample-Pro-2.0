import React, { useState, useRef } from 'react';
import { LicenseState } from '../licensing/LicenseTypes';

interface Props {
  onActivate: (content: string) => Promise<LicenseState>;
  onClose: () => void;
}

export const LicenseActivationModal: React.FC<Props> = ({ onActivate, onClose }) => {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    const text = await file.text();
    const result = await onActivate(text);
    setLoading(false);
    if (result.isValid) {
      setStatus(`Ліцензію активовано: ${result.license?.entityName} (до ${new Date(result.license!.expiresAt).toLocaleDateString('uk-UA')})`);
    } else {
      setError(result.errorMessage || 'Помилка активації');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Активація ліцензії</h2>
        <p className="text-sm text-slate-500 mb-6">Оберіть файл ліцензії <span className="font-mono">.asp</span>, отриманий від розробника.</p>

        <input ref={fileRef} type="file" accept=".asp,.json" className="hidden" onChange={handleFile} />

        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition disabled:opacity-50 mb-4"
        >
          {loading ? 'Перевірка...' : 'Обрати файл ліцензії'}
        </button>

        {status && <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3 mb-3">{status}</p>}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-3">{error}</p>}

        <button onClick={onClose} className="w-full py-2 text-sm text-slate-500 hover:text-slate-700 transition">
          {status ? 'Закрити' : 'Скасувати'}
        </button>
      </div>
    </div>
  );
};

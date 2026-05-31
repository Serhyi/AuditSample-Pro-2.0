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
  const [jsonText, setJsonText] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const fileRef = useRef<HTMLInputElement>(null);

  const activate = async (text: string) => {
    if (!text.trim()) { setError('Файл порожній або не вибрано'); return; }
    setLoading(true);
    setError(null);
    setStatus(null);
    const result = await onActivate(text);
    setLoading(false);
    if (result.isValid) {
      setStatus(`Ліцензію активовано: ${result.license?.entityName} (до ${new Date(result.license!.expiresAt).toLocaleDateString('uk-UA')})`);
    } else {
      setError(result.errorMessage || 'Помилка активації');
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await activate(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Активація ліцензії</h2>
        <p className="text-sm text-slate-500 mb-5">Оберіть файл <span className="font-mono">.asp</span> або вставте JSON вміст напряму.</p>

        {/* Mode toggle */}
        <div className="flex gap-2 bg-slate-100 p-1 rounded-xl mb-5">
          <button
            onClick={() => setMode('file')}
            className={`flex-1 py-2 text-[12px] font-bold rounded-lg transition-all ${mode === 'file' ? 'bg-white text-brand-600 shadow' : 'text-slate-400'}`}
          >
            📄 Файл .asp
          </button>
          <button
            onClick={() => setMode('paste')}
            className={`flex-1 py-2 text-[12px] font-bold rounded-lg transition-all ${mode === 'paste' ? 'bg-white text-brand-600 shadow' : 'text-slate-400'}`}
          >
            📋 Вставити JSON
          </button>
        </div>

        <input ref={fileRef} type="file" accept=".asp,.json" className="hidden" onChange={handleFile} />

        {mode === 'file' ? (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition disabled:opacity-50 mb-4"
          >
            {loading ? 'Перевірка...' : 'Обрати файл ліцензії'}
          </button>
        ) : (
          <>
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder={'{\n  "payload": {...},\n  "signature": "..."\n}'}
              rows={6}
              className="w-full border border-slate-200 rounded-xl p-3 text-[11px] font-mono text-slate-700 resize-none focus:outline-none focus:border-brand-400 mb-3"
            />
            <button
              onClick={() => activate(jsonText)}
              disabled={loading || !jsonText.trim()}
              className="w-full py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition disabled:opacity-50 mb-4"
            >
              {loading ? 'Перевірка...' : 'Активувати'}
            </button>
          </>
        )}

        {status && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl p-3 mb-3">
            ✓ {status}
          </div>
        )}
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
            ✗ {error}
          </div>
        )}

        <button onClick={onClose} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition">
          {status ? 'Закрити' : 'Скасувати'}
        </button>
      </div>
    </div>
  );
};

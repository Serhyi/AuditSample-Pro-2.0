import React from 'react';
import { Lock, Sparkles } from 'lucide-react';

interface Props {
  onActivate: () => void;
  onClose: () => void;
}

export const UpgradeModal: React.FC<Props> = ({ onActivate, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
          <Lock className="w-7 h-7 text-amber-500" strokeWidth={2} />
        </div>
      </div>
      <h2 className="text-lg font-black text-slate-800 mb-2">Метод недоступний</h2>
      <p className="text-sm text-slate-500 mb-1 leading-relaxed">
        Цей метод доступний лише у <span className="font-bold text-brand-600">PRO-версії</span>.
      </p>
      <p className="text-sm text-slate-400 mb-6 leading-relaxed">
        Безкоштовна версія включає: Stop-or-Go, Аналіз Бенфорда, Тест Граббса, Аналіз Парето, Процентільний відбір.
      </p>
      <button
        onClick={() => { onClose(); onActivate(); }}
        className="w-full py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition flex items-center justify-center gap-2 mb-3 shadow-sm"
      >
        <Sparkles className="w-4 h-4" />
        Активувати ліцензію PRO
      </button>
      <button
        onClick={onClose}
        className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition"
      >
        Закрити
      </button>
    </div>
  </div>
);

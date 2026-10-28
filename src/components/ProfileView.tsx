import React, { useState } from 'react';
import {
  User,
  MapPin,
  Target,
  Download,
  Trash2,
  Shield,
  CheckCircle2,
  Bell,
  Heart,
  AlertTriangle,
  Info
} from 'lucide-react';
import { UserProfile } from '../types';
import { StorageService } from '../services/StorageService';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { ROMANIAN_CITIES, STORES } from '../data/mockData';

interface ProfileViewProps {
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  onResetAllData: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  userProfile,
  onUpdateProfile,
  onResetAllData
}) => {
  const [profile, setProfile] = useState<UserProfile>(userProfile);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile(profile);
    StorageService.saveUserProfile(profile);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);
  };

  const handleToggleStore = (storeId: string) => {
    const exists = profile.preferredStores.includes(storeId);
    const updated = exists
      ? profile.preferredStores.filter(id => id !== storeId)
      : [...profile.preferredStores, storeId];
    setProfile({ ...profile, preferredStores: updated });
  };

  const handleExportData = () => {
    const jsonStr = StorageService.exportDataAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cosul-meu-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-4xl pb-16">
      {/* Top Banner */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Profilul Meu & Setări 👤
        </h1>
        <p className="text-slate-600 text-sm mt-0.5">
          Gestionează preferințele de cumpărături, obiectivele de economisire și datele personale.
        </p>
      </div>

      {savedFeedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Setările tale au fost salvate cu succes!</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Basic Info Card */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <User className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Date Personale & Locație</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Nume utilizator
              </label>
              <input
                type="text"
                required
                value={profile.name}
                onChange={e => setProfile({ ...profile, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Adresă e-mail
              </label>
              <input
                type="email"
                required
                value={profile.email}
                onChange={e => setProfile({ ...profile, email: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Oraș & Sector preferat
              </label>
              <select
                value={profile.city}
                onChange={e => setProfile({ ...profile, city: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500"
              >
                {ROMANIAN_CITIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-emerald-600" /> Obiectiv lunar de economisire (lei)
              </label>
              <input
                type="number"
                min="50"
                step="10"
                value={profile.monthlySavingsGoal}
                onChange={e => setProfile({ ...profile, monthlySavingsGoal: parseFloat(e.target.value) || 200 })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Favorite Stores Card */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 mb-4">
            <Heart className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Magazine Favorite</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Selectează supermarketurile la care mergi cel mai des pentru a le prioritiza în analizele de optimizare:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STORES.map(s => {
              const isPreferred = profile.preferredStores.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => handleToggleStore(s.id)}
                  className={`p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                    isPreferred
                      ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-md text-white font-black text-[10px] flex items-center justify-center ${s.brandColor}`}>
                      {s.name.charAt(0)}
                    </div>
                    <span className="font-bold text-xs text-slate-900">{s.name}</span>
                  </div>
                  {isPreferred && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all"
          >
            Salvează preferințele
          </button>
        </div>
      </form>

      {/* Transparency & Monetization Policy Card */}
      <div className="bg-blue-50/60 rounded-3xl border border-blue-200/80 p-5 sm:p-6 shadow-xs text-blue-950">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold text-sm">Transparență Comercială & Integritate</h3>
        </div>
        <p className="text-xs text-blue-900 leading-relaxed">
          Coșul Meu nu manipulează niciodată prețurile sau ordinea de clasare în favoarea magazinelor plătite. Ofertele sponsorizate sunt marcate vizibil cu eticheta „Sponsorizat”. Algoritmul comparativ afișează întotdeauna cel mai mic preț matematic calculat pe baza gramajelor normalizate.
        </p>
      </div>

      {/* GDPR & Data Management */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Shield className="w-5 h-5 text-slate-700" />
          <h3 className="font-bold text-base text-slate-900">Confidențialitate & Date Personale (GDPR)</h3>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          Datele tale (listele de cumpărături, istoricul bonurilor scanate și alerte) sunt păstrate local pe dispozitivul tău, fără colectare sau stocare de CNP, serii de buletin ori conturi bancare.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportData}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-4 h-4" />
            Exportă datele mele (JSON)
          </button>

          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Resetează toate datele
          </button>
        </div>
      </div>

      {/* Confirm Reset Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Confirmare resetare</h3>
            <p className="text-xs text-slate-500 mt-1">
              Toate listele, bonurile scanate și alertele vor fi resetate la valorile inițiale demonstrative. Această acțiune nu poate fi anulată.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium"
              >
                Anulează
              </button>
              <button
                onClick={() => {
                  onResetAllData();
                  setShowResetConfirm(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold"
              >
                Da, resetează tot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useRef } from 'react';
import {
  User,
  MapPin,
  Target,
  Download,
  Trash2,
  Shield,
  CheckCircle2,
  Heart,
  AlertTriangle,
  Camera,
  Lock,
  Globe,
  Phone,
  AtSign,
  Mail,
  Calendar,
  LogOut,
  Sparkles,
  KeyRound,
  ShieldAlert
} from 'lucide-react';
import { UserProfile } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { ROMANIAN_CITIES, STORES } from '../data/mockData.js';
import { useAuth } from '../auth/AuthProvider.js';
import { supabase } from '../lib/supabase.js';

interface ProfileViewProps {
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  onResetAllData: () => void;
  onSignOut?: () => Promise<void>;
  onNavigateToAuth?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  userProfile,
  onUpdateProfile,
  onResetAllData,
  onSignOut,
  onNavigateToAuth
}) => {
  const { user, signOut, updatePassword } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(userProfile);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Avatar upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSavedFeedback(null);

    try {
      onUpdateProfile(profile);
      StorageService.saveUserProfile(profile);
      setSavedFeedback('Profilul și preferințele au fost salvate cu succes!');
      setTimeout(() => setSavedFeedback(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'A apărut o eroare la salvarea profilului.');
    }
  };

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!user) {
      setErrorMessage('Trebuie să fii autentificat pentru a încărca un avatar personal.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Te rugăm să alegi un fișier imagine valid (JPG, PNG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Dimensiunea maximă a avatarului este de 5 MB.');
      return;
    }

    setUploadingAvatar(true);
    setErrorMessage(null);

    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      // Upload în bucketul 'avatars' din Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, {
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        throw uploadError;
      }

      // Obținere URL public
      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const avatarUrl = publicUrlData.publicUrl;
      const updatedProfile: UserProfile = {
        ...profile,
        avatarUrl,
        avatar_url: avatarUrl
      };

      setProfile(updatedProfile);
      onUpdateProfile(updatedProfile);
      setSavedFeedback('Avatarul a fost actualizat și salvat în profil!');
      setTimeout(() => setSavedFeedback(null), 3000);
    } catch (err: any) {
      console.error('Eroare upload avatar:', err);
      setErrorMessage('Nu s-a putut încărca imaginea: ' + (err.message || 'Verifică conexiunea.'));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 8) {
      setPasswordError('Parola nouă trebuie să aibă minim 8 caractere.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Parolele introduse nu coincid.');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await updatePassword(newPassword);
      if (res.error) {
        setPasswordError(res.error);
      } else {
        setPasswordSuccess('Parola ta a fost actualizată cu succes!');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setPasswordSuccess(null), 4000);
      }
    } catch (err: any) {
      setPasswordError(err.message || 'Eroare la schimbarea parolei.');
    } finally {
      setPasswordLoading(false);
    }
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

  // Formatare dată de creare
  const formattedCreatedDate = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('ro-RO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : user?.created_at
    ? new Date(user.created_at).toLocaleDateString('ro-RO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : null;

  const currentRole = profile.role || (user?.user_metadata?.is_admin ? 'admin' : 'user');
  const avatarSrc = profile.avatarUrl || profile.avatar_url;

  return (
    <div className="space-y-6 max-w-4xl pb-16">
      {/* Top Banner & Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
          <span>Profil & Setări Personale</span>
          <span className="text-emerald-600 text-xl">👤</span>
        </h1>
        <p className="text-slate-600 text-sm mt-0.5">
          Gestionează datele de identificare, securitatea contului și preferințele de cumpărături sincronizate în Supabase.
        </p>
      </div>

      {/* Unauthenticated Alert Callout */}
      {!user && (
        <div className="p-4 rounded-3xl bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm font-medium flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              Navighezi în modul <strong>Vizitator</strong>. Conectează-te pentru a sincroniza profilul, listele și alertele în contul tău securizat.
            </span>
          </div>
          {onNavigateToAuth && (
            <button
              onClick={onNavigateToAuth}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 transition-colors"
            >
              Autentificare
            </button>
          )}
        </div>
      )}

      {/* Global Feedback Notifications */}
      {savedFeedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{savedFeedback}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Profile Identity Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Avatar with Upload Button */}
          <div className="relative group shrink-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center text-slate-700 font-black text-2xl shadow-inner">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={profile.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{profile.name.charAt(0).toUpperCase()}</span>
              )}
            </div>

            {user && (
              <>
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  title="Schimbă avatarul"
                  className="absolute -bottom-2 -right-2 p-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-700/30 transition-transform active:scale-95 disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/jpg"
                  className="hidden"
                  onChange={handleAvatarFileSelect}
                />
              </>
            )}
          </div>

          {/* User Bio & Badges */}
          <div className="flex-1 text-center sm:text-left space-y-2">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {profile.name}
              </h2>

              {/* Role Badge */}
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                  currentRole === 'admin'
                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}
              >
                {currentRole === 'admin' ? 'Administrator' : 'Utilizator'}
              </span>

              {uploadingAvatar && (
                <span className="text-xs text-emerald-600 font-bold animate-pulse">
                  Se încarcă avatarul…
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-y-1 gap-x-4 text-xs text-slate-600 font-medium">
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{profile.email || user?.email || 'Fără email'}</span>
              </div>

              {profile.username && (
                <div className="flex items-center gap-1.5">
                  <AtSign className="w-3.5 h-3.5 text-slate-400" />
                  <span>@{profile.username}</span>
                </div>
              )}

              {formattedCreatedDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Membru din {formattedCreatedDate}</span>
                </div>
              )}
            </div>
          </div>

          {/* Sign Out Shortcut */}
          {user && (
            <div className="shrink-0 self-center sm:self-start">
              <button
                type="button"
                onClick={() => {
                  if (onSignOut) onSignOut();
                  else signOut();
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-red-200 hover:bg-red-50 text-slate-600 hover:text-red-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Deconectare</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section 1: Date Personale & Contact */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <User className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Informații Personale</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Nume Afișat
              </label>
              <input
                type="text"
                required
                value={profile.name}
                onChange={e => setProfile({ ...profile, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Nume de Utilizator (Username)
              </label>
              <div className="relative">
                <AtSign className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Ex: stefan_p"
                  value={profile.username || ''}
                  onChange={e =>
                    setProfile({
                      ...profile,
                      username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                    })
                  }
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> Număr de Telefon
              </label>
              <input
                type="tel"
                placeholder="Ex: 0722 000 000"
                value={profile.phoneNumber || profile.phone || ''}
                onChange={e =>
                  setProfile({
                    ...profile,
                    phoneNumber: e.target.value,
                    phone: e.target.value
                  })
                }
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-slate-400" /> Limbă Preferată
              </label>
              <select
                value={profile.preferredLanguage || 'ro'}
                onChange={e => setProfile({ ...profile, preferredLanguage: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none bg-white"
              >
                <option value="ro">Română (RO)</option>
                <option value="en">English (EN)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Oraș & Sector preferat
              </label>
              <select
                value={profile.city}
                onChange={e => setProfile({ ...profile, city: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none bg-white"
              >
                {ROMANIAN_CITIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-emerald-600" /> Obiectiv lunar de economisire (lei)
              </label>
              <input
                type="number"
                min="50"
                step="10"
                value={profile.monthlySavingsGoal}
                onChange={e =>
                  setProfile({
                    ...profile,
                    monthlySavingsGoal: parseFloat(e.target.value) || 200
                  })
                }
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Favorite Stores */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 mb-4">
            <Heart className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Magazine Favorite</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Selectează supermarketurile la care mergi cel mai des pentru a le prioritiza în analizele de optimizare a coșului:
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
                    <div
                      className={`w-6 h-6 rounded-md text-white font-black text-[10px] flex items-center justify-center ${s.brandColor}`}
                    >
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
            className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>Salvează modificările</span>
          </button>
        </div>
      </form>

      {/* Section 3: Securitate & Schimbare Parolă (Dacă este autentificat prin Supabase Auth) */}
      {user && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Lock className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Securitate & Schimbare Parolă</h3>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg">
            <p className="text-xs text-slate-500 leading-relaxed">
              Actualizează parola contului tău Supabase Auth. Parola trebuie să aibă cel puțin 8 caractere.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Parolă nouă
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Minim 8 caractere"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Confirmă parola nouă
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Re-introdu parola nouă"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {passwordError && (
              <p className="text-xs text-red-700 font-semibold bg-red-50 p-2.5 rounded-xl border border-red-200">
                {passwordError}
              </p>
            )}

            {passwordSuccess && (
              <p className="text-xs text-emerald-800 font-semibold bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                {passwordSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={passwordLoading}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors disabled:opacity-60"
            >
              {passwordLoading ? 'Se actualizează…' : 'Actualizează parola'}
            </button>
          </form>
        </div>
      )}

      {/* Section 4: Rol & Permisiuni de Sistem */}
      <div className="bg-slate-50 rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs text-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-sm text-slate-900">Nivel de Acces & Permisiuni</h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Contul tău are rolul de{' '}
          <strong className="text-slate-900 font-bold uppercase">{currentRole}</strong>.
          {currentRole === 'admin'
            ? ' Ai acces deplin la panoul administrativ de gestionare a cataloagelor și verificării calității datelor.'
            : ' Ai acces privat deplin la listele personale, bonuri scanate și alerte, protejate prin PostgreSQL Row Level Security (RLS). Rolul de administrator este protejat împotriva auto-escaladării.'}
        </p>
      </div>

      {/* GDPR & Data Management */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Shield className="w-5 h-5 text-slate-700" />
          <h3 className="font-bold text-base text-slate-900">Confidențialitate & Date Personale (GDPR)</h3>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          Datele tale personale sunt protejate pe baza identității tale de autentificare Supabase (<code className="bg-slate-100 px-1 py-0.5 rounded text-[11px] font-mono">{user?.id || 'mod-local'}</code>).
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportData}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Exportă datele mele (JSON)</span>
          </button>

          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Resetează memoria locală</span>
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
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Toate listele demonstrative și cache-ul local vor fi resetate la valorile inițiale. Această acțiune nu poate fi anulată.
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
                Da, resetează
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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
  ShieldAlert,
  Sun,
  Moon,
  Monitor,
  Palette,
  Wallet
} from 'lucide-react';
import { PersonalBudgetSettings, Product, Receipt, UserProfile, ThemeMode } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { ROMANIAN_CITIES, STORES } from '../data/mockData.js';
import { useAuth } from '../auth/AuthProvider.js';
import { supabase } from '../lib/supabase.js';
import { ProfileGdprSection } from './ProfileGdprSection.js';
import { PersonalBudgetSection } from './PersonalBudgetSection.js';
import type { LegalRoutePath } from '../config/legalConfig.js';

export type ProfileTab = 'profile' | 'budget' | 'privacy';

interface ProfileViewProps {
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  onResetAllData: () => void;
  onSignOut?: () => Promise<void>;
  onNavigateToAuth?: () => void;
  themeMode?: ThemeMode;
  onChangeTheme?: (theme: ThemeMode) => void | Promise<void>;
  onOpenCookieSettings?: () => void;
  onNavigateLegal?: (path: LegalRoutePath) => void;
  initialTab?: ProfileTab;
  receipts?: Receipt[];
  catalogProducts?: Product[];
  accessToken?: string;
  onSaveBudgetSettings?: (next: PersonalBudgetSettings) => void | Promise<void>;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  userProfile,
  onUpdateProfile,
  onResetAllData,
  onSignOut,
  onNavigateToAuth,
  themeMode = 'light',
  onChangeTheme,
  onOpenCookieSettings,
  onNavigateLegal,
  initialTab = 'profile',
  receipts = [],
  catalogProducts = [],
  accessToken,
  onSaveBudgetSettings
}) => {
  const { user, signOut, updatePassword } = useAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [profile, setProfile] = useState<UserProfile>(userProfile);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const currentRole = profile.role === 'admin' ? 'admin' : 'user';
  const avatarSrc = profile.avatarUrl || profile.avatar_url;

  const activeTheme: ThemeMode = themeMode || profile.theme || 'light';

  const handleSelectThemeOption = async (nextTheme: ThemeMode) => {
    const updated = { ...profile, theme: nextTheme };
    setProfile(updated);
    if (onChangeTheme) {
      await onChangeTheme(nextTheme);
    } else {
      onUpdateProfile(updated);
    }
    setSavedFeedback(
      user
        ? 'Preferința de temă a fost salvată în user_preferences (Supabase).'
        : 'Preferința de temă a fost salvată local pe acest dispozitiv.'
    );
    setTimeout(() => setSavedFeedback(null), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl pb-16">
      {/* Top Banner & Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
          <span>Profil & Setări Personale</span>
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm mt-0.5">
          Gestionează datele de identificare, securitatea contului, tema aplicației și preferințele de cumpărături sincronizate în Supabase.
        </p>
      </div>

      {/* Unauthenticated Alert Callout */}
      {!user && (
        <div className="p-4 rounded-3xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 text-xs sm:text-sm font-medium flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              Navighezi în modul <strong>Vizitator</strong>. Conectează-te pentru a sincroniza profilul, listele, tema și alertele în contul tău securizat.
            </span>
          </div>
          {onNavigateToAuth && (
            <button
              onClick={onNavigateToAuth}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 transition-colors cursor-pointer"
            >
              Autentificare
            </button>
          )}
        </div>
      )}

      {/* Global Feedback Notifications */}
      {savedFeedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{savedFeedback}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Profile Section Tabs */}
      <div
        role="tablist"
        aria-label="Secțiuni profil și confidențialitate"
        className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
      >
        <button
          id="profile-tab-general"
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          aria-controls="profile-panel-general"
          onClick={() => setActiveTab('profile')}
          className={`flex-1 min-w-[180px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'profile'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-700'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Profil și preferințe</span>
        </button>

        <button
          id="profile-tab-budget"
          type="button"
          role="tab"
          aria-selected={activeTab === 'budget'}
          aria-controls="profile-panel-budget"
          onClick={() => setActiveTab('budget')}
          className={`flex-1 min-w-[180px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'budget'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-700'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Buget și cheltuieli</span>
        </button>

        <button
          id="profile-tab-privacy"
          type="button"
          role="tab"
          aria-selected={activeTab === 'privacy'}
          aria-controls="profile-panel-privacy"
          onClick={() => setActiveTab('privacy')}
          className={`flex-1 min-w-[220px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'privacy'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-700'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Confidențialitate și date personale</span>
        </button>
      </div>

      {activeTab === 'profile' && (
        <div
          id="profile-panel-general"
          role="tabpanel"
          aria-labelledby="profile-tab-general"
          className="space-y-6"
        >
          {/* Profile Identity Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Avatar with Upload Button */}
          <div className="relative group shrink-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center text-slate-700 dark:text-slate-200 font-black text-2xl shadow-inner">
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
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                {profile.name}
              </h2>

              {/* Role Badge */}
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                  currentRole === 'admin'
                    ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800'
                    : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
                }`}
              >
                {currentRole === 'admin' ? 'Administrator' : 'Utilizator'}
              </span>

              {uploadingAvatar && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold animate-pulse">
                  Se încarcă avatarul…
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-y-1 gap-x-4 text-xs text-slate-600 dark:text-slate-400 font-medium">
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
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-600 dark:text-slate-300 hover:text-red-700 dark:hover:text-red-400 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Deconectare</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Appearance & Theme Settings Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Aspect & Temă Aplicație</h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {user ? 'Sincronizat în Supabase (user_preferences)' : 'Salvat local pe dispozitiv'}
          </span>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Alege tema vizuală preferată pentru întreaga aplicație Coșul Meu. Preferința este aplicată instantaneu și păstrată între sesiuni.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              id: 'light' as ThemeMode,
              title: 'Mod Luminos',
              subtitle: 'Fundal alb și contrast ridicat',
              Icon: Sun
            },
            {
              id: 'dark' as ThemeMode,
              title: 'Mod Întunecat',
              subtitle: 'Confort vizual redus pe timp de seară',
              Icon: Moon
            },
            {
              id: 'system' as ThemeMode,
              title: 'Automat (Sistem)',
              subtitle: 'Urmărește setarea dispozitivului',
              Icon: Monitor
            }
          ].map(({ id, title, subtitle, Icon }) => {
            const isSelected = activeTheme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => void handleSelectThemeOption(id)}
                aria-pressed={isSelected}
                className={`p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/60 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isSelected
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">{title}</span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    {subtitle}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section 1: Date Personale & Contact */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Informații Personale</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Prenume (opțional)
              </label>
              <input
                type="text"
                placeholder="Ex: Ștefan"
                value={profile.firstName || ''}
                onChange={e => setProfile({ ...profile, firstName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Nume (opțional)
              </label>
              <input
                type="text"
                placeholder="Ex: Popescu"
                value={profile.lastName || ''}
                onChange={e => setProfile({ ...profile, lastName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Nume Afișat
              </label>
              <input
                type="text"
                required
                value={profile.name}
                onChange={e => setProfile({ ...profile, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
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
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1 flex items-center gap-1">
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
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-slate-400" /> Limbă Preferată
              </label>
              <select
                value={profile.preferredLanguage || 'ro'}
                onChange={e => setProfile({ ...profile, preferredLanguage: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none bg-white dark:bg-slate-800"
              >
                <option value="ro">Română (RO)</option>
                <option value="en">English (EN)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Oraș & Sector preferat
              </label>
              <select
                value={profile.city}
                onChange={e => setProfile({ ...profile, city: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none bg-white dark:bg-slate-800"
              >
                {ROMANIAN_CITIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Obiectiv lunar de economisire (lei)
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
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Favorite Stores */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
            <Heart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Magazine Favorite</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
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
                  className={`p-3 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                    isPreferred
                      ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/60 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-md text-white font-black text-[10px] flex items-center justify-center ${s.brandColor}`}
                    >
                      {s.name.charAt(0)}
                    </div>
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">{s.name}</span>
                  </div>
                  {isPreferred && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Salvează modificările</span>
          </button>
        </div>
      </form>

      {/* Section 3: Securitate & Schimbare Parolă (Dacă este autentificat prin Supabase Auth) */}
      {user && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Lock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Securitate & Schimbare Parolă</h3>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Actualizează parola contului tău Supabase Auth. Parola trebuie să aibă cel puțin 8 caractere.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
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
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
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
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {passwordError && (
              <p className="text-xs text-red-700 dark:text-red-300 font-semibold bg-red-50 dark:bg-red-950/50 p-2.5 rounded-xl border border-red-200 dark:border-red-800">
                {passwordError}
              </p>
            )}

            {passwordSuccess && (
              <p className="text-xs text-emerald-800 dark:text-emerald-200 font-semibold bg-emerald-50 dark:bg-emerald-950/60 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                {passwordSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={passwordLoading}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white font-bold text-xs transition-colors disabled:opacity-60 cursor-pointer"
            >
              {passwordLoading ? 'Se actualizează…' : 'Actualizează parola'}
            </button>
          </form>
        </div>
      )}

          {/* Section 4: Rol & Permisiuni de Sistem */}
          <div className="bg-slate-50 dark:bg-slate-900/70 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xs text-slate-800 dark:text-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Nivel de Acces & Permisiuni</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Contul tău are rolul de{' '}
              <strong className="text-slate-900 dark:text-slate-100 font-bold uppercase">{currentRole}</strong>.
              {currentRole === 'admin'
                ? ' Ai acces deplin la panoul administrativ de gestionare a cataloagelor și verificării calității datelor.'
                : ' Ai acces privat deplin la listele personale, bonuri scanate și alerte, protejate prin PostgreSQL Row Level Security (RLS). Rolul de administrator este protejat împotriva auto-escaladării.'}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'budget' && (
        <div
          id="profile-panel-budget"
          role="tabpanel"
          aria-labelledby="profile-tab-budget"
        >
          <PersonalBudgetSection
            receipts={receipts}
            catalogProducts={catalogProducts}
            initialSettings={{
              monthlyBudget: userProfile.monthlyBudget ?? null,
              weeklyBudget: userProfile.weeklyBudget ?? null,
              alertThresholdPct: userProfile.budgetAlertThresholdPct ?? 80
            }}
            isAuthenticated={Boolean(user)}
            accessToken={accessToken}
            onSaveSettings={async next => {
              const updated: UserProfile = {
                ...profile,
                monthlyBudget: next.monthlyBudget,
                weeklyBudget: next.weeklyBudget,
                budgetAlertThresholdPct: next.alertThresholdPct
              };
              setProfile(updated);
              if (onSaveBudgetSettings) {
                await onSaveBudgetSettings(next);
              } else {
                onUpdateProfile(updated);
              }
            }}
          />
        </div>
      )}

      {activeTab === 'privacy' && (
        <div
          id="profile-panel-privacy"
          role="tabpanel"
          aria-labelledby="profile-tab-privacy"
        >
          {/* GDPR & Privacy Control Center */}
          <ProfileGdprSection
            userProfile={profile}
            onUpdateProfile={updated => {
              setProfile(updated);
              onUpdateProfile(updated);
            }}
            onResetAllData={onResetAllData}
            onOpenCookieSettings={onOpenCookieSettings}
            onNavigateLegal={onNavigateLegal}
          />
        </div>
      )}
    </div>
  );
};

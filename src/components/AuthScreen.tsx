import React, { FormEvent, useState } from 'react';
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  AtSign,
  ArrowLeft,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.js';

interface AuthScreenProps {
  initialMode?: 'login' | 'signup';
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'login',
  onSuccess,
  onCancel
}) => {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('Te rugăm să introduci adresa de email.');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    const result = await resetPassword(email);
    setBusy(false);
    if (result.error) {
      setError(result.error);
    } else {
      setNotice('Ți-am trimis un link de resetare pe email. Verifică și folderul Spam.');
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    if (mode === 'login') {
      const result = await signIn(email, password);
      setBusy(false);
      if (result.error) {
        setError(result.error);
      } else {
        if (onSuccess) onSuccess();
      }
    } else if (mode === 'signup') {
      if (password.length < 8) {
        setBusy(false);
        setError('Parola trebuie să aibă cel puțin 8 caractere.');
        return;
      }
      const result = await signUp(email, password, displayName, username);
      setBusy(false);
      if (result.error) {
        setError(result.error);
      } else if (result.needsConfirmation) {
        setNotice('Contul a fost creat! Verifică emailul pentru linkul de confirmare, apoi intră în cont.');
        setMode('login');
      } else {
        if (onSuccess) onSuccess();
      }
    }
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shadow-xl shadow-slate-900/5 dark:shadow-black/40 p-6 sm:p-8 backdrop-blur-sm">
        {/* Back button if cancelable */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Înapoi la Catalogul Public</span>
          </button>
        )}

        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0">
            <ShieldCheck size={26} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] font-black text-emerald-700 dark:text-emerald-400">Coșul Meu</p>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100">
              {mode === 'forgot'
                ? 'Recuperare Parolă'
                : mode === 'signup'
                ? 'Creează cont personal'
                : 'Autentificare'}
            </h1>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        {mode !== 'forgot' && (
          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 mb-6" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
              }}
              className={`flex-1 rounded-lg py-2 text-xs sm:text-sm font-bold transition cursor-pointer ${
                mode === 'login' ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Autentificare
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => {
                setMode('signup');
                setError('');
                setNotice('');
              }}
              className={`flex-1 rounded-lg py-2 text-xs sm:text-sm font-bold transition cursor-pointer ${
                mode === 'signup' ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Înregistrare Cont Nou
            </button>
          </div>
        )}

        {/* Forgot Password Flow */}
        {mode === 'forgot' ? (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Introdu adresa de email asociată contului tău și îți vom trimite un link de securitate pentru a seta o nouă parolă.
            </p>

            <label className="block">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Adresă Email</span>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-3 text-slate-400" size={17} />
                <input
                  required
                  type="email"
                  value={email}
                  placeholder="exemplu@email.ro"
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 pl-10 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </label>

            {error && <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/50 p-3 text-xs font-semibold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">{error}</p>}
            {notice && <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 p-3 text-xs font-semibold text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">{notice}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60 shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              {busy ? 'Se trimite…' : 'Trimite instrucțiuni pe email'}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setNotice('');
                }}
                className="text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
              >
                Înapoi la Autentificare
              </button>
            </div>
          </form>
        ) : (
          /* Login / Signup Flow */
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <label className="block">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Nume & Prenume</span>
                  <div className="relative mt-1">
                    <UserRound className="absolute left-3 top-3 text-slate-400" size={17} />
                    <input
                      required
                      type="text"
                      placeholder="Ex: Ștefan Popescu"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 pl-10 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Nume de utilizator (opțional)</span>
                  <div className="relative mt-1">
                    <AtSign className="absolute left-3 top-3 text-slate-400" size={17} />
                    <input
                      type="text"
                      placeholder="Ex: stefan_p"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 pl-10 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </label>
              </>
            )}

            <label className="block">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Adresă Email</span>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-3 text-slate-400" size={17} />
                <input
                  required
                  type="email"
                  placeholder="nume@exemplu.ro"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 pl-10 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Parolă</span>
              <div className="relative mt-1">
                <LockKeyhole className="absolute left-3 top-3 text-slate-400" size={17} />
                <input
                  required
                  minLength={8}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minim 8 caractere"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 pl-10 pr-11 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ascunde parola' : 'Arată parola'}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {mode === 'login' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError('');
                    setNotice('');
                  }}
                  className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  Ai uitat parola?
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/50 p-3 text-xs font-semibold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 leading-relaxed">
                {error}
              </p>
            )}

            {notice && (
              <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 p-3 text-xs font-semibold text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 leading-relaxed">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60 shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              {busy ? (
                'Se procesează…'
              ) : mode === 'login' ? (
                'Intră în cont'
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Creează cont gratuit</span>
                </>
              )}
            </button>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Date protejate prin Row Level Security</span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
            >
              Vizitează magazinul
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

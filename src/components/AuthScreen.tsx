import { FormEvent, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.js';

export function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestReset() {
    setError(''); setNotice(''); setBusy(true);
    const result = await resetPassword(email);
    setBusy(false);
    if (result.error) setError(result.error);
    else setNotice('Dacă adresa există, vei primi instrucțiunile de resetare pe email.');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    const result = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password, displayName);
    setBusy(false);
    if (result.error) setError(result.error);
    else if (mode === 'signup' && result.needsConfirmation) setNotice('Cont creat. Verifică emailul pentru confirmare, apoi autentifică-te.');
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#d1fae5,_transparent_40%),linear-gradient(135deg,#f8fafc,#ecfdf5)] flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-3xl border border-white/80 bg-white/95 shadow-2xl shadow-emerald-900/10 p-7 sm:p-9">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center"><ShieldCheck size={25} /></div>
          <div><p className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-700">Coșul Meu</p><h1 className="text-2xl font-black text-slate-900">Cumpărături mai inteligente</h1></div>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1 mb-6" role="tablist">
          {(['login', 'signup'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={mode === tab} onClick={() => { setMode(tab); setError(''); setNotice(''); }} className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${mode === tab ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>{tab === 'login' ? 'Autentificare' : 'Cont nou'}</button>)}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && <label className="block"><span className="text-sm font-bold text-slate-700">Nume afișat</span><div className="relative mt-1"><UserRound className="absolute left-3 top-3 text-slate-400" size={18} /><input required value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-emerald-500" /></div></label>}
          <label className="block"><span className="text-sm font-bold text-slate-700">Email</span><div className="relative mt-1"><Mail className="absolute left-3 top-3 text-slate-400" size={18} /><input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-emerald-500" /></div></label>
          <label className="block"><span className="text-sm font-bold text-slate-700">Parolă</span><div className="relative mt-1"><LockKeyhole className="absolute left-3 top-3 text-slate-400" size={18} /><input required minLength={8} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-11 outline-none focus:border-emerald-500" /><button type="button" aria-label={showPassword ? 'Ascunde parola' : 'Arată parola'} onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-2.5 text-slate-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
          {mode === 'login' && <button type="button" onClick={() => void requestReset()} className="text-xs font-bold text-emerald-700 hover:underline">Am uitat parola</button>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-emerald-600 py-3 font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">{busy ? 'Se procesează…' : mode === 'login' ? 'Intră în cont' : 'Creează cont'}</button>
        </form>
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">Datele contului și listele tale sunt private și accesibile doar după autentificare.</p>
      </section>
    </main>
  );
}

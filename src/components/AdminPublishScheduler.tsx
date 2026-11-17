'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CalendarClock, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';

type Scheduler = {
  id: string;
  name: string;
  retailerIds: string[];
  scheduledAt: string;
  timezone: string;
  enabled: boolean;
  alertEmail?: string | null;
  lastStatus?: 'idle' | 'running' | 'success' | 'partial' | 'failed';
  lastRunAt?: string | null;
  lastError?: string | null;
  scheduleType?: 'once' | 'daily';
  perRetailerStatus?: Record<string, { published: number; errors: string[] }>;
  lastPublishedCount?: number;
};

type Props = { adminToken: string };

export default function AdminPublishScheduler({ adminToken }: Props) {
  const [schedules, setSchedules] = useState<Scheduler[]>([]);
  const [retailers, setRetailers] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('Publicare catalog zilnic');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleType, setScheduleType] = useState<'once' | 'daily'>('once');
  const [retailerIds, setRetailerIds] = useState<string[]>([]);
  const [alertEmail, setAlertEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    const [scheduleResponse, retailerResponse] = await Promise.all([
      fetch('/api/admin/catalog-publish-schedules', { headers }),
      fetch('/api/admin/catalog-importer/sources', { headers })
    ]);
    const scheduleData = await scheduleResponse.json();
    const retailerData = await retailerResponse.json();
    if (!scheduleResponse.ok) throw new Error(scheduleData.error || 'Schedulerul nu a putut fi încărcat.');
    setSchedules(scheduleData.schedules || []);
    const uniqueRetailers = new Map<string, { id: string; name: string }>();
    for (const source of retailerData.sources || []) {
      const id = String(source.retailerId || source.id || '').trim();
      if (!id || uniqueRetailers.has(id)) continue;
      uniqueRetailers.set(id, { id, name: source.retailerName || id });
    }
    setRetailers(Array.from(uniqueRetailers.values()));
  }, [adminToken]);

  useEffect(() => { load().catch(error => setMessage(error.message)); }, [load]);

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!scheduledAt) return setMessage('Alege data și ora rulării.');
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/admin/catalog-publish-schedules', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          scheduledAt: new Date(scheduledAt).toISOString(),
          retailerIds,
          alertEmail: alertEmail || null,
          scheduleType
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Schedulerul nu a putut fi salvat.');
      setSchedules(previous => [data.schedule, ...previous]);
      setMessage('Scheduler salvat cu succes.');
    } catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  };

  const runSchedule = async (id: string) => {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/catalog-publish-schedules/${id}/run`, { method: 'POST', headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Rularea schedulerului a eșuat.');
      setMessage(`Publicare finalizată: status ${data.status?.toUpperCase() || 'OK'}, ${data.publishedCount || 0} oferte publicate.`);
      await load();
    } catch (error: any) { setMessage(error.message); await load().catch(() => undefined); } finally { setBusy(false); }
  };

  const toggleSchedule = async (schedule: Scheduler) => {
    await fetch(`/api/admin/catalog-publish-schedules/${schedule.id}`, { method: 'PATCH', headers, body: JSON.stringify({ enabled: !schedule.enabled }) });
    await load();
  };

  const deleteSchedule = async (id: string) => {
    if (!window.confirm('Ștergi această programare de publicare?')) return;
    await fetch(`/api/admin/catalog-publish-schedules/${id}`, { method: 'DELETE', headers }); await load();
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">Scheduler Automat Publicare Catalog</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Execută publicarea automată a ofertelor validate pentru retailerii selectați. Fus orar de referință: <strong className="text-slate-700 dark:text-slate-200">Europe/Bucharest</strong>.
          </p>
        </div>
        <button type="button" onClick={() => load()} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" aria-label="Reîncarcă schedulerii">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Notă explicită despre starea alertelor email */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/50 p-3 text-xs text-amber-900 dark:text-amber-100">
        <p className="font-semibold">ℹ️ Notă operațională Alerte Email:</p>
        <p className="mt-0.5 text-amber-800 dark:text-amber-200">
          Adresa de email este stocată persistent în baza de date. Notificările reale prin email se activează prin definirea variabilei de mediu <code className="px-1 py-0.5 rounded bg-amber-100/70 dark:bg-amber-900/50">RESEND_API_KEY</code> sau a serverului SMTP.
        </p>
      </div>

      <form onSubmit={createSchedule} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Nume
            <input value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 font-normal text-xs focus:outline-none focus:border-emerald-500" />
          </label>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Data și ora rulării
            <input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className="mt-1 w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 font-normal text-xs focus:outline-none focus:border-emerald-500" />
          </label>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Tip programare
            <select
              value={scheduleType}
              onChange={e => setScheduleType(e.target.value as 'once' | 'daily')}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 font-normal text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="once">O singură dată (dezactivare după succes)</option>
              <option value="daily">Recurent zilnic (+24h Europe/Bucharest)</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Alertă email
            <input type="email" value={alertEmail} onChange={event => setAlertEmail(event.target.value)} placeholder="admin@cosulmeu.ro" className="mt-1 w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-normal text-xs focus:outline-none focus:border-emerald-500" />
          </label>
          <button disabled={busy} className="self-end rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
            <Plus className="mr-1 inline h-4 w-4" />Adaugă programare
          </button>
        </div>

        <div className="mt-4">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1.5">Retaileri vizați (gol = toți retailerii):</span>
          <div className="flex flex-wrap gap-2">
            {retailers.map(retailer => (
              <label key={retailer.id} className="flex items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retailerIds.includes(retailer.id)}
                  onChange={event => setRetailerIds(current => event.target.checked ? [...current, retailer.id] : current.filter(id => id !== retailer.id))}
                  className="accent-emerald-600"
                />
                {retailer.name}
              </label>
            ))}
          </div>
        </div>
      </form>

      {message && <div className="rounded-xl border border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/50 px-3 py-2 text-xs font-semibold text-blue-800 dark:text-blue-200" role="status">{message}</div>}

      <div className="space-y-3">
        {schedules.map(schedule => (
          <article key={schedule.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-slate-900 dark:text-slate-50">{schedule.name}</h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase">
                    {schedule.scheduleType === 'daily' ? 'Recurent Zilnic' : 'O singură dată'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {new Date(schedule.scheduledAt).toLocaleString('ro-RO')} ({schedule.timezone}) · Retaileri: {schedule.retailerIds?.length ? schedule.retailerIds.join(', ') : 'Toți retailerii'}
                  {schedule.lastRunAt && ` · Ultima rulare: ${new Date(schedule.lastRunAt).toLocaleString('ro-RO')}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${
                  schedule.lastStatus === 'failed'
                    ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300'
                    : schedule.lastStatus === 'partial'
                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                    : schedule.lastStatus === 'running'
                    ? 'bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 animate-pulse'
                    : schedule.lastStatus === 'success'
                    ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}>
                  {schedule.lastStatus || 'idle'}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${schedule.enabled ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                  {schedule.enabled ? 'Activ' : 'Inactiv'}
                </span>
              </div>
            </div>

            {schedule.lastError && (
              <p className="mt-2 flex items-start gap-1 text-xs font-semibold text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/50 p-2.5 rounded-xl border border-rose-200 dark:border-rose-800/70">
                <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {schedule.lastError}
              </p>
            )}

            {/* Rezultate detaliate per retailer */}
            {schedule.perRetailerStatus && Object.keys(schedule.perRetailerStatus).length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 text-xs">
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">Rezultat per retailer:</span>
                {Object.entries(schedule.perRetailerStatus).map(([retId, res]) => (
                  <span
                    key={retId}
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] ${
                      res.errors.length > 0
                        ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300'
                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                    }`}
                  >
                    {retId.toUpperCase()}: {res.published} publicate {res.errors.length > 0 ? `(${res.errors.length} erori)` : '✓'}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => runSchedule(schedule.id)}
                disabled={busy}
                className="rounded-lg bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-50 cursor-pointer"
              >
                <Play className="mr-1 inline h-3.5 w-3.5" />Rulează acum
              </button>
              <button
                onClick={() => toggleSchedule(schedule)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {schedule.enabled ? 'Dezactivează' : 'Activează'}
              </button>
              <button
                onClick={() => deleteSchedule(schedule.id)}
                className="rounded-lg border border-rose-200 dark:border-rose-800/70 px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
              >
                <Trash2 className="mr-1 inline h-3.5 w-3.5" />Șterge
              </button>
            </div>
          </article>
        ))}

        {schedules.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Nu există programări de publicare configurate. Folosește formularul de mai sus pentru a programa publicarea automată a ofertelor validate.
          </div>
        )}
      </div>
    </section>
  );
}

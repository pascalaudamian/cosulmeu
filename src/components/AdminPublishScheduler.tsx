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
  lastStatus?: 'idle' | 'running' | 'success' | 'failed';
  lastRunAt?: string | null;
  lastError?: string | null;
};

type Props = { adminToken: string };

export default function AdminPublishScheduler({ adminToken }: Props) {
  const [schedules, setSchedules] = useState<Scheduler[]>([]);
  const [retailers, setRetailers] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('Publicare catalog zilnic');
  const [scheduledAt, setScheduledAt] = useState('');
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
    setRetailers((retailerData.sources || []).map((source: any) => ({ id: source.retailerId || source.id, name: source.retailerName || source.retailerId || source.id })));
  }, [adminToken]);

  useEffect(() => { load().catch(error => setMessage(error.message)); }, [load]);

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!scheduledAt) return setMessage('Alege data și ora rulării.');
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/admin/catalog-publish-schedules', { method: 'POST', headers, body: JSON.stringify({ name, scheduledAt: new Date(scheduledAt).toISOString(), retailerIds, alertEmail: alertEmail || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Schedulerul nu a putut fi salvat.');
      setSchedules(previous => [data.schedule, ...previous]);
      setMessage('Scheduler salvat.');
    } catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  };

  const runSchedule = async (id: string) => {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/catalog-publish-schedules/${id}/run`, { method: 'POST', headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Rularea schedulerului a eșuat.');
      setMessage(`Publicare finalizată: ${data.publishedCount || 0} oferte.`); await load();
    } catch (error: any) { setMessage(error.message); await load().catch(() => undefined); } finally { setBusy(false); }
  };

  const toggleSchedule = async (schedule: Scheduler) => {
    await fetch(`/api/admin/catalog-publish-schedules/${schedule.id}`, { method: 'PATCH', headers, body: JSON.stringify({ enabled: !schedule.enabled }) });
    await load();
  };

  const deleteSchedule = async (id: string) => {
    if (!window.confirm('Ștergi acest scheduler?')) return;
    await fetch(`/api/admin/catalog-publish-schedules/${id}`, { method: 'DELETE', headers }); await load();
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-emerald-600" /><h2 className="text-xl font-extrabold text-slate-900">Scheduler publicare catalog</h2></div>
          <p className="mt-1 text-xs text-slate-500">Configurează retailerii, data, ora și alerta pentru rulări eșuate. Pe Vercel Hobby, automatizarea rulează o singură dată pe zi la 02:00 UTC; pentru o rulare imediată folosește „Rulează acum”.</p>
        </div>
        <button type="button" onClick={() => load()} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Reîncarcă schedulerii"><RefreshCw className="h-4 w-4" /></button>
      </div>

      <form onSubmit={createSchedule} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-700">Nume<input value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          <label className="text-xs font-bold text-slate-700">Data și ora<input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          <label className="text-xs font-bold text-slate-700">Alertă email<input type="email" value={alertEmail} onChange={event => setAlertEmail(event.target.value)} placeholder="admin@exemplu.ro" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          <button disabled={busy} className="self-end rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><Plus className="mr-1 inline h-4 w-4" />Adaugă scheduler</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {retailers.map(retailer => <label key={retailer.id} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"><input type="checkbox" checked={retailerIds.includes(retailer.id)} onChange={event => setRetailerIds(current => event.target.checked ? [...current, retailer.id] : current.filter(id => id !== retailer.id))} />{retailer.name}</label>)}
        </div>
      </form>

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800" role="status">{message}</div>}

      <div className="space-y-2">
        {schedules.map(schedule => <article key={schedule.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-slate-900">{schedule.name}</h3><p className="mt-1 text-xs text-slate-500">{new Date(schedule.scheduledAt).toLocaleString('ro-RO')} · {schedule.retailerIds?.length ? schedule.retailerIds.join(', ') : 'Toți retailerii'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${schedule.lastStatus === 'failed' ? 'bg-rose-100 text-rose-700' : schedule.lastStatus === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{schedule.lastStatus || 'idle'}</span></div>
          {schedule.lastError && <p className="mt-2 flex items-start gap-1 text-xs font-semibold text-rose-700"><Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />{schedule.lastError}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => runSchedule(schedule.id)} disabled={busy} className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"><Play className="mr-1 inline h-3.5 w-3.5" />Rulează acum</button><button onClick={() => toggleSchedule(schedule)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700">{schedule.enabled ? 'Dezactivează' : 'Activează'}</button><button onClick={() => deleteSchedule(schedule.id)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Șterge</button></div>
        </article>)}
        {schedules.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Nu există schedulere configurate.</div>}
      </div>
    </section>
  );
}

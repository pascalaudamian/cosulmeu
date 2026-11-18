import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cookie,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Info,
  Lock,
  Mail,
  PauseCircle,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  UserCheck
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.js';
import { StorageService } from '../services/StorageService.js';
import { withdrawOptionalCookieConsent } from '../services/CookieConsentService.js';
import type { LegalRoutePath } from '../config/legalConfig.js';
import type {
  GdprDataExportPayload,
  GdprRequestRecord,
  GdprRequestStatus,
  GdprRequestType,
  UserProfile
} from '../types.js';

interface ProfileGdprSectionProps {
  userProfile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
  onResetAllData: () => void;
  onOpenCookieSettings?: () => void;
  onNavigateLegal?: (path: LegalRoutePath) => void;
}

const REQUEST_TYPE_LABELS: Record<GdprRequestType, string> = {
  access_data: 'Acces la date (Art. 15)',
  export_data: 'Export / Portabilitate (Art. 20)',
  rectification: 'Rectificare date (Art. 16)',
  erasure_optional_data: 'Ștergere date opționale',
  erasure_account: 'Ștergere completă cont (Art. 17)',
  restriction_processing: 'Restricționare prelucrare (Art. 18)',
  objection: 'Drept de opoziție (Art. 21)',
  withdraw_consent: 'Retragere consimțământ (Art. 7)',
  other: 'Altă solicitare GDPR'
};

const REQUEST_STATUS_STYLES: Record<GdprRequestStatus, { label: string; className: string }> = {
  noua: {
    label: 'Nouă',
    className: 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800'
  },
  in_verificare: {
    label: 'În verificare',
    className: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
  },
  procesata: {
    label: 'Procesată',
    className: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
  },
  respinsa_justificat: {
    label: 'Respinsă justificat',
    className: 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
  }
};

export const ProfileGdprSection: React.FC<ProfileGdprSectionProps> = ({
  userProfile,
  onUpdateProfile,
  onResetAllData,
  onOpenCookieSettings,
  onNavigateLegal
}) => {
  const { user, session, signOut } = useAuth();
  const accessToken = session?.access_token;

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // My data view
  const [myData, setMyData] = useState<GdprDataExportPayload | null>(null);
  const [loadingMyData, setLoadingMyData] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [exportBusy, setExportBusy] = useState<'json' | 'csv' | null>(null);

  // Quick rectification state
  const [rectFirstName, setRectFirstName] = useState(userProfile.firstName || '');
  const [rectLastName, setRectLastName] = useState(userProfile.lastName || '');
  const [rectEmail, setRectEmail] = useState(userProfile.email || user?.email || '');
  const [rectPhone, setRectPhone] = useState(userProfile.phoneNumber || userProfile.phone || '');
  const [savingRect, setSavingRect] = useState(false);

  // Communication preferences
  const [optionalNotifications, setOptionalNotifications] = useState(
    Boolean(userProfile.optionalNotificationsEnabled)
  );
  const [marketingConsent, setMarketingConsent] = useState(Boolean(userProfile.marketingConsent));
  const [savingComms, setSavingComms] = useState(false);

  // GDPR requests history & submission
  const [requests, setRequests] = useState<GdprRequestRecord[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [newReqType, setNewReqType] = useState<GdprRequestType>('access_data');
  const [newReqDetails, setNewReqDetails] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);

  // Local reset modal
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Permanent account deletion modal
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [partialDeletionReport, setPartialDeletionReport] = useState<{
    warning: string;
    remediationSteps: string[];
    failedTables: Array<{ table: string; error: string }>;
    storageErrors: Array<{ bucket: string; error: string }>;
    authUserDeleted: boolean;
  } | null>(null);

  useEffect(() => {
    setRectFirstName(userProfile.firstName || '');
    setRectLastName(userProfile.lastName || '');
    setRectEmail(userProfile.email || user?.email || '');
    setRectPhone(userProfile.phoneNumber || userProfile.phone || '');
    setOptionalNotifications(Boolean(userProfile.optionalNotificationsEnabled));
    setMarketingConsent(Boolean(userProfile.marketingConsent));
  }, [userProfile, user?.email]);

  const loadGdprRequests = async () => {
    if (!accessToken) return;
    setLoadingRequests(true);
    try {
      const res = await fetch('/api/gdpr/requests', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.requests)) {
        setRequests(json.requests);
      }
    } catch {
      // ignore if endpoint unavailable offline
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    if (user && accessToken) {
      void loadGdprRequests();
    } else {
      setRequests([]);
      setMyData(null);
    }
  }, [user?.id, accessToken]);

  const handleFetchMyData = async () => {
    setErrorMsg(null);
    setFeedback(null);
    if (!accessToken) {
      setErrorMsg('Conectează-te la cont pentru a consulta datele sincronizate în Supabase.');
      return;
    }
    setLoadingMyData(true);
    try {
      const res = await fetch('/api/gdpr/my-data', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Nu am putut prelua datele personale.');
      }
      setMyData(json.data);
      setFeedback('Rezumatul datelor personale asociate contului a fost actualizat.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Eroare la consultarea datelor personale.');
    } finally {
      setLoadingMyData(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setErrorMsg(null);
    setFeedback(null);

    if (!accessToken) {
      if (format === 'json') {
        const jsonStr = StorageService.exportDataAsJson();
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cosul-meu-date-locale-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setFeedback('Datele locale din browser au fost exportate în format JSON.');
      } else {
        setErrorMsg('Exportul CSV din baza de date este disponibil pentru utilizatorii autentificați.');
      }
      return;
    }

    setExportBusy(format);
    try {
      const res = await fetch(`/api/gdpr/export?format=${format}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Exportul a eșuat.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cosul-meu-date-personale-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback(`Exportul complet GDPR (${format.toUpperCase()}) a fost descărcat.`);
      void loadGdprRequests();
    } catch (err: any) {
      setErrorMsg(err.message || 'Nu am putut genera exportul.');
    } finally {
      setExportBusy(null);
    }
  };

  const handleSaveRectification = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);

    const nextDisplay = [rectFirstName.trim(), rectLastName.trim()].filter(Boolean).join(' ') || userProfile.name;
    const updatedLocal: UserProfile = {
      ...userProfile,
      firstName: rectFirstName.trim() || undefined,
      lastName: rectLastName.trim() || undefined,
      name: nextDisplay,
      phone: rectPhone.trim() || undefined,
      phoneNumber: rectPhone.trim() || undefined
    };

    if (!accessToken) {
      onUpdateProfile(updatedLocal);
      setFeedback('Datele locale au fost actualizate pe dispozitiv.');
      return;
    }

    setSavingRect(true);
    try {
      const res = await fetch('/api/gdpr/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          firstName: rectFirstName.trim() || null,
          lastName: rectLastName.trim() || null,
          displayName: nextDisplay,
          email: rectEmail.trim() || undefined,
          phone: rectPhone.trim() || null
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Nu am putut actualiza datele.');
      }
      onUpdateProfile(updatedLocal);
      setFeedback(json.message || 'Datele de identificare au fost rectificate.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Eroare la rectificarea datelor.');
    } finally {
      setSavingRect(false);
    }
  };

  const handleSaveCommunications = async () => {
    setErrorMsg(null);
    setFeedback(null);

    const updatedLocal: UserProfile = {
      ...userProfile,
      optionalNotificationsEnabled: optionalNotifications,
      marketingConsent
    };

    if (!accessToken) {
      onUpdateProfile(updatedLocal);
      setFeedback('Preferințele locale au fost actualizate.');
      return;
    }

    setSavingComms(true);
    try {
      const res = await fetch('/api/gdpr/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          optionalNotificationsEnabled: optionalNotifications,
          marketingConsent
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Nu am putut salva preferințele de comunicare.');
      }
      onUpdateProfile(updatedLocal);
      setFeedback('Preferințele de comunicare și dovada consimțământului au fost salvate.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Eroare la salvarea preferințelor de comunicare.');
    } finally {
      setSavingComms(false);
    }
  };

  const handleWithdrawAllConsents = async () => {
    setErrorMsg(null);
    setFeedback(null);
    withdrawOptionalCookieConsent(accessToken);
    setOptionalNotifications(false);
    setMarketingConsent(false);

    const updatedLocal: UserProfile = {
      ...userProfile,
      optionalNotificationsEnabled: false,
      marketingConsent: false,
      notificationsEnabled: false
    };
    onUpdateProfile(updatedLocal);

    if (!accessToken) {
      setFeedback('Consimțământul pentru cookie-uri opționale a fost retras local.');
      return;
    }

    try {
      const res = await fetch('/api/gdpr/withdraw-consents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          channels: ['email_marketing', 'optional_notifications', 'price_alerts', 'cookies_optional']
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Retragerea nu a putut fi înregistrată pe server.');
      }
      setFeedback('Toate consimțămintele opționale (marketing, notificări, cookie-uri) au fost retrase.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Eroare la retragerea consimțămintelor.');
    }
  };

  const handleToggleRestriction = async () => {
    if (!accessToken) {
      setErrorMsg('Autentifică-te pentru a solicita restricționarea prelucrării.');
      return;
    }
    const nextValue = !Boolean(userProfile.restrictionRequested);
    try {
      const res = await fetch('/api/gdpr/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          restrictionRequested: nextValue,
          restrictionReason: nextValue ? 'Solicitare activată de utilizator din panoul GDPR' : null
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Actualizarea restricționării a eșuat.');
      }
      onUpdateProfile({
        ...userProfile,
        restrictionRequested: nextValue
      });
      setFeedback(
        nextValue
          ? 'Ai activat cererea de restricționare a prelucrării (Art. 18 GDPR).'
          : 'Ai dezactivat marcajul de restricționare a prelucrării.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Nu am putut actualiza starea de restricționare.');
    }
  };

  const handleSubmitGdprRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);
    if (!accessToken) {
      setErrorMsg('Autentifică-te pentru a înregistra o solicitare GDPR urmărită în cont.');
      return;
    }
    setSubmittingReq(true);
    try {
      const res = await fetch('/api/gdpr/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          requestType: newReqType,
          details: newReqDetails.trim() || null
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Solicitarea nu a putut fi înregistrată.');
      }
      setRequests(prev => [json.request, ...prev]);
      setNewReqDetails('');
      setFeedback('Solicitarea GDPR a fost înregistrată cu status „Nouă”.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Eroare la trimiterea solicitării GDPR.');
    } finally {
      setSubmittingReq(false);
    }
  };

  const handleQuickRequestDeletion = async (type: 'erasure_optional_data' | 'erasure_account') => {
    setErrorMsg(null);
    setFeedback(null);
    if (!accessToken) {
      setErrorMsg('Autentifică-te pentru a înregistra o solicitare formală de ștergere GDPR.');
      return;
    }
    setSubmittingReq(true);
    try {
      const res = await fetch('/api/gdpr/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          requestType: type,
          details:
            type === 'erasure_account'
              ? 'Solicitare formală de ștergere completă a contului și datelor personale (Art. 17 GDPR).'
              : 'Solicitare formală de ștergere a datelor opționale din cont (bonuri, alerte, istoric).'
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Solicitarea de ștergere nu a putut fi înregistrată.');
      }
      setRequests(prev => [json.request, ...prev]);
      setFeedback('Cererea de ștergere a fost înregistrată în trackerul GDPR cu status „Nouă”.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Eroare la înregistrarea cererii de ștergere.');
    } finally {
      setSubmittingReq(false);
    }
  };

  const handleConfirmDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);
    setPartialDeletionReport(null);
    if (!accessToken) {
      setDeleteError('Trebuie să fii autentificat.');
      return;
    }

    setDeletingAccount(true);
    try {
      const res = await fetch('/api/gdpr/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          confirmationText: deleteConfirmText.trim(),
          password: deletePassword || undefined,
          reason: deleteReason.trim() || null
        })
      });
      const json = await res.json();

      if (res.status === 207 || json.partialFailure) {
        const sum = json.summary || {};
        setPartialDeletionReport({
          warning:
            json.error ||
            sum.warning ||
            'Ștergerea contului a fost executată parțial și necesită remediere.',
          remediationSteps: Array.isArray(sum.remediationSteps) ? sum.remediationSteps : [],
          failedTables: Array.isArray(sum.failedTables) ? sum.failedTables : [],
          storageErrors: Array.isArray(sum.storageErrors) ? sum.storageErrors : [],
          authUserDeleted: Boolean(sum.authUserDeleted)
        });
        setDeleteError(
          json.error ||
            'Ștergere parțială: unele date sau contul de autentificare nu au fost eliminate complet. Vezi pașii de remediere.'
        );
        void loadGdprRequests();
        return;
      }

      if (!res.ok || !json.success || !json.completedFully) {
        throw new Error(json.error || 'Ștergerea contului nu a putut fi finalizată.');
      }

      onResetAllData();
      setShowDeleteAccountModal(false);
      await signOut();
    } catch (err: any) {
      setDeleteError(err.message || 'Eroare la ștergerea contului.');
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-slate-900 dark:text-slate-100">
              Confidențialitate și date personale (GDPR)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Consultare, export JSON/CSV, rectificare, retragere consimțământ, solicitări GDPR și ștergere cont.
            </p>
          </div>
        </div>
        {onOpenCookieSettings && (
          <button
            type="button"
            onClick={onOpenCookieSettings}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <Cookie className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Setări cookie-uri</span>
          </button>
        )}
      </div>

      {/* Feedback & Errors */}
      {feedback && (
        <div
          role="status"
          className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 1. Consultare & Export JSON / CSV */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              1. Consultare și export date personale
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              ID cont: <code className="font-mono text-[11px]">{user?.id || 'mod-vizitator-local'}</code>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {user && (
              <button
                type="button"
                onClick={handleFetchMyData}
                disabled={loadingMyData}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{loadingMyData ? 'Se încarcă…' : 'Consultă datele asociate'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleExport('json')}
              disabled={exportBusy === 'json'}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exportBusy === 'json' ? 'Se generează…' : 'Descarcă JSON'}</span>
            </button>

            {user && (
              <button
                type="button"
                onClick={() => void handleExport('csv')}
                disabled={exportBusy === 'csv'}
                className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{exportBusy === 'csv' ? 'Se generează…' : 'Descarcă CSV'}</span>
              </button>
            )}
          </div>
        </div>

        {myData && (
          <div className="pt-2 space-y-3 border-t border-slate-200/70 dark:border-slate-700/70">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block">Liste salvate</span>
                <strong className="text-sm text-slate-900 dark:text-slate-100">{myData.shoppingLists.length}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block">Bonuri fiscale</span>
                <strong className="text-sm text-slate-900 dark:text-slate-100">{myData.receipts.length}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block">Alerte preț</span>
                <strong className="text-sm text-slate-900 dark:text-slate-100">{myData.priceAlerts.length}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block">Fișiere stocare</span>
                <strong className="text-sm text-slate-900 dark:text-slate-100">{myData.storageFiles.length}</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowRawJson(v => !v)}
              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 underline cursor-pointer"
            >
              {showRawJson ? 'Ascunde previzualizarea JSON' : 'Vezi previzualizarea completă JSON'}
            </button>

            {showRawJson && (
              <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 text-emerald-300 p-3 text-[11px] font-mono">
                {JSON.stringify(myData, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* 2. Rectificare rapidă date de identificare */}
      <form
        onSubmit={handleSaveRectification}
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            2. Rectificare date de identificare și contact
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Prenume</span>
            <input
              type="text"
              placeholder="Opțional"
              value={rectFirstName}
              onChange={e => setRectFirstName(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nume</span>
            <input
              type="text"
              placeholder="Opțional"
              value={rectLastName}
              onChange={e => setRectLastName(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Adresă de email</span>
            <input
              type="email"
              disabled={!user}
              value={rectEmail}
              onChange={e => setRectEmail(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Telefon (opțional)</span>
            <input
              type="tel"
              placeholder="Ex: 0722 000 000"
              value={rectPhone}
              onChange={e => setRectPhone(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Modificarea adresei de email declanșează un mesaj de confirmare pe noua adresă.
          </span>
          <button
            type="submit"
            disabled={savingRect}
            className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
          >
            {savingRect ? 'Se salvează…' : 'Salvează rectificarea'}
          </button>
        </div>
      </form>

      {/* 3. Comunicări separate: esențiale vs opționale vs marketing */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            3. Preferințe de comunicare și retragere consimțământ
          </h4>
        </div>

        <div className="space-y-2.5 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 flex items-start justify-between gap-3">
            <div>
              <span className="font-bold text-slate-900 dark:text-slate-100 block">
                Comunicări necesare de cont și securitate
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Confirmare cont, resetare parolă, securitate sau răspunsuri la solicitările tale GDPR (Art. 6 alin. 1 lit. b / c).
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-semibold shrink-0">
              Necesare
            </span>
          </div>

          <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3 cursor-pointer">
            <div>
              <span className="font-bold text-slate-900 dark:text-slate-100 block">
                Notificări opționale în aplicație / alerte de preț
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Alerte privind produsele urmărite și modificările de preț configurate de tine.
              </span>
            </div>
            <input
              type="checkbox"
              checked={optionalNotifications}
              onChange={e => setOptionalNotifications(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
            />
          </label>

          <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3 cursor-pointer">
            <div>
              <span className="font-bold text-slate-900 dark:text-slate-100 block">
                Newsletter și comunicări promoționale prin email (Consimțământ expres)
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Dezactivat implicit. Poți activa sau retrage oricând acest acord fără impact asupra contului.
              </span>
            </div>
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={e => setMarketingConsent(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleWithdrawAllConsents()}
            className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 text-xs font-bold cursor-pointer"
          >
            Retrage toate consimțămintele opționale
          </button>
          <button
            type="button"
            onClick={() => void handleSaveCommunications()}
            disabled={savingComms}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
          >
            {savingComms ? 'Se salvează…' : 'Salvează preferințele comunicări'}
          </button>
        </div>
      </div>

      {/* 4. Restricționarea prelucrării & Solicitări GDPR */}
      {user && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                4. Restricționare prelucrare și solicitări GDPR
              </h4>
            </div>
            <button
              type="button"
              onClick={() => void handleToggleRestriction()}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                userProfile.restrictionRequested
                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
              }`}
            >
              <PauseCircle className="w-3.5 h-3.5" />
              <span>
                {userProfile.restrictionRequested
                  ? 'Restricționare solicitată (Anulează)'
                  : 'Solicită restricționarea prelucrării'}
              </span>
            </button>
          </div>

          <form onSubmit={handleSubmitGdprRequest} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Tip solicitare
              </label>
              <select
                value={newReqType}
                onChange={e => setNewReqType(e.target.value as GdprRequestType)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 outline-none"
              >
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Detalii solicitare (opțional)
              </label>
              <input
                type="text"
                placeholder="Ex: Precizează datele vizate sau contextul"
                value={newReqDetails}
                onChange={e => setNewReqDetails(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 outline-none"
              />
            </div>
            <div className="sm:col-span-2 flex items-end">
              <button
                type="submit"
                disabled={submittingReq}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submittingReq ? '…' : 'Trimite'}</span>
              </button>
            </div>
          </form>

          {/* GDPR Request Status Tracker */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Tracker status solicitări GDPR ({requests.length})
              </span>
              <button
                type="button"
                onClick={() => void loadGdprRequests()}
                disabled={loadingRequests}
                className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${loadingRequests ? 'animate-spin' : ''}`} />
                <span>Reîmprospătează</span>
              </button>
            </div>

            {requests.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                  <span className="text-slate-500 dark:text-slate-400 block">Total</span>
                  <strong className="text-sm text-slate-900 dark:text-slate-100">{requests.length}</strong>
                </div>
                <div className="p-2 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/70 dark:border-sky-900">
                  <span className="text-sky-700 dark:text-sky-300 block">Noi</span>
                  <strong className="text-sm text-sky-900 dark:text-sky-100">
                    {requests.filter(r => r.status === 'noua').length}
                  </strong>
                </div>
                <div className="p-2 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900">
                  <span className="text-amber-700 dark:text-amber-300 block">În verificare</span>
                  <strong className="text-sm text-amber-900 dark:text-amber-100">
                    {requests.filter(r => r.status === 'in_verificare').length}
                  </strong>
                </div>
                <div className="p-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900">
                  <span className="text-emerald-700 dark:text-emerald-300 block">Soluționate</span>
                  <strong className="text-sm text-emerald-900 dark:text-emerald-100">
                    {requests.filter(r => r.status === 'procesata' || r.status === 'respinsa_justificat').length}
                  </strong>
                </div>
              </div>
            )}

            {requests.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                Nu există solicitări GDPR înregistrate până în prezent.
              </p>
            ) : (
              <div className="space-y-2.5">
                {requests.map(req => {
                  const badge = REQUEST_STATUS_STYLES[req.status] || REQUEST_STATUS_STYLES.noua;
                  const stepIndex =
                    req.status === 'noua' ? 1 : req.status === 'in_verificare' ? 2 : 3;
                  const isRejected = req.status === 'respinsa_justificat';
                  return (
                    <div
                      key={req.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-3 space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {REQUEST_TYPE_LABELS[req.requestType] || req.requestType}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                            Depusă: {new Date(req.requestedAt).toLocaleString('ro-RO')}
                            {req.resolvedAt
                              ? ` • Soluționată: ${new Date(req.resolvedAt).toLocaleString('ro-RO')}`
                              : ''}
                          </span>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-md border text-[11px] font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>

                      {/* 3-Step Visual Tracker */}
                      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                        {[
                          { step: 1, label: '1. Înregistrată' },
                          { step: 2, label: '2. În verificare' },
                          { step: 3, label: isRejected ? '3. Respinsă justificat' : '3. Procesată' }
                        ].map(item => {
                          const reached = stepIndex >= item.step;
                          return (
                            <div
                              key={item.step}
                              className={`rounded-lg px-2 py-1 text-[10px] font-semibold border text-center ${
                                reached
                                  ? isRejected && item.step === 3
                                    ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                    : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              {item.label}
                            </div>
                          );
                        })}
                      </div>

                      {(req.adminResponse || req.details) && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800/70 rounded-lg px-2.5 py-1.5 border border-slate-200/70 dark:border-slate-700/70">
                          {req.adminResponse ? (
                            <span>
                              <strong>Răspuns operator:</strong> {req.adminResponse}
                            </span>
                          ) : (
                            <span>
                              <strong>Detalii:</strong> {req.details}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Retenție, ștergere memorie locală & Ștergere definitivă cont */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <Info className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <strong>Diferența dintre ștergerea datelor opționale și ștergerea contului:</strong>{' '}
            Poți șterge individual bonuri din secțiunea <em>Bonuri</em> sau poți reseta datele locale din browser fără a pierde contul. Funcția <strong>„Șterge contul”</strong> elimină definitiv profilul, preferințele, listele, alertele, bonurile și imaginile private asociate contului; pot fi păstrate exclusiv evidențe minime anonimizate (hash SHA-256 al operațiunii și dovada pseudonimizată a consimțământului cookie) acolo unde există obligație legală de conformitate.{' '}
            {onNavigateLegal && (
              <button
                type="button"
                onClick={() => onNavigateLegal('/politica-de-confidentialitate')}
                className="underline font-semibold text-emerald-700 dark:text-emerald-400 cursor-pointer"
              >
                Citește Politica de confidențialitate
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Resetează memoria locală</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {user && (
              <button
                type="button"
                disabled={submittingReq}
                onClick={() => void handleQuickRequestDeletion('erasure_optional_data')}
                className="px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/70 text-amber-800 dark:text-amber-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Solicită ștergerea datelor opționale</span>
              </button>
            )}

            {user && (
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmText('');
                  setDeletePassword('');
                  setDeleteReason('');
                  setDeleteError(null);
                  setShowDeleteAccountModal(true);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4" />
                <span>Șterge contul</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Local Reset Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Confirmare resetare memorie locală</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Listele și datele salvate local pe acest browser vor fi șterse. Contul tău Supabase nu este șters prin această acțiune.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={() => {
                  onResetAllData();
                  setShowResetConfirm(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer"
              >
                Da, resetează
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Account Deletion Modal */}
      {showDeleteAccountModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleConfirmDeleteAccount}
            className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 id="delete-account-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Ștergere definitivă cont („Șterge contul”)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Această acțiune este ireversibilă.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-3 text-xs text-rose-900 dark:text-rose-200 space-y-1 leading-relaxed">
              <p><strong>Ce va fi șters:</strong></p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Profilul, preferințele, listele de cumpărături și alertele de preț</li>
                <li>Toate bonurile fiscale, observațiile de preț și fișierele private din <code>receipt-images</code> / <code>avatars</code></li>
                <li>Accesul la contul de autentificare</li>
              </ul>
              <p className="pt-1 text-[11px] opacity-90">
                Se păstrează doar un jurnal tehnic fără identificatori direcți (hash SHA-256) privind executarea cererii de ștergere.
              </p>
            </div>

            <label className="block">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> Parola curentă (pentru reautentificare)
              </span>
              <input
                type="password"
                required
                placeholder="Introdu parola contului"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-rose-500"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Tastează exact <code className="font-mono text-rose-600 dark:text-rose-400">STERGE CONTUL</code>
              </span>
              <input
                type="text"
                required
                placeholder="STERGE CONTUL"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-rose-500"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Motiv (opțional)
              </span>
              <input
                type="text"
                placeholder="Opțional"
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 outline-none"
              />
            </label>

            {deleteError && (
              <div
                role="alert"
                className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 p-3 rounded-xl border border-rose-200 dark:border-rose-800 space-y-2"
              >
                <p className="font-semibold">{deleteError}</p>
                {partialDeletionReport && (
                  <div className="space-y-1.5 text-[11px] border-t border-rose-200/80 dark:border-rose-800/80 pt-2">
                    <p>
                      <strong>Status Auth:</strong>{' '}
                      {partialDeletionReport.authUserDeleted
                        ? 'Cont Auth șters'
                        : 'Cont Auth neșters (necesită remediere)'}
                    </p>
                    {partialDeletionReport.failedTables.length > 0 && (
                      <p>
                        <strong>Tabele cu erori:</strong>{' '}
                        {partialDeletionReport.failedTables.map(f => f.table).join(', ')}
                      </p>
                    )}
                    {partialDeletionReport.storageErrors.length > 0 && (
                      <p>
                        <strong>Erori Storage:</strong>{' '}
                        {partialDeletionReport.storageErrors.map(s => s.bucket).join(', ')}
                      </p>
                    )}
                    {partialDeletionReport.remediationSteps.length > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5">
                        {partialDeletionReport.remediationSteps.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => setShowDeleteAccountModal(false)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-medium cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={deletingAccount || deleteConfirmText.trim().toUpperCase() !== 'STERGE CONTUL'}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold cursor-pointer"
              >
                {deletingAccount ? 'Se șterge contul…' : 'Confirmă ștergerea definitivă'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

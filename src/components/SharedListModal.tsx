import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  History,
  Link2,
  Shield,
  Trash2,
  Users,
  X
} from 'lucide-react';
import {
  SharedListActivityEntry,
  SharedListMember,
  SharedListRole,
  ShoppingList
} from '../types.js';

interface SharedListModalProps {
  open: boolean;
  onClose: () => void;
  activeList: ShoppingList;
  isAuthenticated: boolean;
  accessToken?: string;
  currentUserId?: string;
  onCollaborationUpdated?: () => void;
}

const ACTION_LABELS_RO: Record<string, string> = {
  list_shared: 'a partajat lista',
  member_joined: 's-a alăturat listei',
  member_role_changed: 'a schimbat rolul pentru',
  member_revoked: 'a revocat accesul pentru',
  item_added: 'a adăugat',
  item_updated: 'a modificat cantitatea pentru',
  item_checked: 'a bifat',
  item_unchecked: 'a debifat',
  item_removed: 'a șters',
  list_renamed: 'a redenumit lista'
};

export const SharedListModal: React.FC<SharedListModalProps> = ({
  open,
  onClose,
  activeList,
  isAuthenticated,
  accessToken,
  currentUserId,
  onCollaborationUpdated
}) => {
  const [members, setMembers] = useState<SharedListMember[]>(activeList.members || []);
  const [activity, setActivity] = useState<SharedListActivityEntry[]>(activeList.recentActivity || []);
  const [myRole, setMyRole] = useState<SharedListRole>(activeList.myRole || 'owner');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeList.id);

  const loadCollaboration = async () => {
    if (!isAuthenticated || !accessToken || !isUuid) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(activeList.id)}/collaboration`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Nu am putut încărca detaliile de partajare.');
      }
      setMembers(data.members || []);
      setActivity(data.activity || []);
      if (data.myRole) setMyRole(data.myRole);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la încărcarea colaboratorilor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setGeneratedLink(null);
      setCopied(false);
      void loadCollaboration();
    }
  }, [open, activeList.id]);

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !isUuid) return;
    setCreatingInvite(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(activeList.id)}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          role: inviteRole,
          invitedEmail: invitedEmail.trim() || undefined,
          expiresInHours: 72,
          maxUses: 5
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Invitația nu a putut fi creată.');
      }
      const fullUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${data.inviteUrl}`
          : data.inviteUrl;
      setGeneratedLink(fullUrl);
      setInvitedEmail('');
      await loadCollaboration();
      onCollaborationUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la generarea linkului de invitație.');
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleChangeMemberRole = async (memberUserId: string, nextRole: 'editor' | 'viewer') => {
    if (!accessToken) return;
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/lists/${encodeURIComponent(activeList.id)}/members/${encodeURIComponent(memberUserId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ role: nextRole })
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Rolul nu a putut fi modificat.');
      }
      await loadCollaboration();
      onCollaborationUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la schimbarea rolului.');
    }
  };

  const handleRevokeMember = async (memberUserId: string) => {
    if (!accessToken) return;
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/lists/${encodeURIComponent(activeList.id)}/members/${encodeURIComponent(memberUserId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Accesul nu a putut fi revocat.');
      }
      await loadCollaboration();
      onCollaborationUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la revocarea accesului.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Partajare & Colaborare · {activeList.name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Rolul tău: <strong className="uppercase">{myRole}</strong> · Sincronizare în timp real
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isAuthenticated || !isUuid ? (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
            Autentifică-te în contul tău Supabase și salvează lista în cont pentru a genera linkuri securizate de partajare în timp real.
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium">
                {errorMsg}
              </div>
            )}

            {/* Invite generator (Owner only) */}
            {myRole === 'owner' && (
              <form
                onSubmit={handleGenerateInvite}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Link2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Invită membru nou (link securizat cu token)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100"
                  >
                    <option value="editor">Editor (adaugă & bifează)</option>
                    <option value="viewer">Viewer (doar vizualizare)</option>
                  </select>
                  <input
                    type="email"
                    value={invitedEmail}
                    onChange={e => setInvitedEmail(e.target.value)}
                    placeholder="Email destinatar (opțional)"
                    className="sm:col-span-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Token criptografic unic · Expiră în 72h · Protejat prin RLS
                  </span>
                  <button
                    type="submit"
                    disabled={creatingInvite}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {creatingInvite ? 'Generez...' : 'Generează link'}
                  </button>
                </div>

                {generatedLink && (
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
                      {generatedLink}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedLink);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer shrink-0"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copiat' : 'Copiază'}</span>
                    </button>
                  </div>
                )}
              </form>
            )}

            {/* Members list */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" /> Membri cu acces ({members.length})
                </h4>
                {loading && <span className="text-[11px] text-slate-400">Se actualizează...</span>}
              </div>

              {members.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  Această listă este privată. Generează un link de invitație pentru a o partaja.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  {members.map(m => {
                    const isSelf = m.userId === currentUserId;
                    const isOwnerMember = m.role === 'owner';
                    return (
                      <div key={m.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs bg-white dark:bg-slate-900">
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 dark:text-slate-100 block truncate">
                            {m.displayName} {isSelf ? '(Tu)' : ''}
                          </span>
                          {m.emailMasked && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {m.emailMasked}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {myRole === 'owner' && !isOwnerMember ? (
                            <select
                              value={m.role}
                              onChange={e =>
                                void handleChangeMemberRole(m.userId, e.target.value as 'editor' | 'viewer')
                              }
                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200"
                            >
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold uppercase text-[10px]">
                              {m.role}
                            </span>
                          )}

                          {!isOwnerMember && (myRole === 'owner' || isSelf) && (
                            <button
                              type="button"
                              onClick={() => void handleRevokeMember(m.userId)}
                              className="p-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                              title={isSelf ? 'Părăsește lista' : 'Revocă accesul'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Activity History */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Istoric modificări ({activity.length})
              </h4>

              {activity.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  Nu există modificări recente înregistrate în jurnalul acestei liste.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                  {activity.map(entry => (
                    <div key={entry.id} className="px-3.5 py-2 text-xs flex items-center justify-between gap-2">
                      <span className="text-slate-700 dark:text-slate-300">
                        <strong className="text-slate-900 dark:text-slate-100">{entry.actorName}</strong>{' '}
                        {ACTION_LABELS_RO[entry.actionType] || entry.actionType}{' '}
                        {entry.targetName && <strong className="text-emerald-700 dark:text-emerald-400">{entry.targetName}</strong>}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(entry.createdAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

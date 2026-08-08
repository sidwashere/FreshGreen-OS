import { doc, getDoc, setDoc, collection, query, onSnapshot, deleteDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import React, { useState, useEffect } from 'react';
import { Key, Save, CheckCircle2, ShieldAlert, Globe, Server, Users, Settings, UserPlus, Trash2, ShieldCheck, UserCheck, UserX, Cpu, Zap, RefreshCcw, Github, ArrowDownToLine, ArrowUpFromLine, Eye, EyeOff } from 'lucide-react';
import { Brand, AppUser, AiModelPref } from '../types';
import { fetchAiPref, saveAiPref, AI_MODEL_OPTIONS } from '../lib/keys';
import { WPBridgeTester } from './WPBridgeTester';
import { CPanelExporter } from './CPanelExporter';
import { Wizard } from './Wizard';

interface SettingsProps {
  brands: Brand[];
  selectedBrandId: string;
  currentUser?: AppUser | null;
}

const ApiKeysTab: React.FC = () => {
  const [keys, setKeys] = useState({
    gemini: '',
    openai: '',
    huggingface: '',
    replicate: ''
  });
  
  const [saved, setSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadKeys = async () => {
      try {
        const docRef = doc(db, 'settings', 'global');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().apiKeys) {
          setKeys(docSnap.data().apiKeys);
        } else {
          // Fallback to local storage if present
          const stored = localStorage.getItem('greenops_byok_keys');
          if (stored) {
            setKeys(JSON.parse(stored));
          }
        }
      } catch (err) {
        console.debug('Skipped loading keys from cloud due to network or permissions.', err);
        const stored = localStorage.getItem('greenops_byok_keys');
        if (stored) {
          setKeys(JSON.parse(stored));
        }
      } finally {
        setIsLoading(false);
      }
    };
    loadKeys();
  }, []);

  const handleSave = async () => {
    try {
      localStorage.setItem('greenops_byok_keys', JSON.stringify(keys)); // keep local backup
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await setDoc(doc(db, 'settings', 'global'), { apiKeys: keys }, { merge: true });
    } catch (err) {
      console.debug('Saved keys locally but skipped cloud sync due to network or permissions.', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Key className="w-5 h-5 text-emerald-500" />
          API Integrations & BYOK
        </h2>
        <p className="text-slate-600 text-sm">
          Bring Your Own Key (BYOK) for image generation models and text AI. Keys are securely stored in the cloud and shared across all authorized users in this workspace.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 p-3 bg-blue-50 text-blue-700 text-xs rounded-xl border border-blue-100">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <p>
            <strong>Workspace Security:</strong> Your keys are securely stored in the database. They are shared across all authorized users in this workspace to ensure consistent AI generation capabilities for your team.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Gemini API Key</label>
            <input
              type="password"
              value={keys.gemini}
              onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="AIzaSy..."
            />
            <p className="text-[10px] text-slate-400 mt-1">Used for primary text generation and Gemini 3.1 Flash Lite Image generation.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">OpenAI API Key</label>
            <input
              type="password"
              value={keys.openai}
              onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="sk-proj-..."
            />
            <p className="text-[10px] text-slate-400 mt-1">Used for DALL-E 3 image generation in Nano Banana Studio.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Hugging Face Access Token</label>
            <input
              type="password"
              value={keys.huggingface}
              onChange={(e) => setKeys({ ...keys, huggingface: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="hf_..."
            />
            <p className="text-[10px] text-slate-400 mt-1">Free/Paid option for Stable Diffusion and Flux image generation models.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Replicate API Token</label>
            <input
              type="password"
              value={keys.replicate}
              onChange={(e) => setKeys({ ...keys, replicate: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="r8_..."
            />
            <p className="text-[10px] text-slate-400 mt-1">Used for running custom fine-tuned open-source image models.</p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition"
          >
            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{saved ? 'Saved Successfully' : 'Save Keys for Workspace'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const UserManagementTab: React.FC<{ currentUser?: AppUser | null }> = ({ currentUser }) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');

  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    const q = query(collection(db, 'app_users'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppUser));
      list.sort((a, b) => (a.approved === b.approved ? (a.createdAt || '').localeCompare(b.createdAt || '') : a.approved ? 1 : -1));
      setUsers(list);
      setLoading(false);
    }, (err) => {
      console.error('Failed to load users:', err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const approveUser = async (u: AppUser) => {
    setBusy(u.id);
    try {
      await setDoc(doc(db, 'app_users', u.id), { approved: true }, { merge: true });
      flash(`Approved @${u.username} — they can now sign in.`);
    } catch (e) {
      flash('Failed to approve user.');
    } finally {
      setBusy(null);
    }
  };

  const rejectUser = async (u: AppUser) => {
    setBusy(u.id);
    try {
      await deleteDoc(doc(db, 'app_users', u.id));
      flash(`Removed @${u.username}.`);
    } catch (e) {
      flash('Failed to remove user.');
    } finally {
      setBusy(null);
    }
  };

  const toggleRole = async (u: AppUser) => {
    setBusy(u.id);
    try {
      await setDoc(doc(db, 'app_users', u.id), { role: u.role === 'admin' ? 'member' : 'admin' }, { merge: true });
      flash(`@${u.username} is now ${u.role === 'admin' ? 'member' : 'admin'}.`);
    } catch (e) {
      flash('Failed to update role.');
    } finally {
      setBusy(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || busy) return;
    setBusy('create');
    try {
      const { adminCreateAccount } = await import('../lib/firebase');
      const { user: newUser } = await adminCreateAccount(newUsername, newPassword);
      await setDoc(doc(db, 'app_users', newUser.uid), {
        username: newUsername.trim(),
        role: newRole,
        approved: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.username || 'admin',
        userId: newUser.uid,
      });
      flash(`Created @${newUsername} (${newRole}) — approved immediately.`);
      setCreateOpen(false);
      setNewUsername('');
      setNewPassword('');
      setNewRole('member');
    } catch (err: any) {
      flash(err?.code === 'auth/email-already-in-use' ? 'That username is already taken.' : 'Failed to create user.');
    } finally {
      setBusy(null);
    }
  };

  const pending = users.filter((u) => !u.approved);
  const active = users.filter((u) => u.approved);

  return (
    <div className="space-y-6">
      <div className="space-y-2 mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          User Management
        </h2>
        <p className="text-slate-600 text-sm">
          Username accounts — no Google sign-in required. New users request access on the login screen and appear here for approval.
          {!isAdmin && <span className="text-amber-600 font-semibold block mt-1">You're a member — only administrators can approve or create users.</span>}
        </p>
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium px-4 py-3 rounded-xl">
          {notice}
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 pb-4 border-b border-slate-100 mb-4">
            <UserCheck className="w-4 h-4 text-amber-500" />
            <h3 className="font-bold text-slate-900 text-sm">Pending approval ({pending.length})</h3>
          </div>
          <div className="space-y-3">
            {pending.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-4 rounded-xl border border-amber-100 bg-amber-50/40">
                <div className="flex items-center space-x-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold shrink-0">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-sm">@{u.username}</div>
                    <div className="text-xs text-slate-500">
                      Requested {u.createdAt ? new Date(u.createdAt).toLocaleString() : 'recently'} · {u.role}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => approveUser(u)}
                    disabled={!isAdmin || busy === u.id}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-50"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => rejectUser(u)}
                    disabled={!isAdmin || busy === u.id}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                    title="Remove request"
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm">Active Users ({active.length})</h3>
          {isAdmin && (
            <button
              onClick={() => setCreateOpen((v) => !v)}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              <span>{createOpen ? 'Close' : 'Create User'}</span>
            </button>
          )}
        </div>

        {createOpen && isAdmin && (
          <form onSubmit={handleCreateUser} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Username</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. carol"
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Temporary password</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="min 6 chars"
                required
                minLength={6}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy === 'create'}
                className="w-full px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition disabled:opacity-50"
              >
                {busy === 'create' ? 'Creating...' : 'Create & Approve'}
              </button>
            </div>
            <p className="sm:col-span-2 lg:col-span-4 text-[11px] text-slate-500">
              The user signs in with this username and password on the login screen. Share the temporary password securely.
            </p>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Loading users…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            No approved users yet. The first account created on the login screen becomes the administrator.
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white transition group">
                <div className="flex items-center space-x-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shrink-0">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      @{u.username}
                      {u.id === currentUser?.id && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 uppercase">You</span>
                      )}
                      {u.role === 'admin' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 uppercase flex items-center gap-0.5">
                          <ShieldCheck className="w-2.5 h-2.5" /> Admin
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">Joined {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'recently'}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  {isAdmin && u.id !== currentUser?.id && (
                    <button
                      onClick={() => toggleRole(u)}
                      disabled={busy === u.id}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition disabled:opacity-50"
                    >
                      {u.role === 'admin' ? 'Demote' : 'Make admin'}
                    </button>
                  )}
                  {isAdmin && u.id !== currentUser?.id && (
                    <button
                      onClick={() => rejectUser(u)}
                      disabled={busy === u.id}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                      title="Remove user"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const AiModelsTab: React.FC = () => {
  const [pref, setPref] = useState<AiModelPref>(() => fetchAiPref());
  // Full apiKeys object (includes BYOK keys) so saving never wipes sibling keys.
  const [keys, setKeys] = useState<any>({});
  const [saved, setSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // Provider/connection testing state.
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [openrouterModels, setOpenrouterModels] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    const loadKeys = async () => {
      try {
        const docRef = doc(db, 'settings', 'global');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().apiKeys) {
          setKeys(docSnap.data().apiKeys);
        } else {
          setKeys(JSON.parse(localStorage.getItem('greenops_byok_keys') || '{}'));
        }
      } catch (err) {
        console.debug('Skipped loading keys from cloud due to network or permissions.', err);
        setKeys(JSON.parse(localStorage.getItem('greenops_byok_keys') || '{}'));
      } finally {
        setIsLoading(false);
      }
    };
    loadKeys();
  }, []);

  const optionsFor = (provider: string) =>
    provider === 'custom'
      ? [{ label: 'Custom model (enter below)', model: keys.customModel || 'gpt-4o-mini' }]
      : AI_MODEL_OPTIONS.filter((o) => o.provider === provider);

  const handleSave = async () => {
    saveAiPref(pref);
    localStorage.setItem('greenops_byok_keys', JSON.stringify(keys));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    try {
      await setDoc(doc(db, 'settings', 'global'), { apiKeys: keys }, { merge: true });
    } catch (err) {
      console.debug('Saved locally but skipped cloud sync due to network or permissions.', err);
    }
  };

  // Fire a tiny completion through /api/ai/test-provider to validate a config.
  const runTest = async (provider: string) => {
    setTesting(provider);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: keys.openrouter || keys.openai,
          baseUrl: keys.openaiBaseUrl,
          model: provider === 'openrouter'
            ? (pref.provider === 'openrouter' ? pref.model : undefined)
            : provider === 'custom'
              ? (pref.provider === 'custom' ? pref.model : keys.customModel)
              : undefined,
          byokKeys: keys,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e: any) {
      setTestResult({ ok: false, provider, error: e?.message || 'Test failed.' });
    } finally {
      setTesting(null);
    }
  };

  // Pull the live list of OpenRouter free models so the user can copy valid IDs.
  const browseModels = async () => {
    setLoadingModels(true);
    setOpenrouterModels(null);
    try {
      const res = await fetch('/api/ai/openrouter-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ byokKeys: keys }),
      });
      const data = await res.json();
      if (data.success) setOpenrouterModels(data.models || []);
    } catch (e: any) {
      setOpenrouterModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-500" />
          AI Models &amp; Fallback
        </h2>
        <p className="text-slate-600 text-sm">
          Choose which provider/model runs every AI action (Auto-Write, SEO refine, prompts, images).
          When a provider is out of quota or fails, the app automatically falls through to the next one
          and records which model actually produced the result in each post's Generation history.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 p-3 bg-indigo-50 text-indigo-700 text-xs rounded-xl border border-indigo-100">
          <Zap className="w-4 h-4 shrink-0" />
          <p>
            <strong>Fallback order:</strong> selected model first, then other Gemini models, then free
            OpenRouter models (<span className="font-mono">:free</span>), then your custom endpoint — only when keys are available.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400">Loading your settings…</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Preferred provider</label>
                <select
                  value={pref.provider}
                  onChange={(e) => {
                    const provider = e.target.value as AiModelPref['provider'];
                    const first = optionsFor(provider)[0];
                    setPref({ ...pref, provider, model: first?.model || pref.model });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="gemini">Gemini (Google, free tier)</option>
                  <option value="openrouter">OpenRouter (free tier models)</option>
                  <option value="custom">Custom OpenAI-compatible endpoint</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Preferred model</label>
                {pref.provider === 'custom' ? (
                  <input
                    type="text"
                    value={pref.model}
                    onChange={(e) => setPref({ ...pref, model: e.target.value })}
                    placeholder="e.g. gpt-4o-mini"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <select
                    value={pref.model}
                    onChange={(e) => setPref({ ...pref, model: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    {optionsFor(pref.provider).map((o) => (
                      <option key={o.model} value={o.model}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pref.autoFallback}
                onChange={(e) => setPref({ ...pref, autoFallback: e.target.checked })}
                className="w-4 h-4 accent-indigo-600"
              />
              <span className="text-sm font-semibold text-slate-700">Auto-fallback when out of quota</span>
              <span className="text-xs text-slate-400">When off, only the preferred provider is used and quota errors surface immediately.</span>
            </label>

            <div className="pt-4 border-t border-slate-100 space-y-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Fallback keys</p>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  OpenRouter API Key <span className="text-slate-400 font-normal">(free models — recommended)</span>
                </label>
                <input
                  type="password"
                  value={keys.openrouter || ''}
                  onChange={(e) => setKeys({ ...keys, openrouter: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="sk-or-v1-..."
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Get a free key at <span className="font-mono">openrouter.ai</span> — unlocks free-tier models like DeepSeek, Llama, Gemma and Qwen when Gemini quota runs out.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Custom base URL</label>
                  <input
                    type="text"
                    value={keys.openaiBaseUrl || ''}
                    onChange={(e) => setKeys({ ...keys, openaiBaseUrl: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. https://api.groq.com/openai/v1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Custom model name</label>
                  <input
                    type="text"
                    value={keys.customModel || ''}
                    onChange={(e) => setKeys({ ...keys, customModel: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. llama-3.3-70b-versatile"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400">
                The custom endpoint reuses the OpenAI API key from the API Keys tab and must be OpenAI-compatible
                (<span className="font-mono">/chat/completions</span>). Common options:
                <span className="block mt-1 font-mono text-[10px]">Groq → https://api.groq.com/openai/v1 (e.g. llama-3.3-70b-versatile)</span>
                <span className="block font-mono text-[10px]">Together → https://api.together.xyz/v1</span>
                <span className="block font-mono text-[10px]">Local Ollama → http://localhost:11434/v1</span>
                Note: OpenRouter does NOT need the custom endpoint — its base URL is
                <span className="font-mono"> https://openrouter.ai/api/v1</span> and it's built in as its own provider above.
              </p>
            </div>

            {/* ---- Test connections ---- */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Test connections</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => runTest('gemini')}
                  disabled={!!testing}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition disabled:opacity-50"
                >
                  {testing === 'gemini' ? 'Testing…' : 'Test Gemini (server key)'}
                </button>
                <button
                  onClick={() => runTest('openrouter')}
                  disabled={!!testing}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition disabled:opacity-50"
                >
                  {testing === 'openrouter' ? 'Testing…' : 'Test OpenRouter key'}
                </button>
                <button
                  onClick={() => runTest('custom')}
                  disabled={!!testing}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition disabled:opacity-50"
                >
                  {testing === 'custom' ? 'Testing…' : 'Test custom endpoint'}
                </button>
                <button
                  onClick={browseModels}
                  disabled={loadingModels}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition disabled:opacity-50"
                >
                  {loadingModels ? 'Loading…' : 'Browse free OpenRouter models'}
                </button>
              </div>

              {testResult && (
                <div className={`p-3 rounded-xl border text-xs ${testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  <div className="flex items-center gap-2 font-bold">
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                    {testResult.ok ? 'Connection OK' : 'Connection failed'}
                    {testResult.model && <span className="font-mono text-[10px] opacity-80">{testResult.provider}/{testResult.model}</span>}
                    {typeof testResult.latencyMs === 'number' && <span className="tabular-nums opacity-80">· {(testResult.latencyMs / 1000).toFixed(1)}s</span>}
                  </div>
                  {testResult.sample && <p className="mt-1 opacity-90">Model replied: “{testResult.sample.trim()}”</p>}
                  {testResult.error && <p className="mt-1 break-words opacity-90">{testResult.error}</p>}
                </div>
              )}

              {openrouterModels && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700 mb-2">
                    {openrouterModels.length} free OpenRouter models — click one to use it as the OpenRouter fallback:
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {openrouterModels.length === 0 && (
                      <p className="text-xs text-slate-500">No free models found (or OpenRouter unreachable).</p>
                    )}
                    {openrouterModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setPref({ ...pref, provider: 'openrouter', model: m.id })}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono bg-white hover:bg-indigo-50 border border-slate-200 text-slate-700 truncate transition"
                        title={`Use ${m.id} as the fallback model`}
                      >
                        {m.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <RefreshCcw className="w-3.5 h-3.5" />
                Applies instantly to every AI action — no restart needed. Each post logs the model used with a timestamp.
              </p>
              <button
                onClick={handleSave}
                className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition shrink-0"
              >
                {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                <span>{saved ? 'Saved' : 'Save Model Settings'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const GithubSyncTab: React.FC = () => {
  const [config, setConfig] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('greenops_github_config') || '{}');
    } catch {
      return {};
    }
  });
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<'test' | 'status' | 'pull' | 'push' | null>(null);
  const [result, setResult] = useState<any>(null);
  const [autoRestart, setAutoRestart] = useState(false);

  const update = (key: string, value: string) => setConfig((c: any) => ({ ...c, [key]: value }));

  const saveConfig = () => {
    localStorage.setItem('greenops_github_config', JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    try {
      setDoc(doc(db, 'settings', 'global'), { githubConfig: config }, { merge: true });
    } catch (err) {
      console.debug('Saved GitHub config locally but skipped cloud sync.', err);
    }
  };

  const call = async (path: string, body: any, key: typeof busy) => {
    setBusy(key);
    setResult(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // Auto-fill owner/repo from the remote URL when the fields are empty.
      if (data?.remoteUrl && /github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/.test(data.remoteUrl)) {
        const m = data.remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/);
        if (m) {
          setConfig((c: any) => ({
            ...c,
            owner: c.owner || m[1],
            repo: c.repo || m[2],
          }));
        }
      }
      setResult(data);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || 'Request failed.' });
    } finally {
      setBusy(null);
    }
  };

  const btn = (key: typeof busy) =>
    `px-3 py-2 rounded-lg text-xs font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${busy === key ? 'opacity-70' : ''}`;

  return (
    <div className="space-y-6">
      <div className="space-y-2 mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Github className="w-5 h-5 text-slate-700" />
          GitHub Sync
        </h2>
        <p className="text-slate-600 text-sm">
          Pull the latest code or push your local work from here — no terminal needed. The token below is used only for
          git fetch/push on the server and is never written into the repo or logs.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 text-xs rounded-xl border border-amber-100">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Create a token at <span className="font-mono">github.com/settings/tokens</span> — a fine-grained PAT with{' '}
            <b>Contents: Read and write</b> access to this repo (or a classic PAT with the <b>repo</b> scope). Note:
            the remote currently fails auth (<i>“Invalid username or token”</i>), so this token is also required for any
            fetch or push.
          </span>
        </div>

        {/* Config fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">GitHub token (PAT)</label>
            <div className="flex gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                value={config.token || ''}
                onChange={(e) => update('token', e.target.value)}
                placeholder="github_pat_… or ghp_…"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
              />
              <button
                onClick={() => setShowToken(!showToken)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Owner</label>
            <input
              value={config.owner || ''}
              onChange={(e) => update('owner', e.target.value)}
              placeholder="sidwashere"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Repo</label>
            <input
              value={config.repo || ''}
              onChange={(e) => update('repo', e.target.value)}
              placeholder="FreshGreen-OS"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Branch (optional — defaults to current)</label>
            <input
              value={config.branch || ''}
              onChange={(e) => update('branch', e.target.value)}
              placeholder="FGOS_2.0"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={saveConfig}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-700 transition"
            >
              {saved ? <CheckCircle2 className="inline w-4 h-4 mr-1" /> : <Save className="inline w-4 h-4 mr-1" />}
              {saved ? 'Saved' : 'Save config'}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => call('/api/github/test', config, 'test')}
              disabled={!!busy}
              className={`${btn('test')} bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200`}
            >
              <Zap className="w-3.5 h-3.5" /> {busy === 'test' ? 'Testing…' : 'Test token'}
            </button>
            <button
              onClick={() => call('/api/github/status', config, 'status')}
              disabled={!!busy}
              className={`${btn('status')} bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200`}
            >
              <RefreshCcw className="w-3.5 h-3.5" /> {busy === 'status' ? 'Checking…' : 'Sync status'}
            </button>
            <button
              onClick={() => call('/api/github/sync', { ...config, action: 'pull', autoRestart }, 'pull')}
              disabled={!!busy}
              className={`${btn('pull')} bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200`}
            >
              <ArrowDownToLine className="w-3.5 h-3.5" /> {busy === 'pull' ? 'Pulling…' : 'Pull updates'}
            </button>
            <button
              onClick={() => call('/api/github/sync', { ...config, action: 'push' }, 'push')}
              disabled={!!busy}
              className={`${btn('push')} bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200`}
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" /> {busy === 'push' ? 'Pushing…' : 'Commit all & push'}
            </button>
            <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRestart}
                onChange={(e) => setAutoRestart(e.target.checked)}
                className="accent-indigo-600"
              />
              Rebuild + relaunch app server after pull
            </label>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Pull fast-forwards your current branch to origin and refuses if there are uncommitted changes. Push commits
            all local changes as one <span className="font-mono">chore: app sync update</span> commit, then pushes.
          </p>
        </div>

        {/* Results */}
        {result && (
          <div className={`p-4 rounded-xl border text-xs space-y-3 ${result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <div className="flex items-center gap-2 font-bold">
              {result.ok ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              {result.ok ? (result.action === 'pull' ? (result.updated ? 'Update pulled' : 'Already up to date') : result.action === 'push' ? 'Pushed' : result.user ? 'Token valid' : 'OK') : 'Failed'}
            </div>

            {result.user && (
              <p className="opacity-90">
                Authenticated as <b>{result.user.login}</b>{result.user.name ? ` (${result.user.name})` : ''}
                {result.repo?.fullName && (
                  <> · repo <b>{result.repo.fullName}</b>{result.repo.private ? ' (private)' : ' (public)'} · default branch <b>{result.repo.defaultBranch}</b></>
                )}
                {result.repoError && <span className="block text-red-600 mt-1">{result.repoError}</span>}
              </p>
            )}

            {result.gitRepo !== undefined && (
              <p className="opacity-90">
                Local: {result.gitRepo ? `git repo on branch ${result.currentBranch || '?'}` : 'not a git repo'}
                {result.remoteUrl && <span className="block font-mono truncate">{result.remoteUrl}</span>}
                {result.lastLocalCommit && <span className="block opacity-80">HEAD {result.lastLocalCommit}</span>}
              </p>
            )}

            {typeof result.ahead === 'number' && (
              <p className="opacity-90">
                {result.remoteBranchExists === false ? 'No matching branch on origin yet.' : (
                  <>
                    {result.behind} commit(s) behind origin, {result.ahead} ahead
                    {result.fetch && result.fetch !== 'ok' && (
                      <span className="block text-amber-600 mt-1">Fetch failed: {result.fetch}</span>
                    )}
                  </>
                )}
              </p>
            )}

            {Array.isArray(result.dirty) && result.dirty.length > 0 && (
              <div className="opacity-90">
                {result.dirty.length} uncommitted change(s):
                <div className="mt-1 max-h-28 overflow-y-auto bg-white/60 rounded-lg p-2 font-mono text-[10px] space-y-0.5">
                  {result.dirty.slice(0, 15).map((f: string, i: number) => (
                    <div key={i}>{f}</div>
                  ))}
                  {result.dirty.length > 15 && <div>… and {result.dirty.length - 15} more</div>}
                </div>
              </div>
            )}

            {result.committed !== undefined && (
              <p className="opacity-90">
                {result.committed === 0 ? 'Nothing to commit' : `Committed ${result.committed} file(s)`} · pushed{' '}
                <span className="font-mono">{result.sha}</span> to <b>{result.branch}</b>
              </p>
            )}

            {result.updated !== undefined && !result.ok && (
              <p className="opacity-90">Before {result.before} → after {result.after}</p>
            )}

            {result.restarted && <p className="opacity-90">App server relaunching (new code goes live in ~5s).</p>}

            {result.error && <p className="opacity-90 break-words">{result.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export const SettingsTab: React.FC<SettingsProps> = ({ brands, selectedBrandId, currentUser }) => {
  const [activeSubTab, setActiveSubTab] = useState<'api-keys' | 'ai-models' | 'wp-bridge' | 'deployment' | 'users' | 'wizard' | 'github'>('api-keys');

  const subTabs = [
    { id: 'api-keys', label: 'API Keys & BYOK', icon: Key },
    { id: 'ai-models', label: 'AI Models & Fallback', icon: Cpu },
    { id: 'wp-bridge', label: 'WP REST API Bridge', icon: Globe },
    { id: 'deployment', label: 'cPanel Deployment', icon: Server },
    { id: 'github', label: 'GitHub Sync', icon: Github },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'wizard', label: 'Setup Wizard', icon: Settings }
  ] as const;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 flex flex-col md:flex-row gap-8">
      {/* Settings Navigation Sidebar */}
      <div className="w-full md:w-64 shrink-0">
        <div className="sticky top-8 space-y-1">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-4 mb-4">Settings & Configs</h2>
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Settings Content Area */}
      <div className="flex-1 min-w-0">
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeSubTab === 'api-keys' && <ApiKeysTab />}
          {activeSubTab === 'ai-models' && <AiModelsTab />}
          {activeSubTab === 'wp-bridge' && <WPBridgeTester brands={brands} selectedBrandId={selectedBrandId} />}
          {activeSubTab === 'deployment' && <CPanelExporter />}
          {activeSubTab === 'github' && <GithubSyncTab />}
          {activeSubTab === 'users' && <UserManagementTab currentUser={currentUser} />}
          {activeSubTab === 'wizard' && <Wizard />}
        </div>
      </div>
    </div>
  );
};


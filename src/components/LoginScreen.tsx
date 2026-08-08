import React, { useState } from 'react';
import { Lock, User, LogIn, UserPlus, ShieldCheck, AlertTriangle } from 'lucide-react';

export type LoginMode = 'signin' | 'request';

interface LoginScreenProps {
  mode: LoginMode;
  onModeChange: (mode: LoginMode) => void;
  onSubmit: (username: string, password: string) => Promise<void>;
  error: string | null;
  busy: boolean;
  isFirstRun: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  mode,
  onModeChange,
  onSubmit,
  error,
  busy,
  isFirstRun,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Password-length and confirm-match are enforced via the disabled submit
    // button (passwordOk / matchOk below), so we can submit straight through.
    await onSubmit(username, password);
  };

  const passwordOk = password.length >= 6;
  const matchOk = mode === 'signin' || password === confirm;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="text-center">
            <div className="w-14 h-14 bg-[#185e46] rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-[#185e46]/20 mb-4">
              <span className="text-white font-bold text-2xl">G</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900">FreshGreenOps Studio</h1>
            <p className="text-sm text-slate-500 mt-1">
              {mode === 'signin' ? 'Sign in with your username' : 'Request access to the workspace'}
            </p>
          </div>

          {isFirstRun && (
            <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-3 text-left">
              <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-[12px] font-medium text-emerald-800 leading-relaxed">
                First run — no admin exists yet. Creating an account sets you as the <strong>administrator</strong>, who can then approve new users.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3 text-left">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-[12px] font-medium text-red-700 leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-bold text-slate-600 mb-1.5">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. sidney"
                  autoFocus
                  required
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-[#185e46] focus:border-[#185e46] focus:outline-none placeholder:text-slate-400"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">3–24 characters: letters, numbers, dots, dashes, underscores</p>
            </div>

            <div>
              <label className="block text-[12px] font-bold text-slate-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-[#185e46] focus:border-[#185e46] focus:outline-none placeholder:text-slate-400"
                />
              </div>
              {mode === 'request' && !passwordOk && password.length > 0 && (
                <p className="text-[10px] text-amber-600 mt-1">At least 6 characters</p>
              )}
            </div>

            {mode === 'request' && (
              <div>
                <label className="block text-[12px] font-bold text-slate-600 mb-1.5">Confirm password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm focus:outline-none placeholder:text-slate-400 ${
                      matchOk ? 'border-slate-300 focus:ring-2 focus:ring-[#185e46]' : 'border-red-300 focus:ring-2 focus:ring-red-400'
                    }`}
                  />
                </div>
                {!matchOk && confirm.length > 0 && (
                  <p className="text-[10px] text-red-600 mt-1">Passwords do not match</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || (mode === 'request' && (!passwordOk || !matchOk))}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#185e46] hover:bg-[#134937] text-white font-bold text-sm transition shadow-md shadow-[#185e46]/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? (
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : mode === 'signin' ? (
                <LogIn className="w-4 h-4" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account & request access'}
            </button>
          </form>

          <div className="text-center pt-1 border-t border-slate-100">
            {mode === 'signin' ? (
              <button
                onClick={() => onModeChange('request')}
                className="text-[13px] font-semibold text-[#185e46] hover:text-[#134937] transition"
              >
                New here? Request access
              </button>
            ) : (
              <button
                onClick={() => onModeChange('signin')}
                className="text-[13px] font-semibold text-[#185e46] hover:text-[#134937] transition"
              >
                Already approved? Sign in
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">
          Username login — no Google account required. New users are approved by an administrator.
        </p>
      </div>
    </div>
  );
};

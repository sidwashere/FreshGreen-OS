import React, { useState } from 'react';
import { Brand } from '../types';
import { Globe, Key, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, Server, Terminal } from 'lucide-react';

interface WPBridgeTesterProps {
  brands: Brand[];
  selectedBrandId: string;
}

export const WPBridgeTester: React.FC<WPBridgeTesterProps> = ({
  brands,
  selectedBrandId,
}) => {
  const currentBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  if (!currentBrand) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center text-slate-500">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-slate-400" />
        <p>No brand selected. Please create a brand first.</p>
      </div>
    );
  }

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/wp/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpUrl: currentBrand.wpUrl,
          wpUsername: currentBrand.wpUsername,
          wpAppPassword: currentBrand.wpAppPassword,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || 'Failed to ping WordPress endpoint',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Globe className="w-5 h-5 text-emerald-600" />
          WordPress REST API Bridge Diagnostic Tool
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Verify Basic Authentication, SSL Handshake, Application Passwords, and REST endpoints for your hostinger/cPanel sites.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: currentBrand.primaryColor }}
            />
            <div>
              <h2 className="font-bold text-slate-900 text-base">{currentBrand.name}</h2>
              <p className="font-mono text-xs text-slate-500">{currentBrand.wpUrl}</p>
            </div>
          </div>

          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
            <span>{isTesting ? 'Pinging WordPress API...' : 'Test Connection Endpoint'}</span>
          </button>
        </div>

        {/* Credentials Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">Target Endpoint</span>
            <span className="text-slate-900 font-bold truncate block">{currentBrand.wpUrl}/wp-json/wp/v2</span>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">Auth Username</span>
            <span className="text-slate-900 font-bold">{currentBrand.wpUsername}</span>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">App Password Status</span>
            <span className={currentBrand.wpAppPassword ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold'}>
              {currentBrand.wpAppPassword ? 'Vault Configured' : 'Missing Password'}
            </span>
          </div>
        </div>

        {/* Diagnostic Output Window */}
        {testResult && (
          <div
            className={`p-5 rounded-2xl border ${
              testResult.success
                ? 'bg-slate-950 text-emerald-400 border-emerald-500/30'
                : 'bg-red-950 text-red-200 border-red-500/30'
            } font-mono text-xs space-y-3 shadow-lg`}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="flex items-center gap-2 font-bold uppercase tracking-wider text-[11px]">
                <Terminal className="w-4 h-4 text-emerald-400" />
                REST API Connection Result
              </span>
              <span className="text-[10px] text-slate-400">{new Date().toLocaleTimeString()}</span>
            </div>

            <p className="text-sm font-semibold leading-relaxed">{testResult.message}</p>

            {testResult.userDisplayName && (
              <div className="pt-2 text-[11px] text-slate-300 space-y-1 border-t border-slate-800">
                <div>User Display Name: <span className="text-emerald-300 font-bold">{testResult.userDisplayName}</span></div>
                <div>Server Host: <span className="text-emerald-300">{testResult.siteName}</span></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

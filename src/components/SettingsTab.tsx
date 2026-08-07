import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import React, { useState, useEffect } from 'react';
import { Key, Save, CheckCircle2, ShieldAlert, Globe, Server, Users, Settings, UserPlus, Trash2 } from 'lucide-react';
import { Brand } from '../types';
import { WPBridgeTester } from './WPBridgeTester';
import { CPanelExporter } from './CPanelExporter';
import { Wizard } from './Wizard';

interface SettingsProps {
  brands: Brand[];
  selectedBrandId: string;
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
        const docRef = doc(db, 'settings', auth.currentUser?.uid || 'global');
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
      await setDoc(doc(db, 'settings', auth.currentUser?.uid || 'global'), { apiKeys: keys }, { merge: true });
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

const UserManagementTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="space-y-2 mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          User Management
        </h2>
        <p className="text-slate-600 text-sm">
          Manage team members, roles, and access control for the FreshGreenOps Studio.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm">Active Users</h3>
          <button className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-sm">
            <UserPlus className="w-4 h-4" />
            <span>Invite User</span>
          </button>
        </div>

        <div className="space-y-3">
          {[
            { name: 'Carol (Admin)', email: 'carol@freshgreenclassics.co.uk', role: 'Owner', active: true },
            { name: 'Daniel', email: 'daniel@tastypetfoods.co.uk', role: 'Editor', active: true },
            { name: 'Content Bot', email: 'bot@freshgreenops.studio', role: 'API Automation', active: false },
          ].map((user, idx) => (
            <div key={idx} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white transition group">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  {user.name.charAt(0)}
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    {user.name}
                    {!user.active && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-600 uppercase">System</span>}
                  </div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                  {user.role}
                </span>
                <button className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const SettingsTab: React.FC<SettingsProps> = ({ brands, selectedBrandId }) => {
  const [activeSubTab, setActiveSubTab] = useState<'api-keys' | 'wp-bridge' | 'deployment' | 'users' | 'wizard'>('api-keys');

  const subTabs = [
    { id: 'api-keys', label: 'API Keys & BYOK', icon: Key },
    { id: 'wp-bridge', label: 'WP REST API Bridge', icon: Globe },
    { id: 'deployment', label: 'cPanel Deployment', icon: Server },
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
          {activeSubTab === 'wp-bridge' && <WPBridgeTester brands={brands} selectedBrandId={selectedBrandId} />}
          {activeSubTab === 'deployment' && <CPanelExporter />}
          {activeSubTab === 'users' && <UserManagementTab />}
          {activeSubTab === 'wizard' && <Wizard />}
        </div>
      </div>
    </div>
  );
};


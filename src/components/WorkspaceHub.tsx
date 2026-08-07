import React, { useState } from 'react';
import { getAccessToken } from '../lib/firebase';
import { FileSpreadsheet, Mail, Calendar as CalendarIcon, Loader2 } from 'lucide-react';

export const WorkspaceHub: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sheets' | 'gmail' | 'calendar'>('sheets');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGoogleApi = async (url: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Failed to fetch data");
      }
      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestSheets = () => {
    // Just fetch recent spreadsheets from drive
    fetchGoogleApi('https://www.googleapis.com/drive/v3/files?q=mimeType=\'application/vnd.google-apps.spreadsheet\'&orderBy=modifiedTime desc&pageSize=5');
  };

  const handleTestGmail = () => {
    // Fetch recent emails
    fetchGoogleApi('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5');
  };

  const handleTestCalendar = () => {
    // Fetch upcoming events
    const timeMin = new Date().toISOString();
    fetchGoogleApi(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&maxResults=5&orderBy=startTime&singleEvents=true`);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h2 className="text-2xl font-bold text-slate-900">Workspace Integrations</h2>
      <p className="text-slate-600 text-sm">
        Connect to Google Workspace to import briefs, send email campaigns, or schedule content.
      </p>

      <div className="flex space-x-4 border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('sheets'); setResult(null); }}
          className={`pb-3 px-2 flex items-center gap-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'sheets' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Google Sheets
        </button>
        <button
          onClick={() => { setActiveTab('gmail'); setResult(null); }}
          className={`pb-3 px-2 flex items-center gap-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'gmail' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Mail className="w-4 h-4" />
          Gmail
        </button>
        <button
          onClick={() => { setActiveTab('calendar'); setResult(null); }}
          className={`pb-3 px-2 flex items-center gap-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'calendar' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          Google Calendar
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        {activeTab === 'sheets' && (
          <div className="space-y-4">
            <h3 className="font-semibold">Recent Spreadsheets</h3>
            <button onClick={handleTestSheets} disabled={loading} className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium transition flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Fetch Spreadsheets
            </button>
          </div>
        )}
        
        {activeTab === 'gmail' && (
          <div className="space-y-4">
            <h3 className="font-semibold">Recent Emails</h3>
            <button onClick={handleTestGmail} disabled={loading} className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Fetch Emails
            </button>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <h3 className="font-semibold">Upcoming Events</h3>
            <button onClick={handleTestCalendar} disabled={loading} className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-sm font-medium transition flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Fetch Events
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">API Response</h4>
            <pre className="bg-slate-900 text-emerald-400 p-4 rounded-xl text-xs overflow-auto max-h-96">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

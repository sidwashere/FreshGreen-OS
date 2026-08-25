import React, { useState } from 'react';
import { Server, Download, Code, FileText, Check, Copy, ExternalLink, Terminal } from 'lucide-react';

export const CPanelExporter: React.FC = () => {
  const [copiedEnv, setCopiedEnv] = useState(false);

  const envText = `# FGOS (Fresh Green Operating System) - Hostinger / cPanel .env
APP_NAME="FGOS"
APP_ENV=production
APP_KEY=base64:Xxxxx
APP_DEBUG=false
APP_URL=https://studio.yourdomain.com

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=fgos_studio
DB_USERNAME=fgos_user
DB_PASSWORD=your_secure_password

GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
`;

  const copyEnvText = () => {
    navigator.clipboard.writeText(envText);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-600" />
          Hostinger / cPanel Deployment Hub
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Download the production MySQL database schema, Laravel 11 WordPress connector class, and step-by-step deployment package.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: One-Click Downloads */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="font-bold text-slate-900 text-base">Production Assets Exporter</h2>

            {/* Download MySQL Schema SQL */}
            <a
              href="/api/export/sql"
              download="fgos_studio_schema.sql"
              className="flex items-center justify-between p-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition group shadow-sm"
            >
              <div className="flex items-center space-x-3">
                <FileText className="w-5 h-5 text-emerald-400" />
                <div className="text-left">
                  <div className="text-xs font-bold">MySQL Schema (.sql)</div>
                  <div className="text-[10px] text-slate-400">cPanel / phpMyAdmin Import Ready</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-400 group-hover:translate-y-0.5 transition-transform" />
            </a>

            {/* Download Laravel 11 Connector Service Class */}
            <a
              href="/api/export/wordpress-connector-php"
              download="WordPressConnector.php"
              className="flex items-center justify-between p-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition group shadow-sm"
            >
              <div className="flex items-center space-x-3">
                <Code className="w-5 h-5 text-cyan-400" />
                <div className="text-left">
                  <div className="text-xs font-bold">WordPressConnector.php</div>
                  <div className="text-[10px] text-slate-400">Laravel 11 REST API Service Class</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-cyan-400 group-hover:translate-y-0.5 transition-transform" />
            </a>
          </div>

          {/* Environment Variable Box */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Laravel .env File Template</span>
              <button
                onClick={copyEnvText}
                className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
              >
                {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedEnv ? 'Copied!' : 'Copy .env'}</span>
              </button>
            </div>

            <textarea
              readOnly
              value={envText}
              rows={10}
              className="w-full font-mono text-[11px] bg-slate-950 text-emerald-400 p-3 rounded-xl border border-slate-800 focus:outline-none"
            />
          </div>
        </div>

        {/* Right Column: Step-by-Step Installation Guide */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <h2 className="font-bold text-slate-900 text-lg flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-600" />
            Hostinger hPanel / cPanel 6-Step Installation Guide
          </h2>

          <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-900 text-xs block">Step 1: Subdomain & PHP Setup</span>
              <p>In hPanel / cPanel, create a subdomain (e.g., <code className="bg-slate-200 px-1 rounded">studio.yourcompany.com</code>). Ensure your PHP version is set to <strong>PHP 8.2 or 8.3</strong>.</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-900 text-xs block">Step 2: MySQL Database Import</span>
              <p>Open <strong>phpMyAdmin</strong>, create a database named <code className="bg-slate-200 px-1 rounded">fgos_studio</code>, and import the downloaded <code className="bg-slate-200 px-1 rounded">fgos_studio_schema.sql</code> file.</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-900 text-xs block">Step 3: Laravel 11 Deployment</span>
              <p>Upload your Laravel 11 codebase via Git or File Manager. Place <code className="bg-slate-200 px-1 rounded">WordPressConnector.php</code> inside <code className="bg-slate-200 px-1 rounded">app/Services/</code>.</p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-900 text-xs block">Step 4: Cron Job Heartbeat</span>
              <p>Add the Laravel Heartbeat Cron in cPanel to run background AI tasks and WP syncs automatically:</p>
              <code className="block bg-slate-950 text-emerald-400 p-2 rounded-lg font-mono text-[10px] mt-1">
                /usr/local/bin/php /home/username/public_html/artisan schedule:run &gt;&gt; /dev/null 2&gt;&amp;1
              </code>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="font-bold text-slate-900 text-xs block">Step 5: Storage Symlink</span>
              <p>Run <code className="bg-slate-200 px-1 rounded font-mono">php artisan storage:link</code> via cPanel Terminal or SSH so generated AI images are viewable publicly.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  ChevronRight, 
  ChevronLeft,
  Settings,
  Database,
  Search,
  Sparkles,
  Rocket
} from 'lucide-react';

interface ToggleOption {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface WizardStep {
  id: number;
  title: string;
  icon: React.ElementType;
  options: ToggleOption[];
}

export const Wizard: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [steps, setSteps] = useState<WizardStep[]>([
    {
      id: 1,
      title: 'Environment Setup',
      icon: Settings,
      options: [
        { id: 'env-prod', label: 'Production Environment', description: 'Enable production optimizations and caching.', enabled: true },
        { id: 'env-staging', label: 'Staging Sandbox', description: 'Create a parallel staging environment for testing.', enabled: false },
        { id: 'env-debug', label: 'Debug Mode', description: 'Enable verbose logging and debugging tools.', enabled: false }
      ]
    },
    {
      id: 2,
      title: 'Database & Sync',
      icon: Database,
      options: [
        { id: 'db-auto', label: 'Auto-Sync to WP', description: 'Automatically push content changes to WordPress.', enabled: true },
        { id: 'db-backup', label: 'Daily Backups', description: 'Schedule automated daily backups of all content.', enabled: true },
        { id: 'db-revisions', label: 'Store Revisions', description: 'Keep a history of all content revisions.', enabled: true }
      ]
    },
    {
      id: 3,
      title: 'SEO & Analytics',
      icon: Search,
      options: [
        { id: 'seo-audit', label: 'Auto SEO Audit', description: 'Run SEO audit automatically on save.', enabled: true },
        { id: 'seo-sitemap', label: 'Generate Sitemap', description: 'Automatically update XML sitemaps.', enabled: false },
        { id: 'seo-tracking', label: 'Analytics Tracking', description: 'Inject Google Analytics and tracking codes.', enabled: true }
      ]
    },
    {
      id: 4,
      title: 'AI Capabilities',
      icon: Sparkles,
      options: [
        { id: 'ai-writer', label: 'AI Writing Assistant', description: 'Enable Gemini AI for content generation.', enabled: true },
        { id: 'ai-images', label: 'AI Image Studio', description: 'Enable Nano Banana AI for image generation.', enabled: true },
        { id: 'ai-seo', label: 'AI SEO Suggestions', description: 'Get AI-powered keyword and metadata suggestions.', enabled: true }
      ]
    }
  ]);

  const handleToggle = (stepId: number, optionId: string) => {
    setSteps(prev => prev.map(step => {
      if (step.id === stepId) {
        return {
          ...step,
          options: step.options.map(opt => 
            opt.id === optionId ? { ...opt, enabled: !opt.enabled } : opt
          )
        };
      }
      return step;
    }));
  };

  const currentStepData = steps.find(s => s.id === currentStep);

  return (
    <div className="font-sans">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Rocket className="w-5 h-5 text-indigo-600" />
          Project Setup Wizard
        </h1>
        <p className="text-slate-500 mt-2">Configure your workspace environment step-by-step.</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar Steps Indicator */}
        <div className="w-64 shrink-0 hidden md:block">
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-slate-200 before:-z-10">
            {steps.map((step) => {
              const isPast = step.id < currentStep;
              const isCurrent = step.id === currentStep;
              return (
                <div key={step.id} className="relative flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-slate-50 shrink-0 z-10 transition-colors ${
                    isPast ? 'bg-indigo-600 text-white' :
                    isCurrent ? 'bg-indigo-100 text-indigo-600 border-indigo-50' :
                    'bg-slate-200 text-slate-500'
                  }`}>
                    {isPast ? <CheckCircle2 className="w-5 h-5" /> : <step.icon className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className={`text-sm font-bold ${isCurrent ? 'text-indigo-600' : isPast ? 'text-slate-900' : 'text-slate-500'}`}>
                      Step {step.id}
                    </div>
                    <div className={`text-xs ${isCurrent ? 'text-slate-700' : 'text-slate-400'}`}>
                      {step.title}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {/* Final Step Indicator */}
            <div className="relative flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-slate-50 shrink-0 z-10 transition-colors ${
                currentStep > steps.length ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {currentStep > steps.length ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-4 h-4" />}
              </div>
              <div>
                <div className={`text-sm font-bold ${currentStep > steps.length ? 'text-emerald-600' : 'text-slate-500'}`}>
                  Finish
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm p-8 min-h-[400px] flex flex-col">
          {currentStepData ? (
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600">
                  <currentStepData.icon className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{currentStepData.title}</h2>
                  <p className="text-sm text-slate-500">Enable or disable features for this module.</p>
                </div>
              </div>

              <div className="space-y-4 mt-8">
                {currentStepData.options.map((option) => (
                  <div 
                    key={option.id}
                    onClick={() => handleToggle(currentStepData.id, option.id)}
                    className={`flex items-center justify-between p-5 rounded-xl border-2 transition cursor-pointer ${
                      option.enabled 
                        ? 'border-indigo-600 bg-indigo-50/50' 
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900">{option.label}</div>
                      <div className="text-sm text-slate-500 mt-1">{option.description}</div>
                    </div>
                    <div className="shrink-0 ml-4">
                      {/* Toggle Switch */}
                      <div className={`w-12 h-6 rounded-full transition-colors relative flex items-center ${
                        option.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm absolute transition-transform ${
                          option.enabled ? 'translate-x-7' : 'translate-x-1'
                        }`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Setup Complete!</h2>
              <p className="text-slate-500 mt-2 max-w-sm">
                Your workspace environment is fully configured. You can update these settings later from the main settings panel.
              </p>
              <button
                onClick={() => setCurrentStep(1)}
                className="mt-8 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition"
              >
                Restart Wizard
              </button>
            </div>
          )}

          {/* Navigation Buttons */}
          {currentStep <= steps.length && (
            <div className="flex justify-between items-center mt-12 pt-6 border-t border-slate-100">
              <button
                onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
                disabled={currentStep === 1}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              
              <button
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition shadow-sm"
              >
                {currentStep === steps.length ? 'Complete Setup' : 'Next Step'}
                {currentStep !== steps.length && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

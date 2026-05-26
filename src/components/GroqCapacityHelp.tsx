import React from 'react';

const retrySteps = [
  'Wait 1–5 minutes, then retry the analysis.',
  'Use one lens first, preferably SMC Mechanics, before running multiple lenses.',
  'Upload a smaller, cleaner chart image with only the important levels visible.',
  'Avoid repeated rapid retries; they can extend the capacity window.',
];

const GroqCapacityHelp: React.FC = () => (
  <div className="min-h-screen bg-[#050507] text-gray-200 font-sans selection:bg-emerald-500/30 overflow-y-auto">
    <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,_rgba(16,185,129,0.09)_0%,_transparent_45%)]" />
    <main className="relative max-w-5xl mx-auto px-6 py-10 md:py-14">
      <div className="flex flex-col gap-8">
        <section className="glass-panel p-6 md:p-8 border-emerald-500/20">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-emerald-400 mb-3">
                QuantSage AI Status Help
              </p>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white mb-4">
                AI capacity recovery
              </h1>
              <p className="text-slate-300 leading-relaxed max-w-3xl">
                QuantSage now routes AI requests through a server-side recovery proxy. If Groq
                is busy or rate-limited, the proxy can retry the request with the configured
                fallback provider without exposing provider keys in the browser.
              </p>
            </div>
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              <i className="fa-solid fa-arrow-left" />
              Back to QuantSage
            </a>
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-4">
          <div className="glass-panel p-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-white mb-4">
              What it means
            </h2>
            <p className="text-sm leading-7 text-slate-300">
              The chart is not wrong and the platform did not lose your setup. A capacity state
              means the primary Groq provider could not complete a stage, so QuantSage should
              recover through the proxy fallback when that provider is configured.
            </p>
          </div>
          <div className="glass-panel p-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-white mb-4">
              Why it happens
            </h2>
            <ul className="space-y-3 text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                Groq vision models can hit shared capacity before text-only prompts.
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                Large chart images and multiple lenses increase token load.
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                The proxy needs both Groq and fallback-provider keys configured server-side.
              </li>
            </ul>
          </div>
        </section>

        <section className="glass-panel p-6 md:p-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-white mb-5">
            What to do next
          </h2>
          <div className="grid md:grid-cols-4 gap-3">
            {retrySteps.map((step, index) => (
              <div key={step} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-300">
                  {index + 1}
                </div>
                <p className="text-sm leading-6 text-slate-300">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel p-6 md:p-8 border-sky-500/20">
          <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-white mb-4">
            If it happens often
          </h2>
          <p className="text-sm leading-7 text-slate-300 mb-5">
            Check the Groq console for usage, billing, and rate limits. If production users
            see this frequently, keep the server-side proxy running with a higher-limit Groq key
            and a configured fallback provider. Do not place provider API keys in the browser bundle.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://console.groq.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300 hover:bg-sky-500/20 transition-colors"
            >
              Open Groq Console
              <i className="fa-solid fa-arrow-up-right-from-square" />
            </a>
            <a
              href="https://status.groq.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300 hover:bg-white/[0.06] transition-colors"
            >
              Check Groq Status
              <i className="fa-solid fa-arrow-up-right-from-square" />
            </a>
          </div>
        </section>
      </div>
    </main>
  </div>
);

export default GroqCapacityHelp;

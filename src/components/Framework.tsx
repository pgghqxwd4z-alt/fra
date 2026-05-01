import React from 'react';
import { FRAMEWORK_STEPS } from '../constants';

const Framework: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto py-12 px-6 overflow-y-auto h-full custom-scrollbar">
      <div className="mb-20 text-center">
        <h2 className="text-5xl font-bold text-white mb-6 tracking-tighter">Institutional Synthesis</h2>
        <p className="text-slate-500 text-xl max-w-2xl mx-auto leading-relaxed">A standard workflow for analyzing and executing trades based on multi-layered strategic logic.</p>
      </div>

      <div className="relative space-y-12 before:absolute before:inset-0 before:ml-6 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-px before:bg-gradient-to-b before:from-transparent before:via-emerald-500/50 before:to-transparent">
        {FRAMEWORK_STEPS.map((step, idx) => (
          <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl border border-emerald-500/50 bg-slate-950 text-emerald-500 shadow-2xl shadow-emerald-500/20 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-20 font-mono text-lg font-bold">
              0{idx + 1}
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-4rem)] glass-panel p-10 rounded-[3rem] shadow-2xl hover:border-emerald-500/40 transition-all group-hover:bg-white/[0.03]">
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.4em] mb-4 block">{step.source}</span>
              <h3 className="text-3xl font-bold text-white mb-4 tracking-tight">{step.title}</h3>
              <p className="text-slate-500 mb-8 leading-relaxed">{step.description}</p>
              <div className="flex flex-wrap gap-2">
                {step.details.map((detail, dIdx) => (
                  <span key={dIdx} className="px-4 py-2 rounded-xl bg-slate-900/50 border border-white/5 text-[10px] font-mono text-slate-400 hover:text-emerald-400 transition-colors">
                    {detail}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-24 p-16 glass-panel rounded-[4rem] text-center relative overflow-hidden border border-emerald-500/20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(16,185,129,0.1)_0%,_transparent_70%)]" />
        <h4 className="text-emerald-500 font-bold uppercase tracking-[0.5em] text-[10px] mb-8 relative z-10">THE MASTER PRINCIPLE</h4>
        <blockquote className="text-3xl md:text-4xl text-white italic font-light leading-tight max-w-4xl mx-auto relative z-10">
          "Elite traders have no ego. They are probabilistic machines executing an institutional edge with absolute psychological discipline."
          <footer className="mt-8 text-white/30 not-italic text-sm font-mono uppercase tracking-widest">— QuantSage Professional SOP</footer>
        </blockquote>
      </div>
    </div>
  );
};

export default Framework;

import React from 'react';
import { AnalysisResult } from '../types';
import { Brain, Target, ShieldCheck, Award, Zap, AlertCircle, BookOpen, CheckCircle2, XCircle, MinusCircle, Layers, Fingerprint, Globe, ExternalLink } from 'lucide-react';

interface AnalysisViewProps {
  analysis: AnalysisResult;
  isGlobal?: boolean;
  isSynthesized?: boolean;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({ analysis, isGlobal, isSynthesized }) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Aligned': return <CheckCircle2 className="text-emerald-500" size={18} />;
      case 'Violation': return <XCircle className="text-rose-500" size={18} />;
      default: return <MinusCircle className="text-slate-400" size={18} />;
    }
  };

  return (
    <div className="space-y-6">
      <div className={`border p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden transition-all duration-700 ${isSynthesized ? 'bg-slate-950 border-emerald-500/50 ring-8 ring-emerald-500/5 shadow-[0_0_50px_-12px_rgba(16,185,129,0.3)]' : 'bg-slate-900 border-indigo-500/30'}`}>
        <div className="absolute top-0 right-0 p-8 opacity-5">
          {isSynthesized ? <Fingerprint size={160} /> : (isGlobal ? <Layers size={140} /> : <Target size={120} />)}
        </div>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className={`px-3 py-1 text-[10px] font-black rounded-full uppercase tracking-[0.2em] ${isSynthesized ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'}`}>
              {isSynthesized ? 'MASTER MACRO REASONING' : (isGlobal ? 'Consolidated Session Audit' : 'Audit Summary')}
            </span>
            <div className="flex items-center gap-1.5 text-amber-400">
              <Award size={16} />
              <span className="text-sm font-bold tracking-tight">
                Discipline Rating: {analysis.disciplineScore}/100
              </span>
            </div>
          </div>
          <h2 className="text-3xl font-black mb-6 leading-tight tracking-tight">
            {isSynthesized ? 'Institutional Macro Synthesis' : (isGlobal ? 'Session Structure Report' : 'Strategic Briefing')}
          </h2>
          <div className={`leading-relaxed text-lg font-medium border-l-2 pl-6 py-1 ${isSynthesized ? 'text-emerald-50/80 border-emerald-500/50' : 'text-slate-300 border-indigo-500/50'}`}>
             {analysis.summary}
          </div>
        </div>
      </div>

      {(analysis.verificationSummary || (analysis.dataSources && analysis.dataSources.length > 0)) && (
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between gap-4 mb-6">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3 uppercase tracking-wider">
              <ShieldCheck className="text-emerald-600" size={20} />
              Evidence Verification
            </h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase">Strict lens + data search</span>
          </div>
          {analysis.verificationSummary && (
            <p className="mb-6 rounded-2xl bg-emerald-50 p-4 text-sm font-medium leading-relaxed text-emerald-900 border border-emerald-100">
              {analysis.verificationSummary}
            </p>
          )}
          {analysis.dataSources && analysis.dataSources.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {analysis.dataSources.slice(0, 10).map((source, i) => (
                <div key={`${source.name}-${i}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-xs font-black uppercase text-slate-800">{source.name}</h4>
                    {source.url && (
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">{source.usedFor}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {analysis.newsImpacts && analysis.newsImpacts.length > 0 && (
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-3 uppercase tracking-wider mb-6">
            <Globe className="text-indigo-600" size={20} />
            Macro Impact Analysis
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.newsImpacts.map((impact, i) => (
              <div key={i} className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                <h4 className="font-black text-xs text-indigo-600 uppercase mb-3 border-b pb-2">{impact.event}</h4>
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter block mb-1">Impact on Technicals</span>
                    <p className="text-xs text-slate-700 leading-relaxed">{impact.impactOnTechnicals}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter block mb-1">Douglas Alignment</span>
                    <p className="text-xs text-slate-700 leading-relaxed font-medium italic">"{impact.alignmentWithDouglas}"</p>
                  </div>
                  <div className="pt-2">
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-[11px] font-black text-indigo-600 uppercase flex items-center gap-2">
                      <Target size={14} /> {impact.recommendation}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-3 uppercase tracking-wider">
            <ShieldCheck className="text-indigo-600" size={20} />
            Grounding Matrix
          </h3>
          <span className="text-[10px] font-bold text-slate-400 uppercase">Framework Verification</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {analysis.frameworks.map((fw, i) => (
            <div key={i} className={`p-5 rounded-2xl flex flex-col gap-3 border transition-all hover:-translate-y-1 ${fw.status === 'Violation' ? 'bg-rose-50/50 border-rose-100' : 'bg-slate-50 border-slate-100'}`}>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.1em]">{fw.framework}</span>
                  {fw.source && (
                    <span className="text-[8px] font-bold text-slate-400 uppercase truncate max-w-[80px]">
                      {fw.source}
                    </span>
                  )}
                </div>
                {getStatusIcon(fw.status)}
              </div>
              <p className="text-[11px] text-slate-600 font-medium leading-relaxed italic">"{fw.insight}"</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col relative overflow-hidden">
          <div className="absolute top-4 right-4 text-purple-100"><Brain size={48} /></div>
          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-3 uppercase tracking-wider">
                Psychology Audit
              </h3>
              <span className="text-[9px] bg-purple-50 text-purple-600 px-2 py-1 rounded-full font-black uppercase">Douglas Logic</span>
            </div>
            <p className="text-slate-600 text-sm leading-7 font-medium whitespace-pre-line flex-1 border-l-2 border-purple-100 pl-4">
              {analysis.psychologyInsights}
            </p>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col relative overflow-hidden">
          <div className="absolute top-4 right-4 text-amber-100"><Zap size={48} /></div>
          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-3 uppercase tracking-wider">
                Structural Edge
              </h3>
              <span className="text-[9px] bg-amber-50 text-amber-600 px-2 py-1 rounded-full font-black uppercase">SMC / GS</span>
            </div>
            <p className="text-slate-600 text-sm leading-7 font-medium whitespace-pre-line flex-1 border-l-2 border-amber-100 pl-4">
              {analysis.strategyCritique}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 md:col-span-2 shadow-xl">
          <h3 className="text-lg font-black text-white mb-6 flex items-center gap-3 uppercase tracking-widest">
            <BookOpen className="text-indigo-400" size={20} />
            Wizard Core Principles
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...new Set(analysis.marketWizardsPrinciples)].map((principle, i) => (
              <div key={i} className="flex gap-4 text-sm text-slate-300 bg-white/5 p-5 rounded-2xl border border-white/10 hover:border-indigo-500/30 transition-all">
                <span className="font-black text-indigo-400 text-xs">0{i + 1}</span>
                <span className="font-medium leading-relaxed">{principle}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-black mb-6 text-slate-800 flex items-center gap-3 uppercase tracking-widest">
            <AlertCircle className="text-rose-500" size={20} />
            Risk Audit
          </h3>
          <ul className="space-y-4">
            {[...new Set(analysis.unresolvedQuestions)].slice(0, 8).map((q, i) => (
              <li key={i} className="text-[11px] text-slate-600 bg-rose-50/50 p-4 rounded-xl border border-rose-100 font-bold leading-relaxed italic">
                "{q}"
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={`p-10 rounded-[2.5rem] text-white shadow-2xl transition-all duration-700 ${isSynthesized ? 'bg-emerald-900 ring-8 ring-emerald-500/5' : 'bg-slate-900'}`}>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black flex items-center gap-4 uppercase tracking-[0.2em]">
            <Target size={28} className={isSynthesized ? 'text-emerald-400' : 'text-indigo-400'} />
            Integrated Audit Roadmap
          </h3>
          {isSynthesized && <Fingerprint size={24} className="text-emerald-500 opacity-50" />}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[...new Set(analysis.suggestedActions)].slice(0, 8).map((action, i) => (
            <div key={i} className="flex gap-5 bg-white/5 p-6 rounded-2xl items-start hover:bg-white/10 transition-all border border-white/5">
              <div className={`p-2 px-3 rounded-xl text-xs font-black mt-0.5 ${isSynthesized ? 'bg-emerald-600' : 'bg-indigo-600'}`}>0{i+1}</div>
              <p className="text-sm font-bold leading-relaxed">{action}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

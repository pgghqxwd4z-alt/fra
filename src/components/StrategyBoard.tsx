import React, { useState } from 'react';
import { TRADING_STRATEGIES } from '../constants';
import { TradingStrategy } from '../types';
import Backtester from './Backtester';

const StrategyBoard: React.FC = () => {
  const [selectedStrategy, setSelectedStrategy] = useState<TradingStrategy | null>(null);

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-bold text-white mb-3 tracking-tighter">Strategy Hub</h2>
          <p className="text-slate-500 text-lg max-w-2xl">Proven institutional methodologies combined with modern quantitative testing.</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 px-6 py-3 rounded-2xl flex items-center gap-3">
          <i className="fa-solid fa-vial-circle-check text-emerald-500"></i>
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Backtest Engine Ready</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {TRADING_STRATEGIES.map((strat) => (
          <div key={strat.id} className="glass-panel rounded-[2rem] p-8 hover:border-emerald-500/30 transition-all group flex flex-col h-full shadow-xl">
            <div className="flex items-start justify-between mb-8">
              <div className="flex-1">
                <span className={`text-[10px] px-3 py-1.5 rounded-full border font-mono tracking-widest uppercase mb-4 inline-block ${
                  strat.difficulty === 'Advanced' ? 'border-amber-500/50 text-amber-500 bg-amber-500/5' : 'border-emerald-500/50 text-emerald-500 bg-emerald-500/5'
                }`}>
                  {strat.difficulty}
                </span>
                <h3 className="text-2xl font-bold text-white tracking-tight">{strat.name}</h3>
                <p className="text-[10px] text-emerald-500/60 font-mono tracking-widest mt-1 uppercase">{strat.source}</p>
              </div>
            </div>
            
            <p className="text-slate-400 text-sm leading-relaxed mb-8">{strat.description}</p>
            
            <div className="mb-8">
              <h4 className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-4">Core Components</h4>
              <div className="flex flex-wrap gap-2">
                {strat.coreConcepts.map((concept, i) => (
                  <span key={i} className="text-[10px] bg-slate-900 border border-white/5 text-slate-400 px-3 py-1.5 rounded-lg hover:text-emerald-400 transition-colors">
                    {concept}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-white/5">
              <button 
                onClick={() => setSelectedStrategy(strat)}
                className="w-full py-4 bg-white/5 hover:bg-emerald-500 hover:text-slate-950 text-emerald-500 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-3 border border-emerald-500/20 group-hover:border-emerald-500/50"
              >
                <i className="fa-solid fa-flask"></i>
                Launch Backtester
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedStrategy && (
        <Backtester 
          strategy={selectedStrategy} 
          onClose={() => setSelectedStrategy(null)} 
        />
      )}
    </div>
  );
};

export default StrategyBoard;

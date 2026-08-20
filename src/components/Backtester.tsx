import React, { useState, useEffect, useRef } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { TradingStrategy } from '../types';

interface BacktesterProps {
  strategy: TradingStrategy;
  onClose: () => void;
}

interface BacktestResult {
  date: string;
  equity: number;
  drawdown: number;
  isWin?: boolean;
  tradeType?: 'Win' | 'Loss' | 'Initial';
}

interface SimulationParams {
  winRate: number;
  rewardRisk: number;
  riskPerTrade: number;
  initialBalance: number;
  tradeCount: number;
}

interface SavedSimulation {
  id: string;
  strategyId: string;
  strategyName: string;
  timestamp: number;
  isImported?: boolean;
  params: SimulationParams;
  stats: {
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    netProfit: number;
    totalTrades: number;
  };
  results: BacktestResult[];
}

const Backtester: React.FC<BacktesterProps> = ({ strategy, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SavedSimulation[]>([]);
  const [isImported, setIsImported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [params, setParams] = useState<SimulationParams>({
    winRate: strategy.id === 'smc' ? 45 : strategy.id === 'ppa' ? 52 : 60,
    rewardRisk: strategy.id === 'smc' ? 3.5 : strategy.id === 'ppa' ? 2.0 : 1.5,
    riskPerTrade: 1,
    initialBalance: 10000,
    tradeCount: 50
  });

  const [stats, setStats] = useState({
    winRate: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    netProfit: 0,
    totalTrades: 0
  });

  useEffect(() => {
    const saved = localStorage.getItem('quantsage_backtest_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const saveToHistory = () => {
    if (results.length === 0) return;
    
    const newSim: SavedSimulation = {
      id: crypto.randomUUID(),
      strategyId: strategy.id,
      strategyName: isImported ? `${strategy.name} (Imported)` : strategy.name,
      timestamp: Date.now(),
      isImported,
      params,
      stats,
      results
    };

    const updatedHistory = [newSim, ...history].slice(0, 20);
    setHistory(updatedHistory);
    localStorage.setItem('quantsage_backtest_history', JSON.stringify(updatedHistory));
  };

  const loadFromHistory = (sim: SavedSimulation) => {
    setResults(sim.results);
    setStats(sim.stats);
    setParams(sim.params);
    setIsImported(!!sim.isImported);
    setShowHistory(false);
  };

  const deleteFromHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedHistory = history.filter(s => s.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem('quantsage_backtest_history', JSON.stringify(updatedHistory));
  };

  const calculateStats = (data: BacktestResult[], initialEquity: number) => {
    let wins = 0;
    let totalGain = 0;
    let totalLoss = 0;
    let maxDD = 0;
    const finalEquity = data[data.length - 1].equity;

    data.forEach((d, idx) => {
      if (d.tradeType === 'Win') {
        wins++;
        totalGain += (d.equity - data[idx-1].equity);
      } else if (d.tradeType === 'Loss') {
        totalLoss += Math.abs(d.equity - data[idx-1].equity);
      }
      maxDD = Math.max(maxDD, Math.abs(d.drawdown));
    });

    const tradeCount = data.length - 1;

    return {
      winRate: tradeCount > 0 ? Math.round((wins / tradeCount) * 100) : 0,
      profitFactor: totalLoss > 0 ? Math.round((totalGain / totalLoss) * 100) / 100 : totalGain > 0 ? 99 : 0,
      maxDrawdown: Math.round(maxDD * 100) / 100,
      netProfit: Math.round(((finalEquity - initialEquity) / initialEquity) * 10000) / 100,
      totalTrades: tradeCount
    };
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        
        let currentEquity = params.initialBalance;
        let peakEquity = params.initialBalance;
        const data: BacktestResult[] = [{
          date: `Start`,
          equity: params.initialBalance,
          drawdown: 0,
          tradeType: 'Initial'
        }];

        lines.forEach((line, i) => {
          const parts = line.split(/[;,]/);
          const val = parseFloat(parts[0]) || parseFloat(parts[1]);
          
          if (!isNaN(val)) {
            currentEquity += val;
            peakEquity = Math.max(peakEquity, currentEquity);
            const dd = ((peakEquity - currentEquity) / peakEquity) * 100;

            data.push({
              date: `T${i + 1}`,
              equity: Math.round(currentEquity),
              drawdown: -Math.round(dd * 100) / 100,
              isWin: val > 0,
              tradeType: val > 0 ? 'Win' : 'Loss'
            });
          }
        });

        if (data.length > 1) {
          setResults(data);
          setStats(calculateStats(data, params.initialBalance));
          setIsImported(true);
          setShowHistory(false);
        } else {
          alert("Could not parse valid numerical trade data.");
        }
      } catch (err) {
        alert("CSV parse failure.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const runSimulation = () => {
    setLoading(true);
    setTimeout(() => {
      // Monte Carlo Logic
      const data: BacktestResult[] = [{
        date: 'Start',
        equity: params.initialBalance,
        drawdown: 0,
        tradeType: 'Initial'
      }];

      let currentBalance = params.initialBalance;
      let peakBalance = params.initialBalance;

      for (let i = 0; i < params.tradeCount; i++) {
        const isWin = Math.random() * 100 < params.winRate;
        const riskAmount = currentBalance * (params.riskPerTrade / 100);
        const pnl = isWin ? riskAmount * params.rewardRisk : -riskAmount;
        
        currentBalance += pnl;
        peakBalance = Math.max(peakBalance, currentBalance);
        const dd = ((peakBalance - currentBalance) / peakBalance) * 100;

        data.push({
          date: `T${i + 1}`,
          equity: Math.round(currentBalance),
          drawdown: -Math.round(dd * 100) / 100,
          isWin,
          tradeType: isWin ? 'Win' : 'Loss'
        });
      }

      setResults(data);
      setStats(calculateStats(data, params.initialBalance));
      setIsImported(false);
      setLoading(false);
    }, 1000);
  };

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.tradeType === 'Initial') return null;
    const color = payload.isWin ? '#10b981' : '#f43f5e';
    return (
      <svg x={cx - 3} y={cy - 3} width={6} height={6} fill={color} viewBox="0 0 6 6">
        <circle cx="3" cy="3" r="3" />
      </svg>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-8">
      <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl" onClick={onClose}></div>
      <div className="relative w-full max-w-6xl glass-panel rounded-[3rem] overflow-hidden flex flex-col h-full max-h-[92vh] shadow-2xl border border-white/10">
        <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[10px] font-mono text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-1 rounded">Quant Engine v3.0</span>
              <h2 className="text-2xl font-bold text-white tracking-tight">{showHistory ? 'Archive' : `Historical Backtest Engine`}</h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button onClick={() => setShowHistory(!showHistory)} className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${showHistory ? 'bg-emerald-500 text-slate-950' : 'border-white/10 text-slate-400'}`}>
                <i className="fa-solid fa-clock-rotate-left"></i>
             </button>
             <button onClick={onClose} className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-slate-400">
                <i className="fa-solid fa-xmark"></i>
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          {showHistory ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {history.map((sim) => (
                <div key={sim.id} onClick={() => loadFromHistory(sim)} className="bg-slate-900/40 border border-white/5 p-6 rounded-[2rem] hover:border-emerald-500/40 transition-all cursor-pointer group relative">
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100"><button onClick={(e) => deleteFromHistory(sim.id, e)} className="text-slate-600 hover:text-rose-500"><i className="fa-solid fa-trash-can text-xs"></i></button></div>
                  <h4 className="text-white font-bold">{sim.strategyName}</h4>
                  <p className={`text-sm font-mono ${sim.stats.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{sim.stats.netProfit}%</p>
                </div>
              ))}
            </div>
          ) : !results.length && !loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 py-10">
              <div className="space-y-10">
                <div className="space-y-8 max-w-md">
                  {[
                    { label: 'Win Probability', state: 'winRate', min: 10, max: 90, unit: '%', step: 1 },
                    { label: 'Reward : Risk', state: 'rewardRisk', min: 1.0, max: 10.0, unit: 'x', step: 0.1 },
                    { label: 'Risk per Trade', state: 'riskPerTrade', min: 0.1, max: 5.0, unit: '%', step: 0.1 },
                    { label: 'Sample Size', state: 'tradeCount', min: 10, max: 200, unit: ' trades', step: 5 },
                  ].map((cfg) => (
                    <div key={cfg.state} className="space-y-4">
                      <div className="flex justify-between items-center"><label className="text-[10px] font-bold text-white/40 uppercase">{cfg.label}</label><span className="text-xs font-mono text-emerald-400">{(params as any)[cfg.state]}{cfg.unit}</span></div>
                      <input type="range" min={cfg.min} max={cfg.max} step={cfg.step} value={(params as any)[cfg.state]} onChange={(e) => setParams(prev => ({...prev, [cfg.state]: parseFloat(e.target.value)}))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-center gap-6">
                <div className="glass-panel p-10 rounded-[3rem] border-emerald-500/20 bg-emerald-500/[0.02] space-y-8 text-center">
                   <button onClick={runSimulation} className="w-full bg-emerald-500 text-slate-950 font-bold py-6 rounded-[1.5rem] uppercase tracking-widest">Execute Simulation</button>
                   <div className="pt-6 border-t border-white/5">
                    <button onClick={() => fileInputRef.current?.click()} className="text-xs font-bold text-slate-500 hover:text-emerald-400 uppercase tracking-widest flex items-center justify-center gap-2 mx-auto"><i className="fa-solid fa-file-import"></i> Import CSV</button>
                    <input type="file" ref={fileInputRef} onChange={handleCSVImport} accept=".csv" className="hidden" />
                  </div>
                </div>
              </div>
            </div>
          ) : loading ? (
            <div className="h-full flex flex-col items-center justify-center py-20 gap-8"><div className="w-24 h-24 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin"></div><p className="text-emerald-500 font-mono text-[10px] uppercase tracking-[0.5em] animate-pulse">Running Simulation...</p></div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Net Profit', value: `${stats.netProfit}%`, color: stats.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Win Rate', value: `${stats.winRate}%`, color: 'text-white' },
                  { label: 'Profit Factor', value: stats.profitFactor, color: 'text-white' },
                  { label: 'Max Drawdown', value: `-${stats.maxDrawdown}%`, color: 'text-rose-400' },
                  { label: 'Trades', value: stats.totalTrades, color: 'text-slate-500' },
                ].map((stat, i) => (
                  <div key={i} className="bg-slate-900/40 border border-white/5 p-6 rounded-3xl">
                    <p className="text-[9px] font-bold text-white/20 uppercase mb-3">{stat.label}</p>
                    <p className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="glass-panel rounded-[2.5rem] p-8 h-[400px] border border-white/5">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={results}>
                    <defs><linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis domain={['auto', 'auto']} orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px' }} />
                    <Area type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorEquity)" dot={<CustomDot />} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col lg:flex-row items-center justify-center gap-4 py-6 border-t border-white/5">
                <button onClick={() => setResults([])} className="bg-white/5 text-emerald-500 text-[10px] font-bold uppercase tracking-widest px-8 py-4 rounded-2xl">New Configuration</button>
                <button onClick={saveToHistory} className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-widest px-8 py-4 rounded-2xl">Archive Results</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Backtester;

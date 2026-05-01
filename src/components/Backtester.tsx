import React, { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { TradingStrategy } from '../types';

interface BacktesterProps {
  strategy: TradingStrategy;
  onClose: () => void;
}

interface BacktestResult {
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  expectancy: number;
  equityCurves: { trade: number; median: number; p10: number; p90: number; best: number; worst: number }[];
  finalEquities: number[];
}

const STORAGE_KEY = 'quantsage_backtest_results';

function loadSavedResults(): Record<string, BacktestResult> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function saveResult(strategyId: string, result: BacktestResult) {
  try {
    const all = loadSavedResults();
    all[strategyId] = result;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* storage full or unavailable */ }
}

function runMonteCarloSimulation(
  winProb: number,
  rewardRisk: number,
  riskPerTrade: number,
  sampleSize: number,
  numSimulations: number = 1000
): BacktestResult {
  const startingEquity = 10000;
  const allCurves: number[][] = [];
  const finalEquities: number[] = [];
  let totalWins = 0;
  let totalLosses = 0;
  let totalWinAmount = 0;
  let totalLossAmount = 0;

  for (let sim = 0; sim < numSimulations; sim++) {
    let equity = startingEquity;
    const curve: number[] = [equity];

    for (let t = 0; t < sampleSize; t++) {
      const riskAmount = equity * (riskPerTrade / 100);
      if (Math.random() < winProb / 100) {
        const win = riskAmount * rewardRisk;
        equity += win;
        totalWins++; totalWinAmount += win;
      } else {
        equity -= riskAmount;
        totalLosses++; totalLossAmount += riskAmount;
      }
      curve.push(Math.max(0, equity));
    }

    allCurves.push(curve);
    finalEquities.push(equity);
  }

  const equityCurves: BacktestResult['equityCurves'] = [];
  for (let t = 0; t <= sampleSize; t++) {
    const values = allCurves.map(c => c[t]).sort((a, b) => a - b);
    equityCurves.push({
      trade: t,
      worst: values[Math.floor(values.length * 0.01)],
      p10: values[Math.floor(values.length * 0.1)],
      median: values[Math.floor(values.length * 0.5)],
      p90: values[Math.floor(values.length * 0.9)],
      best: values[Math.floor(values.length * 0.99)],
    });
  }

  let peak = startingEquity;
  let maxDD = 0;
  for (const pt of equityCurves) {
    if (pt.median > peak) peak = pt.median;
    const dd = ((peak - pt.median) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const avgWin = totalWins > 0 ? totalWinAmount / totalWins : 0;
  const avgLoss = totalLosses > 0 ? totalLossAmount / totalLosses : 0;
  const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
  const expectancy = (winProb / 100) * avgWin - ((100 - winProb) / 100) * avgLoss;

  const avgReturn = finalEquities.reduce((s, v) => s + (v - startingEquity), 0) / numSimulations;
  const stdDev = Math.sqrt(finalEquities.reduce((s, v) => s + Math.pow((v - startingEquity) - avgReturn, 2), 0) / numSimulations);
  const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;

  return {
    winRate: winProb,
    profitFactor,
    totalTrades: sampleSize,
    avgWin,
    avgLoss: -avgLoss,
    maxDrawdown: -maxDD,
    sharpeRatio: sharpe,
    expectancy,
    equityCurves,
    finalEquities: finalEquities.sort((a, b) => a - b),
  };
}

const fmtCur = (v: number) => {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
};

const Backtester: React.FC<BacktesterProps> = ({ strategy, onClose }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [winProb, setWinProb] = useState(60);
  const [rewardRisk, setRewardRisk] = useState(2.0);
  const [riskPerTrade, setRiskPerTrade] = useState(1.0);
  const [sampleSize, setSampleSize] = useState(200);

  useEffect(() => {
    const saved = loadSavedResults();
    setResult(saved[strategy.id] || null);
  }, [strategy.id]);

  const runBacktest = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const res = runMonteCarloSimulation(winProb, rewardRisk, riskPerTrade, sampleSize, 1000);
      setResult(res);
      saveResult(strategy.id, res);
      setRunning(false);
    }, 100);
  }, [winProb, rewardRisk, riskPerTrade, sampleSize, strategy.id]);

  return (
    <div className="glass-panel rounded-[2rem] p-6 border border-emerald-500/20 bg-emerald-500/[0.02]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">{strategy.name}</h3>
          <p className="text-[10px] text-emerald-500/60 font-mono uppercase tracking-widest mt-1">
            Monte Carlo Simulation Engine — 1,000 Probabilistic Paths
          </p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-slate-500 hover:text-white">
          <i className="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <ParamSlider label="Win Probability" value={winProb} min={30} max={85} step={1} unit="%" onChange={setWinProb} />
        <ParamSlider label="Reward:Risk" value={rewardRisk} min={0.5} max={5} step={0.1} unit="R" onChange={setRewardRisk} />
        <ParamSlider label="Risk/Trade" value={riskPerTrade} min={0.25} max={5} step={0.25} unit="%" onChange={setRiskPerTrade} />
        <ParamSlider label="Sample Size" value={sampleSize} min={50} max={500} step={10} unit=" trades" onChange={setSampleSize} />
      </div>

      <div className="mb-6">
        <button onClick={runBacktest} disabled={running}
          className="w-full px-8 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3">
          {running ? (<><i className="fa-solid fa-circle-notch fa-spin"></i>Running 1,000 Simulations...</>)
            : (<><i className="fa-solid fa-flask"></i>{result ? 'Re-run Simulation' : 'Execute Monte Carlo'}</>)}
        </button>
        {running && (
          <p className="text-[10px] text-white/20 mt-2 text-center font-mono uppercase tracking-widest animate-pulse">
            Crunching 1,000 probabilistic equity paths...
          </p>
        )}
      </div>

      {result && (
        <>
          <div className="mb-6 bg-black/30 rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <i className="fa-solid fa-chart-area text-emerald-500 text-[10px]"></i>
              <h4 className="text-[9px] font-bold text-white/60 uppercase tracking-widest">
                Probabilistic Equity Curve — 1,000 Simulations
              </h4>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={result.equityCurves} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gP90" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gMed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="gP10" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)"/>
                <XAxis dataKey="trade" stroke="rgba(255,255,255,0.1)" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false}/>
                <YAxis stroke="rgba(255,255,255,0.1)" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={fmtCur} tickLine={false}/>
                <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '12px', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: 'white' }}
                  formatter={(value: number, name: string) => [fmtCur(value), name]}
                  labelFormatter={(label) => 'Trade #' + label}/>
                <ReferenceLine y={10000} stroke="rgba(255,255,255,0.1)" strokeDasharray="5 5"/>
                <Area type="monotone" dataKey="best" stroke="none" fill="url(#gP90)" name="99th %ile"/>
                <Area type="monotone" dataKey="p90" stroke="rgba(16,185,129,0.2)" strokeWidth={1} fill="url(#gP90)" name="90th %ile" strokeDasharray="4 4"/>
                <Area type="monotone" dataKey="median" stroke="#10b981" strokeWidth={2} fill="url(#gMed)" name="Median"/>
                <Area type="monotone" dataKey="p10" stroke="rgba(244,63,94,0.3)" strokeWidth={1} fill="url(#gP10)" name="10th %ile" strokeDasharray="4 4"/>
                <Area type="monotone" dataKey="worst" stroke="none" fill="url(#gP10)" name="1st %ile"/>
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 mt-2">
              <LegendDot color="bg-emerald-500" label="Median"/>
              <LegendDot color="bg-emerald-500/30" label="P10-P90 Band"/>
              <LegendDot color="bg-rose-500/30" label="Worst Case"/>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Win Rate" value={result.winRate.toFixed(1) + '%'} color="text-emerald-400"/>
            <StatCard label="Profit Factor" value={result.profitFactor.toFixed(2)} color="text-emerald-400"/>
            <StatCard label="Expectancy" value={(result.expectancy >= 0 ? '+$' : '-$') + Math.abs(result.expectancy).toFixed(2)} color={result.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}/>
            <StatCard label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} color="text-sky-400"/>
            <StatCard label="Total Trades" value={result.totalTrades.toString()} color="text-white"/>
            <StatCard label="Avg Win" value={'$' + result.avgWin.toFixed(2)} color="text-emerald-400"/>
            <StatCard label="Avg Loss" value={'$' + result.avgLoss.toFixed(2)} color="text-rose-400"/>
            <StatCard label="Max Drawdown" value={result.maxDrawdown.toFixed(1) + '%'} color="text-rose-400"/>
          </div>

          <div className="bg-black/20 rounded-xl p-3 border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-chart-bar text-emerald-500 text-[10px]"></i>
              <h4 className="text-[9px] font-bold text-white/60 uppercase tracking-widest">Final Equity Distribution (1,000 paths)</h4>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center">
              <DistStat label="Worst 1%" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.01)])} color="text-rose-400"/>
              <DistStat label="10th %ile" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.1)])} color="text-rose-300"/>
              <DistStat label="Median" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.5)])} color="text-emerald-400"/>
              <DistStat label="90th %ile" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.9)])} color="text-emerald-300"/>
              <DistStat label="Best 1%" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.99)])} color="text-emerald-200"/>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const ParamSlider: React.FC<{ label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }> = ({ label, value, min, max, step, unit, onChange }) => (
  <div className="bg-black/30 rounded-xl p-3 border border-white/5">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest">{label}</span>
      <span className="text-[11px] font-bold text-emerald-400 font-mono">{value}{unit}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"/>
  </div>
);

const StatCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-black/30 rounded-xl p-3 border border-white/5 text-center">
    <p className="text-[8px] font-bold text-white/30 uppercase tracking-widest mb-1">{label}</p>
    <p className={'text-lg font-bold font-mono ' + color}>{value}</p>
  </div>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-1.5">
    <div className={'w-2 h-2 rounded-full ' + color}></div>
    <span className="text-[8px] text-white/40 font-mono uppercase tracking-widest">{label}</span>
  </div>
);

const DistStat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div>
    <p className="text-[7px] text-white/30 uppercase tracking-widest mb-0.5">{label}</p>
    <p className={'text-[11px] font-bold font-mono ' + color}>{value}</p>
  </div>
);

export default Backtester;

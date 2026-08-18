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
  initialEquity: number;
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
  source?: 'simulation' | 'imported';
}

const STORAGE_KEY = 'quantsage_backtest_results';
const HISTORY_STORAGE_KEY = 'quantsage_backtest_history';

interface SimulationParams {
  winProb: number;
  rewardRisk: number;
  riskPerTrade: number;
  sampleSize: number;
  initialBalance: number;
}

interface SavedSimulation {
  id: string;
  strategyId: string;
  strategyName: string;
  timestamp: number;
  result: BacktestResult;
  params: SimulationParams;
}

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

function loadHistory(): SavedSimulation[] {
  try {
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed.filter(entry => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Record<string, unknown>;
        const result = candidate.result;
        const params = candidate.params;
        const simulationParams = params as Record<string, unknown> | null;
        return typeof candidate.id === 'string' &&
          typeof candidate.strategyId === 'string' &&
          typeof candidate.strategyName === 'string' &&
          typeof candidate.timestamp === 'number' &&
          result !== null &&
          typeof result === 'object' &&
          Array.isArray((result as Record<string, unknown>).equityCurves) &&
          params !== null &&
          typeof params === 'object' &&
          typeof simulationParams?.winProb === 'number' &&
          typeof simulationParams?.rewardRisk === 'number' &&
          typeof simulationParams?.riskPerTrade === 'number' &&
          typeof simulationParams?.sampleSize === 'number' &&
          typeof simulationParams?.initialBalance === 'number';
      })
      : [];
  } catch { return []; }
}

function saveHistory(strategyId: string, strategyHistory: SavedSimulation[]): SavedSimulation[] | null {
  const otherStrategies = loadHistory().filter(entry => entry.strategyId !== strategyId);
  const pendingHistory = [...strategyHistory.slice(0, 20), ...otherStrategies];

  while (pendingHistory.length > 0) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(pendingHistory));
      return pendingHistory;
    } catch {
      const oldestIndex = pendingHistory.reduce(
        (oldest, entry, index) => entry.timestamp < pendingHistory[oldest].timestamp ? index : oldest,
        0
      );
      pendingHistory.splice(oldestIndex, 1);
    }
  }

  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, '[]');
    return [];
  } catch {
    window.alert('Could not save backtest history. Your current history was not changed.');
    return null;
  }
}

function runMonteCarloSimulation(
  winProb: number,
  rewardRisk: number,
  riskPerTrade: number,
  sampleSize: number,
  numSimulations: number = 1000,
  startingEquity: number = 10000
): BacktestResult {
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
    initialEquity: startingEquity,
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
    source: 'simulation',
  };
}

function parseTradePnlValues(text: string): number[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes('\t')
    ? '\t'
    : lines[0].includes(';')
      ? ';'
      : ',';
  const tokenizeRow = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (character === delimiter && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += character;
      }
    }

    values.push(current.trim());
    return values;
  };

  const firstRow = tokenizeRow(lines[0]).map(value => value.toLowerCase());
  const pnlColumn = firstRow.findIndex(value => /pnl|profit|return|result|gain|loss|amount/.test(value));
  const startAt = pnlColumn >= 0 ? 1 : 0;
  const column = pnlColumn >= 0 ? pnlColumn : 0;

  const parseValue = (value: string): number | null => {
    const normalized = value.trim().replace(/[$€£,\s]/g, '');
    if (normalized.endsWith('%')) return null;
    if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  if (lines.slice(startAt).some(line => tokenizeRow(line)[column]?.trim().endsWith('%'))) {
    return [];
  }

  return lines.slice(startAt).reduce<number[]>((values, line) => {
    const parts = tokenizeRow(line);
    const selected = parseValue(parts[column] ?? '');
    if (selected !== null) values.push(selected);
    return values;
  }, []);
}

function createImportedResult(values: number[], startingEquity: number): BacktestResult {
  let equity = startingEquity;
  let peak = startingEquity;
  let maxDrawdown = 0;
  let totalWins = 0;
  let totalWinAmount = 0;
  let totalLosses = 0;
  let totalLossAmount = 0;
  const allCurves: number[][] = [[startingEquity]];

  values.forEach(value => {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
    if (value > 0) {
      totalWins++;
      totalWinAmount += value;
    } else if (value < 0) {
      totalLosses++;
      totalLossAmount += Math.abs(value);
    }
    allCurves[0].push(Math.max(0, equity));
  });

  const avgPnl = values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const variance = values.length > 0
    ? values.reduce((sum, value) => sum + Math.pow(value - avgPnl, 2), 0) / values.length
    : 0;
  const stdDev = Math.sqrt(variance);

  return {
    initialEquity: startingEquity,
    winRate: values.length > 0 ? (totalWins / values.length) * 100 : 0,
    profitFactor: totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 99 : 0,
    totalTrades: values.length,
    avgWin: totalWins > 0 ? totalWinAmount / totalWins : 0,
    avgLoss: totalLosses > 0 ? -(totalLossAmount / totalLosses) : 0,
    maxDrawdown: -maxDrawdown,
    sharpeRatio: stdDev > 0 ? avgPnl / stdDev : 0,
    expectancy: avgPnl,
    equityCurves: allCurves[0].map((value, trade) => ({
      trade,
      median: value,
      p10: value,
      p90: value,
      best: value,
      worst: value,
    })),
    finalEquities: [Math.max(0, equity)],
    source: 'imported',
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
  const [initialBalance, setInitialBalance] = useState(10000);
  const [history, setHistory] = useState<SavedSimulation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isImported, setIsImported] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = loadSavedResults();
    const savedResult = saved[strategy.id];
    setResult(savedResult ? { ...savedResult, initialEquity: savedResult.initialEquity ?? 10000 } : null);
    if (savedResult?.initialEquity) setInitialBalance(savedResult.initialEquity);
  }, [strategy.id]);

  useEffect(() => {
    setHistory(loadHistory().filter(entry => entry.strategyId === strategy.id));
  }, [strategy.id]);

  const runBacktest = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const res = runMonteCarloSimulation(winProb, rewardRisk, riskPerTrade, sampleSize, 1000, initialBalance);
      setResult(res);
      setIsImported(false);
      setShowHistory(false);
      saveResult(strategy.id, res);
      setRunning(false);
    }, 100);
  }, [winProb, rewardRisk, riskPerTrade, sampleSize, initialBalance, strategy.id]);

  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRunning(true);
    const reader = new FileReader();
    reader.onload = () => {
      const values = parseTradePnlValues(String(reader.result ?? ''));
      if (values.length === 0) {
        window.alert('Could not parse valid numerical trade data.');
      } else {
        setResult(createImportedResult(values, initialBalance));
        setIsImported(true);
        setShowHistory(false);
      }
      setRunning(false);
      event.target.value = '';
    };
    reader.onerror = () => {
      window.alert('CSV parse failure.');
      setRunning(false);
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  const saveCurrentToHistory = () => {
    if (!result) return;
    const entry: SavedSimulation = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      strategyId: strategy.id,
      strategyName: isImported ? `${strategy.name} (Imported)` : strategy.name,
      timestamp: Date.now(),
      result,
      params: { winProb, rewardRisk, riskPerTrade, sampleSize, initialBalance },
    };
    const updatedHistory = [entry, ...history].slice(0, 20);
    const persistedHistory = saveHistory(strategy.id, updatedHistory);
    if (persistedHistory) {
      setHistory(persistedHistory.filter(item => item.strategyId === strategy.id));
    }
  };

  const loadFromHistory = (entry: SavedSimulation) => {
    setResult(entry.result);
    setIsImported(entry.result.source === 'imported');
    setWinProb(entry.params.winProb);
    setRewardRisk(entry.params.rewardRisk);
    setRiskPerTrade(entry.params.riskPerTrade);
    setSampleSize(entry.params.sampleSize);
    setInitialBalance(entry.params.initialBalance);
    setShowHistory(false);
  };

  const deleteFromHistory = (id: string) => {
    const updatedHistory = history.filter(entry => entry.id !== id);
    const persistedHistory = saveHistory(strategy.id, updatedHistory);
    if (persistedHistory) {
      setHistory(persistedHistory.filter(item => item.strategyId === strategy.id));
    }
  };

  return (
    <div className="glass-panel rounded-[2rem] p-6 border border-emerald-500/20 bg-emerald-500/[0.02]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">{strategy.name}</h3>
          <p className="text-[10px] text-emerald-500/60 font-mono uppercase tracking-widest mt-1">
            Monte Carlo Simulation Engine — 1,000 Probabilistic Paths
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 text-[9px] font-bold text-slate-400 hover:text-emerald-400 uppercase tracking-widest border border-white/10 rounded-xl transition-colors"
          >
            <i className="fa-solid fa-file-import mr-2"></i>Import CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCSVImport} className="hidden" />
          <button
            onClick={() => setShowHistory(value => !value)}
            className={`px-3 py-2 text-[9px] font-bold uppercase tracking-widest border rounded-xl transition-colors ${
              showHistory ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-slate-400 hover:text-emerald-400'
            }`}
          >
            <i className="fa-solid fa-clock-rotate-left mr-2"></i>History ({history.length})
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-slate-500 hover:text-white">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
      </div>

      {!showHistory && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <ParamSlider label="Win Probability" value={winProb} min={30} max={85} step={1} unit="%" onChange={setWinProb} />
          <ParamSlider label="Reward:Risk" value={rewardRisk} min={0.5} max={5} step={0.1} unit="R" onChange={setRewardRisk} />
          <ParamSlider label="Risk/Trade" value={riskPerTrade} min={0.25} max={5} step={0.25} unit="%" onChange={setRiskPerTrade} />
          <ParamSlider label="Sample Size" value={sampleSize} min={50} max={500} step={10} unit=" trades" onChange={setSampleSize} />
          <ParamSlider label="Initial Balance" value={initialBalance} min={1000} max={100000} step={500} unit="" onChange={setInitialBalance} formatValue={value => fmtCur(value)} />
        </div>
      )}

      {!showHistory && <div className="mb-6">
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
      </div>}

      {showHistory && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {history.length === 0 ? (
            <p className="col-span-full py-12 text-center text-xs text-white/30 font-mono uppercase tracking-widest">No saved simulations yet.</p>
          ) : history.map(entry => (
            <div key={entry.id} className="relative rounded-xl border border-white/5 bg-black/20 p-4 hover:border-emerald-500/30 transition-colors">
              <button onClick={() => deleteFromHistory(entry.id)} className="absolute right-3 top-3 text-slate-600 hover:text-rose-400">
                <i className="fa-solid fa-trash-can text-[10px]"></i>
              </button>
              <button onClick={() => loadFromHistory(entry)} className="w-full text-left pr-5">
                <p className="text-xs font-bold text-white truncate">{entry.strategyName}</p>
                <p className="text-[9px] text-white/30 font-mono uppercase tracking-widest mt-1">
                  {new Date(entry.timestamp).toLocaleString()}
                </p>
                <p className={`text-sm font-mono mt-3 ${entry.result.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {entry.result.totalTrades} trades · {entry.result.winRate.toFixed(1)}% win rate
                </p>
              </button>
            </div>
          ))}
        </div>
      )}

      {result && !showHistory && (
        <>
          <div className="mb-6 bg-black/30 rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <i className="fa-solid fa-chart-area text-emerald-500 text-[10px]"></i>
              <h4 className="text-[9px] font-bold text-white/60 uppercase tracking-widest">
                {result.source === 'imported' ? 'Imported Trade-List Equity Curve' : 'Probabilistic Equity Curve — 1,000 Simulations'}
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
                <ReferenceLine y={result.initialEquity} stroke="rgba(255,255,255,0.1)" strokeDasharray="5 5"/>
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
              <h4 className="text-[9px] font-bold text-white/60 uppercase tracking-widest">
                {result.source === 'imported' ? 'Final Equity' : 'Final Equity Distribution (1,000 paths)'}
              </h4>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center">
              <DistStat label="Worst 1%" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.01)])} color="text-rose-400"/>
              <DistStat label="10th %ile" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.1)])} color="text-rose-300"/>
              <DistStat label="Median" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.5)])} color="text-emerald-400"/>
              <DistStat label="90th %ile" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.9)])} color="text-emerald-300"/>
              <DistStat label="Best 1%" value={fmtCur(result.finalEquities[Math.floor(result.finalEquities.length * 0.99)])} color="text-emerald-200"/>
            </div>
          </div>
          <div className="flex justify-center gap-3 mt-4">
            <button
              onClick={() => { setResult(null); setIsImported(false); }}
              className="px-4 py-2 text-[9px] font-bold text-slate-500 hover:text-white uppercase tracking-widest border border-white/10 rounded-xl transition-colors"
            >
              New Configuration
            </button>
            <button
              onClick={saveCurrentToHistory}
              className="px-4 py-2 text-[9px] font-bold text-emerald-400 hover:text-emerald-300 uppercase tracking-widest border border-emerald-500/20 rounded-xl transition-colors"
            >
              Save to History
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  formatValue?: (value: number) => string;
}> = ({ label, value, min, max, step, unit, onChange, formatValue }) => (
  <div className="bg-black/30 rounded-xl p-3 border border-white/5">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest">{label}</span>
      <span className="text-[11px] font-bold text-emerald-400 font-mono">{formatValue ? formatValue(value) : `${value}${unit}`}</span>
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

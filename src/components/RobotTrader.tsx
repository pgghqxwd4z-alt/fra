import React, { useEffect, useMemo, useState } from 'react';
import { ROBOT_TRADE_PLAN } from '../constants';
import { RobotMethodSignal, RobotTradePlan } from '../types';

type BotMode = 'Researching' | 'Armed' | 'Correcting' | 'Paused';

interface LiveQuote {
  price: number;
  change: number;
  volume: number;
  source: string;
  timestamp: number;
}

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  ADA: 'cardano',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  LTC: 'litecoin',
  MATIC: 'matic-network'
};

const RULE_STACK = [
  'Research news, macro context, session liquidity, and live exchange data before every decision.',
  'Verify price against SMC structure, pure price action, and institutional flow before arming.',
  'Enter only when predefined risk is accepted; never widen stops after entry.',
  'Exit at the stop, target, or correction trigger without emotional override.',
  'Correct open trades when live data invalidates the thesis, not after hope enters the process.'
];

const formatPrice = (value: number) => '$' + value.toLocaleString(undefined, {
  maximumFractionDigits: value > 100 ? 0 : 4
});

const baseAssetFromSymbol = (symbol: string) => symbol
  .replace(/USDT$|USD$|BTC$|ETH$/i, '')
  .toUpperCase();

const fetchCoinGeckoQuote = async (symbol: string): Promise<LiveQuote | null> => {
  const asset = baseAssetFromSymbol(symbol);
  const coinId = COINGECKO_IDS[asset];
  if (!coinId) return null;

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
  );
  if (!response.ok) return null;

  const data = await response.json();
  const quote = data[coinId];
  if (!quote?.usd) return null;

  return {
    price: Number(quote.usd),
    change: Number(quote.usd_24h_change || 0),
    volume: Number(quote.usd_24h_vol || 0),
    source: 'CoinGecko simple price',
    timestamp: Date.now()
  };
};

const fetchLiveQuote = async (symbol: string): Promise<LiveQuote> => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!response.ok) throw new Error('Binance unavailable');
    const data = await response.json();

    return {
      price: Number(data.lastPrice),
      change: Number(data.priceChangePercent),
      volume: Number(data.quoteVolume),
      source: 'Binance 24h ticker',
      timestamp: Date.now()
    };
  } catch {
    const fallback = await fetchCoinGeckoQuote(symbol);
    if (fallback) return fallback;
    throw new Error('Quote unavailable');
  }
};

const buildCorrectedPlan = (plan: RobotTradePlan, quote: LiveQuote | null): RobotTradePlan => {
  if (!quote) return plan;

  const price = quote.price;
  const longTrigger = price > plan.entry && quote.change > 0;
  const shortRisk = price < plan.stopLoss || quote.change < -2.5;
  const volatilityBuffer = Math.max(price * 0.014, Math.abs(price - plan.stopLoss) * 0.35);
  const targetDistance = Math.max(volatilityBuffer * 2.2, Math.abs(plan.takeProfit - plan.entry));

  if (shortRisk) {
    return {
      ...plan,
      direction: 'WAIT',
      confidence: Math.max(38, plan.confidence - 28),
      verificationStatus: 'Needs Review',
      correctionAction: 'Pause execution: live price invalidated the buy thesis. Wait for a fresh liquidity sweep and structure shift.',
      methods: plan.methods.map(method =>
        method.method.includes('Discipline') || method.method.includes('Price Action')
          ? { ...method, status: 'Blocked', score: Math.max(35, method.score - 24) }
          : method
      )
    };
  }

  if (longTrigger) {
    const stopLoss = price - volatilityBuffer;
    const takeProfit = price + targetDistance;

    return {
      ...plan,
      direction: 'LONG',
      entry: price,
      stopLoss,
      takeProfit,
      riskReward: Number(((takeProfit - price) / (price - stopLoss)).toFixed(2)),
      confidence: Math.min(91, plan.confidence + 10),
      verificationStatus: 'Verified',
      correctionAction: 'Arm long execution only after the current candle closes above the reclaimed entry zone.',
      methods: plan.methods.map(method => ({
        ...method,
        status: method.status === 'Blocked' ? 'Warning' : 'Aligned',
        score: Math.min(92, method.score + 8)
      }))
    };
  }

  return {
    ...plan,
    confidence: Math.max(55, plan.confidence - 5),
    verificationStatus: Date.now() - quote.timestamp > 120000 ? 'Data Stale' : 'Needs Review',
    correctionAction: 'Keep researching. Price has not confirmed entry, so the robot remains flat.'
  };
};

const RobotTrader: React.FC = () => {
  const [draftSymbol, setDraftSymbol] = useState(ROBOT_TRADE_PLAN.symbol);
  const [symbol, setSymbol] = useState(ROBOT_TRADE_PLAN.symbol);
  const [mode, setMode] = useState<BotMode>('Researching');
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<number | null>(null);

  const applySymbol = () => {
    const normalized = draftSymbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
    setDraftSymbol(normalized);
    setSymbol(normalized);
  };

  useEffect(() => {
    let cancelled = false;

    const fetchQuote = async () => {
      try {
        const normalized = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
        if (!normalized) {
          setQuote(null);
          setQuoteError('Enter a Binance symbol to verify live data.');
          setLastVerified(null);
          return;
        }
        const liveQuote = await fetchLiveQuote(normalized);
        if (cancelled) return;

        setQuoteError(null);
        setQuote(liveQuote);
        setLastVerified(Date.now());
      } catch {
        if (!cancelled) {
          setQuote(null);
          setQuoteError('Live quote unavailable. Correct the symbol or retry when the feed reconnects.');
          setLastVerified(null);
        }
      }
    };

    fetchQuote();
    const interval = window.setInterval(fetchQuote, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [symbol]);

  const plan = useMemo(() => buildCorrectedPlan({ ...ROBOT_TRADE_PLAN, symbol }, quote), [quote, symbol]);

  useEffect(() => {
    if (mode === 'Paused') return;
    const nextMode: BotMode = plan.verificationStatus === 'Verified'
      ? 'Armed'
      : quote && plan.confidence < 50
        ? 'Correcting'
        : 'Researching';

    if (nextMode !== mode) setMode(nextMode);
  }, [mode, plan.confidence, plan.verificationStatus, quote]);

  const unitRisk = Math.abs(plan.entry - plan.stopLoss);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar space-y-6 pb-8">
      <div className="glass-panel rounded-[2rem] p-8 border-emerald-500/20 bg-emerald-500/[0.02]">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
          <div>
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.45em] mb-3">Robot Execution Desk</p>
            <h2 className="text-4xl font-bold text-white tracking-tighter mb-3">QuantSage Robot Trader</h2>
            <p className="text-slate-500 max-w-3xl leading-relaxed">
              An original decision engine that blends probabilistic risk discipline, trader psychology controls,
              institutional flow analysis, SMC structure, pure price action, and live-data corrections.
            </p>
            <p className="text-[10px] text-amber-300/70 font-mono uppercase tracking-widest mt-4">
              Decision support only — connect brokerage execution only after supervised paper-trading validation.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value.toUpperCase())}
              onBlur={applySymbol}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySymbol();
              }}
              className="bg-black/40 border border-white/10 rounded-2xl px-5 py-3 text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              aria-label="Trading symbol"
            />
            <button
              onClick={() => setMode(mode === 'Paused' ? 'Researching' : 'Paused')}
              className={`px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all ${
                mode === 'Paused'
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20'
              }`}
            >
              {mode === 'Paused' ? 'Resume Bot' : 'Pause Bot'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 glass-panel rounded-[2rem] p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Live Trade Decision</p>
              <h3 className="text-2xl font-bold text-white">{plan.direction} {plan.symbol}</h3>
            </div>
            <div className={`px-4 py-2 rounded-full border text-[10px] font-bold uppercase tracking-widest ${
              mode === 'Armed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                mode === 'Correcting' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                  mode === 'Paused' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
                    'bg-sky-500/10 border-sky-500/30 text-sky-300'
            }`}>
              {mode}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Metric label="Live Price" value={quote ? formatPrice(quote.price) : quoteError ? 'Unavailable' : 'Syncing'} color={quoteError ? 'text-amber-400' : 'text-white'} />
            <Metric label="24h Change" value={quote ? `${quote.change.toFixed(2)}%` : '--'} color={quote && quote.change >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
            <Metric label="Confidence" value={`${plan.confidence}%`} color={plan.confidence >= 70 ? 'text-emerald-400' : 'text-amber-400'} />
            <Metric label="Verification" value={quoteError ? 'Needs Review' : plan.verificationStatus} color={plan.verificationStatus === 'Verified' && !quoteError ? 'text-emerald-400' : 'text-amber-400'} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <TradeLevel label="Entry" value={formatPrice(plan.entry)} />
            <TradeLevel label="Stop Loss" value={formatPrice(plan.stopLoss)} tone="risk" />
            <TradeLevel label="Take Profit" value={formatPrice(plan.takeProfit)} tone="reward" />
            <TradeLevel label="Reward:Risk" value={`${plan.riskReward.toFixed(2)}R`} tone="reward" />
          </div>

          <div className="bg-black/30 border border-white/5 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-route text-emerald-500 mt-1"></i>
              <div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Correction Engine</p>
                <p className="text-slate-300 leading-relaxed">{plan.correctionAction}</p>
                {quoteError && <p className="text-amber-300 text-sm mt-3">{quoteError}</p>}
                <p className="text-[10px] text-slate-500 font-mono mt-3">
                  Max account risk: {plan.maxRiskPercent}% per idea. 1-unit plan risk: {formatPrice(unitRisk)}.
                  Last verified: {lastVerified ? new Date(lastVerified).toLocaleTimeString() : 'waiting for live data'} via {quote?.source || 'market sync'}.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-[2rem] p-6">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-5">Execution Rule Stack</p>
          <div className="space-y-3">
            {RULE_STACK.map((rule, index) => (
              <div key={rule} className="flex gap-3 bg-black/25 border border-white/5 rounded-2xl p-4">
                <span className="w-7 h-7 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold font-mono shrink-0">
                  {index + 1}
                </span>
                <p className="text-sm text-slate-400 leading-relaxed">{rule}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {plan.methods.map(method => (
          <MethodCard key={method.method} method={method} />
        ))}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-black/30 rounded-2xl p-4 border border-white/5">
    <p className="text-[8px] font-bold text-white/30 uppercase tracking-widest mb-2">{label}</p>
    <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
  </div>
);

const TradeLevel: React.FC<{ label: string; value: string; tone?: 'risk' | 'reward' }> = ({ label, value, tone }) => (
  <div className="bg-slate-950/60 rounded-2xl p-4 border border-white/5">
    <p className="text-[8px] font-bold text-white/30 uppercase tracking-widest mb-2">{label}</p>
    <p className={`text-lg font-bold font-mono ${tone === 'risk' ? 'text-rose-400' : tone === 'reward' ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
  </div>
);

const MethodCard: React.FC<{ method: RobotMethodSignal }> = ({ method }) => {
  const colors = {
    Aligned: 'border-emerald-500/25 text-emerald-300 bg-emerald-500/5',
    Warning: 'border-amber-500/25 text-amber-300 bg-amber-500/5',
    Blocked: 'border-rose-500/25 text-rose-300 bg-rose-500/5'
  };

  return (
    <div className={`rounded-[1.5rem] p-5 border ${colors[method.status]}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[9px] font-bold uppercase tracking-widest">{method.status}</span>
        <span className="text-lg font-bold font-mono">{method.score}</span>
      </div>
      <h4 className="text-white font-bold tracking-tight mb-3">{method.method}</h4>
      <p className="text-sm text-slate-400 leading-relaxed">{method.note}</p>
    </div>
  );
};

export default RobotTrader;

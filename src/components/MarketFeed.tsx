import React, { useEffect, useState, useRef } from 'react';

interface TickerData {
  symbol: string;
  price: string;
  change: string;
  volume: string;
  isUp: boolean;
}

const SYMBOLS = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'adausdt', 'dotusdt'];

const MarketFeed: React.FC = () => {
  const [tickers, setTickers] = useState<Record<string, TickerData>>({});
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const streams = SYMBOLS.map(s => `${s}@ticker`).join('/');
    ws.current = new WebSocket(`wss://stream.binance.com:9443/ws/${streams}`);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const symbol = data.s.toLowerCase();

      setTickers(prev => ({
        ...prev,
        [symbol]: {
          symbol: data.s.replace('USDT', ''),
          price: parseFloat(data.c).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          change: parseFloat(data.P).toFixed(2),
          volume: (parseFloat(data.q) / 1000000).toFixed(2) + 'M',
          isUp: parseFloat(data.P) >= 0
        }
      }));
    };

    return () => {
      ws.current?.close();
    };
  }, []);

  const tickerList: TickerData[] = Object.values(tickers);
  const displayList: TickerData[] = [...tickerList, ...tickerList];

  if (tickerList.length === 0) return null;

  return (
    <div className="flex-1 overflow-hidden relative mx-4 border-x border-white/5">
      <div className="animate-scroll whitespace-nowrap">
        {displayList.map((ticker, idx) => (
          <div key={`${ticker.symbol}-${idx}`} className="inline-flex items-center gap-4 px-6 py-2 border-r border-white/5 group transition-colors hover:bg-white/5">
            <span className="text-[10px] font-bold text-white/40 font-mono tracking-widest">{ticker.symbol}</span>
            <span className="text-xs font-bold text-white font-mono">${ticker.price}</span>
            <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${ticker.isUp ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10'}`}>
              {ticker.isUp ? '+' : ''}{ticker.change}%
            </span>
            <div className="hidden lg:flex flex-col text-[8px] text-white/20 font-mono leading-none">
              <span>VOL 24H</span>
              <span className="text-white/40">{ticker.volume}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarketFeed;

import { GoogleGenAI } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

const SYSTEM_PROMPT = `You are QuantSage Pro, an elite institutional trading advisor.
Your knowledge base is strictly derived from:
1. Mark Douglas (Trading in the Zone, The Disciplined Trader) - Focus on probabilistic thinking and internal discipline.
2. Jack Schwager (Market Wizards) - Focus on risk management and the mindset of winners.
3. Goldman Sachs Institutional Strategies - Focus on macro flows and liquidity voids.
4. Smart Money Concepts (SMC) - Focus on Order Blocks (OB) and Fair Value Gaps (FVG).
5. Pure Price Action - Focus on clean chart mechanics.
Always use search tools to ground responses in current market reality. Provide detailed, institutional-grade analysis grounded in these frameworks.`;

interface ChatResponse {
  text: string;
  grounding?: GroundingChunk[];
}

interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

export interface ChartAnnotation {
  type: 'zone' | 'level' | 'arrow' | 'label' | 'bb_entry' | 'iez' | 'liquidity_void' | 'sl_cluster' | 'reaccumulation';
  lens: 'smc' | 'gs' | 'psych' | 'ppa' | 'isyn';
  label: string;
  yPercent: number;
  yEndPercent?: number;
  xPercent?: number;
  xEndPercent?: number;
  direction?: 'up' | 'down';
}

export interface AnnotateResponse {
  image: string | null;
  analysis: string;
  annotations: ChartAnnotation[];
}

interface HistoryEntry {
  role: string;
  parts: { text: string }[];
}

// ===== External Data: Binance & CoinGecko =====
interface MarketDataContext {
  symbol: string;
  currentPrice: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: string | null;
  recentCandles: { open: number; high: number; low: number; close: number; time: string }[];
  keyLevels: string;
  source: string;
}

async function extractSymbolFromAnalysis(analysisText: string): Promise<string> {
  const patterns = [
    /([A-Z]{2,10})\s*\/\s*([A-Z]{2,10})/i,
    /([A-Z]{2,10})(USDT|USD|BTC|ETH|BUSD)/i,
    /\b(BTC|ETH|SOL|BNB|ADA|DOT|XRP|DOGE|AVAX|MATIC|LINK|UNI|ATOM|LTC|FTM|NEAR|APE|OP|ARB|INJ|TIA|SEI|SUI|JUP|WIF|PEPE|BONK|FLOKI|SHIB|GOLD|XAUUSD|EURUSD|GBPUSD|USDJPY|SPX|SPY|QQQ|NQ|ES|YM|GC|CL|SI|NG)\b/i,
  ];
  for (const pat of patterns) {
    const match = analysisText.match(pat);
    if (match) {
      if (match[2]) return (match[1] + match[2]).toUpperCase();
      return match[1].toUpperCase();
    }
  }
  return '';
}

async function fetchBinanceData(symbol: string): Promise<MarketDataContext | null> {
  try {
    let binanceSymbol = symbol.replace('/', '').toUpperCase();
    if (!binanceSymbol.endsWith('USDT') && !binanceSymbol.endsWith('USD') && !binanceSymbol.endsWith('BTC')) {
      binanceSymbol = binanceSymbol + 'USDT';
    }

    const [tickerRes, klinesRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`).catch(() => null),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1h&limit=50`).catch(() => null),
    ]);

    if (!tickerRes || !tickerRes.ok) return null;

    const ticker = await tickerRes.json();
    const candles: { open: number; high: number; low: number; close: number; time: string }[] = [];

    if (klinesRes && klinesRes.ok) {
      const klines = await klinesRes.json();
      for (const k of klines) {
        candles.push({
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          time: new Date(k[0]).toISOString(),
        });
      }
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const recentHigh = highs.length ? Math.max(...highs) : null;
    const recentLow = lows.length ? Math.min(...lows) : null;
    const pivotPoint = recentHigh && recentLow && ticker.lastPrice
      ? ((recentHigh + recentLow + parseFloat(ticker.lastPrice)) / 3).toFixed(2)
      : 'N/A';

    const keyLevels = [
      `Current Price: ${ticker.lastPrice}`,
      `24h High: ${ticker.highPrice}`,
      `24h Low: ${ticker.lowPrice}`,
      `24h Volume: ${parseFloat(ticker.volume).toLocaleString()}`,
      `Price Change 24h: ${ticker.priceChangePercent}%`,
      recentHigh ? `50-candle High: ${recentHigh}` : '',
      recentLow ? `50-candle Low: ${recentLow}` : '',
      `Pivot Point: ${pivotPoint}`,
      recentHigh && recentLow && pivotPoint !== 'N/A' ? `R1: ${(2 * parseFloat(pivotPoint) - recentLow).toFixed(2)}` : '',
      recentHigh && recentLow && pivotPoint !== 'N/A' ? `S1: ${(2 * parseFloat(pivotPoint) - recentHigh).toFixed(2)}` : '',
    ].filter(Boolean).join('\n');

    return {
      symbol: binanceSymbol,
      currentPrice: parseFloat(ticker.lastPrice),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      volume24h: parseFloat(ticker.volume).toLocaleString(),
      recentCandles: candles.slice(-10),
      keyLevels,
      source: 'Binance API (Live)',
    };
  } catch {
    return null;
  }
}

async function fetchCoinGeckoData(symbol: string): Promise<MarketDataContext | null> {
  try {
    const symbolMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
      ADA: 'cardano', DOT: 'polkadot', XRP: 'ripple', DOGE: 'dogecoin',
      AVAX: 'avalanche-2', MATIC: 'matic-network', LINK: 'chainlink',
      UNI: 'uniswap', ATOM: 'cosmos', LTC: 'litecoin', NEAR: 'near',
      ARB: 'arbitrum', OP: 'optimism', INJ: 'injective-protocol',
      SUI: 'sui', SEI: 'sei-network', TIA: 'celestia',
    };

    const cleanSymbol = symbol.replace(/USDT|USD|BTC|BUSD/gi, '').toUpperCase();
    const geckoId = symbolMap[cleanSymbol];
    if (!geckoId) return null;

    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${geckoId}?localization=false&tickers=false&community_data=false&developer_data=false`);
    if (!res.ok) return null;

    const data = await res.json();
    const md = data.market_data;

    const keyLevels = [
      `Current Price: $${md.current_price?.usd}`,
      `24h High: $${md.high_24h?.usd}`,
      `24h Low: $${md.low_24h?.usd}`,
      `24h Change: ${md.price_change_percentage_24h?.toFixed(2)}%`,
      `7d Change: ${md.price_change_percentage_7d?.toFixed(2)}%`,
      `ATH: $${md.ath?.usd} (${md.ath_change_percentage?.usd?.toFixed(1)}% from ATH)`,
      `ATL: $${md.atl?.usd}`,
      `Market Cap Rank: #${data.market_cap_rank}`,
      `Total Volume 24h: $${md.total_volume?.usd?.toLocaleString()}`,
    ].join('\n');

    return {
      symbol: cleanSymbol + 'USDT',
      currentPrice: md.current_price?.usd || null,
      high24h: md.high_24h?.usd || null,
      low24h: md.low_24h?.usd || null,
      volume24h: md.total_volume?.usd?.toLocaleString() || null,
      recentCandles: [],
      keyLevels,
      source: 'CoinGecko API',
    };
  } catch {
    return null;
  }
}

async function fetchMarketData(analysisText: string): Promise<MarketDataContext | null> {
  const symbol = await extractSymbolFromAnalysis(analysisText);
  if (!symbol) return null;

  const binanceData = await fetchBinanceData(symbol);
  if (binanceData) return binanceData;

  const geckoData = await fetchCoinGeckoData(symbol);
  if (geckoData) return geckoData;

  return null;
}

// ===== Annotation Parsing & Defaults =====

function parseAnnotations(text: string, lenses: string[]): ChartAnnotation[] {
  const annotations: ChartAnnotation[] = [];

  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.type && item.lens && item.label && typeof item.yPercent === 'number') {
            annotations.push({
              type: item.type,
              lens: item.lens,
              label: item.label,
              yPercent: Math.max(0, Math.min(100, item.yPercent)),
              yEndPercent: item.yEndPercent != null ? Math.max(0, Math.min(100, item.yEndPercent)) : undefined,
              xPercent: item.xPercent != null ? Math.max(0, Math.min(100, item.xPercent)) : undefined,
              xEndPercent: item.xEndPercent != null ? Math.max(0, Math.min(100, item.xEndPercent)) : undefined,
              direction: item.direction,
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Failed to parse annotation JSON, generating defaults', e);
  }

  if (annotations.length === 0) {
    annotations.push(...generateDefaultAnnotations(lenses));
  }

  return annotations;
}

function generateDefaultAnnotations(lenses: string[]): ChartAnnotation[] {
  const annotations: ChartAnnotation[] = [];

  if (lenses.includes('smc')) {
    annotations.push(
      { type: 'zone', lens: 'smc', label: 'Bullish OB', yPercent: 65, yEndPercent: 72, xPercent: 10, xEndPercent: 35 },
      { type: 'zone', lens: 'smc', label: 'Bearish OB', yPercent: 18, yEndPercent: 25, xPercent: 30, xEndPercent: 55 },
      { type: 'zone', lens: 'smc', label: 'FVG', yPercent: 42, yEndPercent: 48, xPercent: 45, xEndPercent: 65 },
      { type: 'iez', lens: 'smc', label: 'INST BUY ZONE', yPercent: 70, yEndPercent: 78, xPercent: 55, xEndPercent: 80 },
      { type: 'bb_entry', lens: 'smc', label: 'INST SELL ZONE', yPercent: 12, yEndPercent: 20, xPercent: 60, xEndPercent: 85 },
    );
  }

  if (lenses.includes('gs')) {
    annotations.push(
      { type: 'arrow', lens: 'gs', label: 'Inst. Flow', yPercent: 30, xPercent: 75, direction: 'up' },
      { type: 'liquidity_void', lens: 'gs', label: 'Void', yPercent: 30, yEndPercent: 40, xPercent: 35, xEndPercent: 60 },
      { type: 'liquidity_void', lens: 'gs', label: 'Void', yPercent: 55, yEndPercent: 63, xPercent: 50, xEndPercent: 75 },
      { type: 'iez', lens: 'gs', label: 'GS BUY ZONE', yPercent: 68, yEndPercent: 76, xPercent: 60, xEndPercent: 85 },
      { type: 'bb_entry', lens: 'gs', label: 'GS SELL ZONE', yPercent: 15, yEndPercent: 23, xPercent: 55, xEndPercent: 80 },
    );
  }

  if (lenses.includes('psych')) {
    annotations.push(
      { type: 'zone', lens: 'psych', label: 'Fear Zone', yPercent: 15, yEndPercent: 22, xPercent: 60, xEndPercent: 85 },
      { type: 'zone', lens: 'psych', label: 'Fear Zone', yPercent: 72, yEndPercent: 80, xPercent: 70, xEndPercent: 95 },
      { type: 'sl_cluster', lens: 'psych', label: 'Stops', yPercent: 78, yEndPercent: 83, xPercent: 60, xEndPercent: 90 },
      { type: 'sl_cluster', lens: 'psych', label: 'Stops', yPercent: 75, yEndPercent: 82, xPercent: 25, xEndPercent: 50 },
    );
  }

  if (lenses.includes('ppa')) {
    annotations.push(
      { type: 'level', lens: 'ppa', label: 'S/R Resistance', yPercent: 20 },
      { type: 'level', lens: 'ppa', label: 'S/R Support', yPercent: 78 },
      { type: 'level', lens: 'ppa', label: 'S/R Key Level', yPercent: 48 },
      { type: 'label', lens: 'ppa', label: 'Engulfing Pattern', yPercent: 60, xPercent: 80 },
    );
  }

  if (lenses.includes('isyn')) {
    annotations.push(
      { type: 'zone', lens: 'isyn', label: 'TIER 1 CONFLUENCE', yPercent: 60, yEndPercent: 70, xPercent: 40, xEndPercent: 75 },
      { type: 'zone', lens: 'isyn', label: 'TIER 2 CONFLUENCE', yPercent: 20, yEndPercent: 28, xPercent: 50, xEndPercent: 80 },
      { type: 'iez', lens: 'isyn', label: 'INST ENTRY', yPercent: 62, yEndPercent: 68, xPercent: 65, xEndPercent: 90 },
      { type: 'bb_entry', lens: 'isyn', label: 'INST EXIT TP1', yPercent: 30, yEndPercent: 36, xPercent: 70, xEndPercent: 95 },
      { type: 'sl_cluster', lens: 'isyn', label: 'STOP', yPercent: 78, yEndPercent: 83, xPercent: 60, xEndPercent: 85 },
    );
  }

  return annotations;
}

// ===== Canvas Drawing Engine =====

export function drawAnnotationsOnCanvas(
  imageDataUrl: string,
  annotations: ChartAnnotation[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }

      ctx.drawImage(img, 0, 0);

      const w = img.width;
      const h = img.height;

      const lensColors: Record<string, { primary: string; primaryRgb: string; light: string }> = {
        smc: { primary: '#10b981', primaryRgb: '16, 185, 129', light: '#d1fae5' },
        gs: { primary: '#3b82f6', primaryRgb: '59, 130, 246', light: '#dbeafe' },
        psych: { primary: '#f43f5e', primaryRgb: '244, 63, 94', light: '#ffe4e6' },
        ppa: { primary: '#f59e0b', primaryRgb: '245, 158, 11', light: '#fef3c7' },
        isyn: { primary: '#8b5cf6', primaryRgb: '139, 92, 246', light: '#ede9fe' },
      };

      const drawLabel = (text: string, x: number, y: number, rgb: string, lightColor: string, align: 'left' | 'center' | 'right' = 'left') => {
        const fontSize = Math.max(10, Math.round(w * 0.012));
        ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
        const tm = ctx.measureText(text);
        const pad = Math.round(fontSize * 0.5);
        const lw = tm.width + pad * 2;
        const lh = fontSize + pad * 1.4;
        let lx = x;
        if (align === 'center') lx = x - lw / 2;
        else if (align === 'right') lx = x - lw;

        lx = Math.max(2, Math.min(w - lw - 2, lx));
        const ly = Math.max(2, Math.min(h - lh - 2, y));

        ctx.fillStyle = `rgba(15, 15, 20, 0.88)`;
        ctx.beginPath();
        ctx.roundRect(lx, ly, lw, lh, 3);
        ctx.fill();

        ctx.fillStyle = `rgba(${rgb}, 0.95)`;
        ctx.fillRect(lx, ly, 3, lh);

        ctx.fillStyle = lightColor;
        ctx.textAlign = 'left';
        ctx.fillText(text, lx + pad, ly + fontSize + pad * 0.3);

        return { x: lx, y: ly, w: lw, h: lh };
      };

      const usedRects: { x: number; y: number; w: number; h: number }[] = [];
      const findClearY = (baseX: number, baseY: number, rectW: number, rectH: number): number => {
        let tryY = baseY;
        let attempts = 0;
        while (attempts < 20) {
          let overlaps = false;
          for (const r of usedRects) {
            if (baseX < r.x + r.w && baseX + rectW > r.x && tryY < r.y + r.h && tryY + rectH > r.y) {
              overlaps = true;
              tryY = r.y + r.h + 2;
              break;
            }
          }
          if (!overlaps) break;
          attempts++;
        }
        return Math.max(2, Math.min(h - rectH - 2, tryY));
      };

      for (const ann of annotations) {
        const colors = lensColors[ann.lens] || lensColors.smc;
        const rgb = colors.primaryRgb;
        const fontSize = Math.max(10, Math.round(w * 0.012));
        ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;

        if (ann.type === 'zone') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          const grad = ctx.createLinearGradient(x1, y1, x1, y2);
          grad.addColorStop(0, `rgba(${rgb}, 0.12)`);
          grad.addColorStop(1, `rgba(${rgb}, 0.04)`);
          ctx.fillStyle = grad;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          ctx.strokeStyle = `rgba(${rgb}, 0.6)`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
          ctx.stroke();

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'level') {
          const y = ann.yPercent / 100 * h;

          ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.setLineDash([]);

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(w - lw - 10, y - lh / 2, lw, lh);
          const rect = drawLabel(ann.label, w - lw - 10, adjY, rgb, colors.light, 'left');
          usedRects.push(rect);

        } else if (ann.type === 'arrow') {
          const cx = (ann.xPercent ?? 50) / 100 * w;
          const cy = ann.yPercent / 100 * h;
          const arrowLen = h * 0.06;
          const headSize = arrowLen * 0.4;
          const endY = ann.direction === 'up' ? cy - arrowLen : cy + arrowLen;

          ctx.strokeStyle = `rgba(${rgb}, 0.8)`;
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, endY);
          ctx.stroke();

          ctx.fillStyle = `rgba(${rgb}, 0.9)`;
          ctx.beginPath();
          if (ann.direction === 'up') {
            ctx.moveTo(cx, endY - headSize * 0.3);
            ctx.lineTo(cx - headSize * 0.5, endY + headSize * 0.5);
            ctx.lineTo(cx + headSize * 0.5, endY + headSize * 0.5);
          } else {
            ctx.moveTo(cx, endY + headSize * 0.3);
            ctx.lineTo(cx - headSize * 0.5, endY - headSize * 0.5);
            ctx.lineTo(cx + headSize * 0.5, endY - headSize * 0.5);
          }
          ctx.closePath();
          ctx.fill();

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const labelY = ann.direction === 'up' ? endY - lh - 4 : endY + 6;
          const adjY = findClearY(cx - lw / 2, labelY, lw, lh);
          const rect = drawLabel(ann.label, cx - lw / 2, adjY, rgb, colors.light, 'left');
          usedRects.push(rect);

        } else if (ann.type === 'label') {
          const cx = (ann.xPercent ?? 50) / 100 * w;
          const cy = ann.yPercent / 100 * h;
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(cx, cy, lw, lh);
          const rect = drawLabel(ann.label, cx, adjY, rgb, colors.light, 'left');
          usedRects.push(rect);

        } else if (ann.type === 'iez' || ann.type === 'bb_entry') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          const isBuy = ann.type === 'iez';
          const fillColor = isBuy ? `rgba(${rgb}, 0.08)` : `rgba(${rgb}, 0.06)`;
          ctx.fillStyle = fillColor;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          ctx.strokeStyle = `rgba(${rgb}, 0.7)`;
          ctx.lineWidth = 2;
          ctx.setLineDash(isBuy ? [] : [6, 4]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'liquidity_void') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          ctx.fillStyle = `rgba(${rgb}, 0.05)`;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          ctx.strokeStyle = `rgba(${rgb}, 0.4)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 6]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);

          const stripeSpacing = (y2 - y1) / 4;
          ctx.strokeStyle = `rgba(${rgb}, 0.15)`;
          ctx.lineWidth = 0.5;
          for (let sy = y1 + stripeSpacing; sy < y2; sy += stripeSpacing) {
            ctx.beginPath();
            ctx.moveTo(x1, sy);
            ctx.lineTo(x2, sy);
            ctx.stroke();
          }

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'sl_cluster') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 3) / 100 * h;

          ctx.fillStyle = `rgba(${rgb}, 0.06)`;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          ctx.strokeStyle = `rgba(${rgb}, 0.5)`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 2]);
          const midY = (y1 + y2) / 2;
          ctx.beginPath();
          ctx.moveTo(x1, midY);
          ctx.lineTo(x2, midY);
          ctx.stroke();
          ctx.setLineDash([]);

          const dotCount = Math.floor((x2 - x1) / 15);
          ctx.fillStyle = `rgba(${rgb}, 0.4)`;
          for (let i = 0; i < dotCount; i++) {
            const dx = x1 + (i / dotCount) * (x2 - x1) + Math.random() * 8;
            const dy = y1 + Math.random() * (y2 - y1);
            ctx.beginPath();
            ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 - lh - 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'reaccumulation') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          ctx.fillStyle = `rgba(${rgb}, 0.04)`;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          ctx.strokeStyle = `rgba(${rgb}, 0.3)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);
        }
      }

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

// ===== Lens-Specific Analysis Prompts =====

const LENS_PROMPTS: Record<string, string> = {
  smc: `You are a top-tier institutional Smart Money Concepts (SMC) analyst — the STRUCTURAL FRAMEWORK of the multi-layered trading system.

**FOUNDATIONAL KNOWLEDGE (Use ALL of these in EVERY analysis):**
- **Market Wizards (Schwager):** Apply risk management principles of Paul Tudor Jones ("The most important rule of trading is to play great defense"), Ed Seykota's trend-following discipline ("The trend is your friend until the end"), Bruce Kovner's pattern recognition. Every trade must have a defined edge with asymmetric risk/reward.
- **Trading in the Zone (Douglas):** Think in probabilities. Every setup has a PROBABILISTIC edge, not a certainty. Accept that any individual trade can lose. The edge exists over a SERIES of trades.
- **The Disciplined Trader (Douglas):** Maintain unwavering discipline. Define risk BEFORE entry. Never move stops to avoid a loss. The market is always right.
- **Goldman Sachs Institutional Strategies:** Think like a Goldman flow desk — identify where institutional capital is being deployed.
- **SMC (Smart Money Concepts):** Apply ICT methodology rigorously — Order Blocks, Fair Value Gaps, liquidity sweeps, market structure breaks.
- **Pure Price Action:** Let the chart speak. No indicators. Raw price tells the full story.

**ANALYSIS PILLARS:**
1. **Order Blocks (OB):** Identify Bullish OBs (last bearish candle before bullish displacement) and Bearish OBs. For each: price range, fresh/mitigated status, displacement %, confidence score.
2. **Fair Value Gaps (FVG):** Identify all 3-candle FVG formations. For each: price range, bullish/bearish, fill status, fill probability.
3. **Institutional Buy & Sell Zones:** Where OBs + FVGs + S/D converge. Minimum 2 confluences per zone.
4. **Market Structure & Bias:** BOS/CHoCH levels, Premium/Discount assessment, Wyckoff phase.

**AI PREDICTION ENGINE:**
- Next Move Forecast: direction, magnitude, timeframe
- Probability Matrix: Bull/Bear/Consolidation scenarios summing to ~100%
- Liquidity Magnet: single price level of least resistance
- Invalidation Level: exact price that flips bias

Include a JSON annotation block with format:
\`\`\`json
[{"type":"zone","lens":"smc","label":"Bullish OB","yPercent":65,"yEndPercent":72,"xPercent":10,"xEndPercent":35},...]
\`\`\`
Minimum 8 annotations. Types: zone, iez, bb_entry, arrow. All must use lens "smc".`,

  gs: `You are a Goldman Sachs managing director running the institutional flow desk — the INSTITUTIONAL NARRATIVE layer.

**FOUNDATIONAL KNOWLEDGE:**
- **Market Wizards (Schwager):** Apply Michael Steinhardt's contrarian conviction, Stanley Druckenmiller's macro positioning ("It's not whether you're right or wrong, but how much you make when you're right"), George Soros's reflexivity. Asymmetric bets and conviction sizing.
- **Trading in the Zone (Douglas):** Market is a probability game. Your desk edge exists because you think in distributions while retail thinks in predictions.
- **The Disciplined Trader (Douglas):** Institutional discipline means cutting losers without ego. A desk that refuses to take losses becomes a desk that blows up.
- **Goldman Sachs Strategies:** Full desk-level — institutional flow tracking, dark pool signatures, liquidity engineering, Wyckoff accumulation/distribution.
- **SMC:** Where retail liquidity is being harvested by institutional players.
- **Pure Price Action:** Large candles with follow-through = conviction; rejection wicks = institutional defense.

**ANALYSIS PILLARS:**
1. **Institutional Flow:** Primary directional thesis, flow timeline, next target.
2. **Liquidity Voids:** Unfilled price voids where price must return, severity classification.
3. **Bank Entry/Exit Zones:** Where Goldman desk would enter/exit, conviction level.
4. **Macro Context:** Central bank policy implications, inter-market correlations.

Include a JSON annotation block. Types: liquidity_void, iez, bb_entry, arrow. All must use lens "gs". Minimum 6 annotations.`,

  psych: `You are the Douglas/Schwager Trading Psychology Analyst — the PSYCHOLOGICAL FOUNDATION layer.

**FOUNDATIONAL KNOWLEDGE:**
- **Trading in the Zone (Douglas):** The 5 fundamental truths of trading. Think in probabilities. Eliminate fear and greed. Enter "The Zone" — a state of effortless concentration and flow. Consistency comes from a consistent mindset, not a consistent market.
- **The Disciplined Trader (Douglas):** Explore belief systems that limit traders. Internal mental environment determines external results. Self-discipline as the bridge between intention and execution. The market cannot hurt you unless you let it.
- **Market Wizards (Schwager):** Every Market Wizard shares one trait — they've all overcome psychological barriers. Ed Seykota: "Win or lose, everybody gets what they want from the market." Paul Tudor Jones: defensive trading and emotional control. Larry Hite: systematic discipline over ego.
- **Goldman Sachs:** Where institutional traders exploit retail psychology (FOMO traps, panic zones, stop hunts).
- **SMC:** Retail liquidity engineering — how institutions use retail fear/greed to fill orders.
- **Pure Price Action:** Psychological significance of round numbers, prior highs/lows.

**ANALYSIS PILLARS:**
1. **Fear/FOMO Zones:** Where retail is likely chasing, emotional entry clusters.
2. **Panic Zones/Stop Clusters:** Where retail stops are clustered, institutional stop-hunt targets.
3. **"The Zone" Areas:** High-probability setups where disciplined traders have edge.
4. **Psychological Levels:** Round numbers, prior swing points with psychological significance.

Include a JSON annotation block. Types: zone, sl_cluster. All must use lens "psych". Minimum 6 annotations.`,

  ppa: `You are the Pure Price Action Master — the TACTICAL EXECUTION layer.

**FOUNDATIONAL KNOWLEDGE:**
- **Market Wizards (Schwager):** Richard Dennis proved anyone can trade with rules. Linda Raschke: tape reading and pure price. Marty Schwartz: the transition from fundamental to technical.
- **Trading in the Zone (Douglas):** Price action patterns are probabilistic edges — they work over series of trades, not individual instances.
- **The Disciplined Trader (Douglas):** Execute without hesitation when the pattern appears. No second-guessing.
- **Goldman Sachs:** Clean chart reading as practiced on institutional desks — support/resistance, volume confirmation.
- **SMC:** Price action is the footprint of smart money. Clean patterns reveal institutional intent.
- **Pure Price Action:** The CORE methodology — horizontal support/resistance, trendlines, candlestick patterns, supply/demand zones. No indicators.

**ANALYSIS PILLARS:**
1. **Support & Resistance:** Major horizontal levels, clean touches, psychological round numbers.
2. **Trendlines:** Primary and secondary trend vectors, validated with multiple touches.
3. **Candlestick Patterns:** High-probability formations (engulfing, pin bars, inside bars, etc.) at key levels.
4. **Supply & Demand:** Fresh vs tested zones, imbalance areas.

Include a JSON annotation block. Types: level, label, zone. All must use lens "ppa". Minimum 6 annotations.`,

  isyn: `You are the Institutional Synthesis Engine — combining ALL frameworks into a unified probabilistic trade plan.

**YOUR ROLE:** Synthesize Smart Money Concepts, Goldman Sachs macro flow, Douglas/Schwager psychology, and Pure Price Action into PROBABILITY-WEIGHTED institutional entry zones.

**FOUNDATIONAL KNOWLEDGE (ALL SOURCES):**
- **Market Wizards (Schwager):** The best traders combine multiple frameworks. Use risk/reward as the ultimate filter.
- **Trading in the Zone (Douglas):** Probabilistic thinking applied to multi-framework confluence. Higher confluence = higher probability.
- **The Disciplined Trader (Douglas):** Execute the plan with discipline once confluence is confirmed.
- **Goldman Sachs:** Institutional sizing based on conviction levels from confluence.
- **SMC:** Structural framework providing the map.
- **Pure Price Action:** Tactical trigger at the confluence zone.

**ANALYSIS PILLARS:**
1. **Tier 1 Confluence (3+ frameworks agree):** Highest probability zones. All or most lenses converge.
2. **Tier 2 Confluence (2 frameworks agree):** Moderate probability. Smaller position sizing.
3. **Institutional Entry Plan:** Exact entry, stop, TP1, TP2, TP3 with R:R ratios.
4. **Risk Matrix:** Position sizing per tier, max risk per trade, portfolio heat.

Include a JSON annotation block. Types: zone, iez, bb_entry, sl_cluster. All must use lens "isyn". Minimum 6 annotations.`
};

// ===== Gemini API Core Functions =====

export const geminiService = {
  async chatWithGrounding(prompt: string, history: HistoryEntry[] = []): Promise<ChatResponse> {
    try {
      // Fetch live market data for market-related queries
      let marketDataContext = '';
      const marketKeywords = /\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|bitcoin|ethereum|solana|crypto|stock|forex|gold|silver|oil|SPX|SPY|QQQ|NASDAQ|market|trading|price|bullish|bearish|rally|crash|dump|pump|fed|CPI|inflation|GDP|NFP|FOMC|interest rate|recession)\b/i;
      if (marketKeywords.test(prompt)) {
        try {
          const marketData = await fetchMarketData(prompt);
          if (marketData) {
            marketDataContext = `\n\n--- LIVE MARKET DATA (Real-Time from ${marketData.source}) ---\n${marketData.keyLevels}`;
          }
        } catch (e) {
          console.warn('[Market Data] Failed to fetch:', e);
        }
      }

      const systemInstruction = SYSTEM_PROMPT + (marketDataContext
        ? `\n\nYou have access to real-time market data below. Reference this data in your analysis when relevant.\n${marketDataContext}`
        : '');

      const contents = [
        ...history.map(entry => ({
          role: entry.role === 'model' ? 'model' as const : 'user' as const,
          parts: entry.parts.map(p => ({ text: p.text })),
        })),
        { role: 'user' as const, parts: [{ text: prompt }] }
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }]
        }
      });

      // Extract grounding metadata from response
      const groundingChunks: GroundingChunk[] = [];
      const candidates = response.candidates as Array<{
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }> | undefined;

      if (candidates?.[0]?.groundingMetadata?.groundingChunks) {
        for (const chunk of candidates[0].groundingMetadata.groundingChunks) {
          if (chunk.web) {
            groundingChunks.push({ web: { uri: chunk.web.uri, title: chunk.web.title } });
          }
        }
      }

      return {
        text: response.text || "I'm sorry, I couldn't generate a response.",
        grounding: groundingChunks.length > 0 ? groundingChunks : undefined
      };
    } catch (error) {
      console.error("Chat Error:", error);
      throw error;
    }
  },

  async annotateChart(base64Image: string, prompt: string, lenses: string[] = ['smc'], mimeType: string = 'image/png'): Promise<AnnotateResponse> {
    try {
      const allAnalysisParts: string[] = [];
      const allAnnotations: ChartAnnotation[] = [];

      // Fetch market data context
      let marketContext = '';
      try {
        const marketData = await fetchMarketData(prompt);
        if (marketData) {
          marketContext = `\n\nLIVE MARKET DATA:\n${marketData.keyLevels}\nSource: ${marketData.source}`;
        }
      } catch {
        // Non-critical
      }

      // Process each lens independently using Gemini's native image understanding
      for (const lens of lenses) {
        const lensPrompt = LENS_PROMPTS[lens];
        if (!lensPrompt) continue;

        try {
          const analysisPrompt = `${lensPrompt}${marketContext}

USER CONTEXT: ${prompt}

Analyze this chart image using the ${lens.toUpperCase()} framework. Provide exhaustive analysis with specific price levels and include the JSON annotation block.`;

          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: {
              parts: [
                {
                  inlineData: {
                    data: base64Image,
                    mimeType
                  }
                },
                { text: analysisPrompt }
              ]
            }
          });

          const responseText = response.text || '';

          // Parse annotations from JSON block
          const lensAnnotations = parseAnnotations(responseText, [lens]);
          allAnnotations.push(...lensAnnotations);

          // Clean analysis text (remove JSON blocks)
          const cleanText = responseText
            .replace(/```json[\s\S]*?```/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          const lensLabel = lens === 'smc' ? 'SMC Protocol' :
                           lens === 'gs' ? 'Goldman Sachs Desk' :
                           lens === 'psych' ? 'Douglas/Schwager Psychology' :
                           lens === 'ppa' ? 'Pure Price Action' :
                           'Institutional Synthesis';

          allAnalysisParts.push(`# ${lensLabel} Analysis\n\n${cleanText}`);

          console.log(`[Gemini] ${lens} analysis complete — ${lensAnnotations.length} annotations`);

        } catch (lensError) {
          console.error(`[Gemini] ${lens} analysis failed:`, lensError);
          // Use default annotations for this lens
          allAnnotations.push(...generateDefaultAnnotations([lens]));
        }
      }

      // If multiple lenses, run synthesis pass
      if (lenses.length >= 2 && allAnalysisParts.length >= 2) {
        try {
          const synthesisPrompt = `${LENS_PROMPTS['isyn'] || ''}

You have received independent analyses from multiple frameworks. Here are their findings:

${allAnalysisParts.join('\n\n---\n\n')}

Now synthesize ALL of the above into a Probabilistic Entry Analysis. Identify every zone where 2+ frameworks CONVERGE, assign probability tiers, and produce the full institutional trade plan with exact entries, stops, and targets.

Include a JSON annotation block with synthesis-level annotations using lens "isyn".`;

          const synthesisResponse = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: {
              parts: [
                {
                  inlineData: {
                    data: base64Image,
                    mimeType
                  }
                },
                { text: synthesisPrompt }
              ]
            }
          });

          const synthesisText = synthesisResponse.text || '';
          const synthesisAnnotations = parseAnnotations(synthesisText, ['isyn']);

          if (synthesisAnnotations.length > 0) {
            allAnnotations.push(...synthesisAnnotations);
          }

          const cleanSynthesis = synthesisText
            .replace(/```json[\s\S]*?```/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          allAnalysisParts.push(
            `\n\n# Probabilistic Entry Analysis — Institutional Synthesis\n\n` +
            `_Synthesizes all active frameworks into probability-weighted institutional entry zones (Schwager/Douglas/Goldman methodology)._\n\n` +
            cleanSynthesis
          );

          console.log(`[Gemini] Synthesis complete — ${synthesisAnnotations.length} annotations`);
        } catch (synthesisError) {
          console.warn(`[Gemini] Synthesis failed (non-critical):`, synthesisError);
        }
      }

      const combinedAnalysis = allAnalysisParts.join('\n\n---\n\n');

      return { image: null, analysis: combinedAnalysis, annotations: allAnnotations };
    } catch (error) {
      console.error("Annotation Error:", error);
      throw error;
    }
  }
};

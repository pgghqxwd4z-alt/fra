const GROQ_PROXY_URL = import.meta.env.VITE_GROQ_PROXY_URL?.trim() || '';
const GROQ_API_URL = GROQ_PROXY_URL ? `${GROQ_PROXY_URL.replace(/\/+$/, '')}/api/groq/chat/completions` : '';
const BINANCE_REST_URL = 'https://data-api.binance.vision/api/v3';

function getGroqHeaders(): Record<string, string> {
  if (!GROQ_API_URL) {
    throw new Error('Missing Groq proxy configuration. Set VITE_GROQ_PROXY_URL.');
  }

  return {
    'Content-Type': 'application/json',
  };
}

const SYSTEM_PROMPT = `You are QuantSage Pro, an elite institutional trading advisor.
Your knowledge base is strictly derived from:
1. Mark Douglas (Trading in the Zone, The Disciplined Trader) - Focus on probabilistic thinking and internal discipline.
2. Jack Schwager (Market Wizards) - Focus on risk management and the mindset of winners.
3. Goldman Sachs Institutional Strategies - Focus on macro flows and liquidity voids.
4. Smart Money Concepts (SMC) - Focus on Order Blocks (OB) and Fair Value Gaps (FVG).
5. Pure Price Action - Focus on clean chart mechanics.
Provide detailed, institutional-grade analysis grounded in these frameworks.`;

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

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | GroqContentPart[];
}

interface GroqContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

// ===== External Data Search Functions =====
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
  // Try to extract the trading symbol from the analysis text
  const patterns = [
    /([A-Z]{2,10})\s*\/\s*([A-Z]{2,10})/i, // BTC/USDT, EUR/USD
    /([A-Z]{2,10})(USDT|USD|BTC|ETH|BUSD)/i, // BTCUSDT, ETHBTC
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
    // Normalize symbol for Binance
    let binanceSymbol = symbol.replace('/', '').toUpperCase();
    if (!binanceSymbol.endsWith('USDT') && !binanceSymbol.endsWith('USD') && !binanceSymbol.endsWith('BTC')) {
      binanceSymbol = binanceSymbol + 'USDT';
    }

    // Fetch ticker + recent klines in parallel
    const [tickerRes, klinesRes] = await Promise.all([
      fetch(`${BINANCE_REST_URL}/ticker/24hr?symbol=${binanceSymbol}`).catch(() => null),
      fetch(`${BINANCE_REST_URL}/klines?symbol=${binanceSymbol}&interval=1h&limit=50`).catch(() => null),
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

    // Calculate key levels from recent candles
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const recentHigh = highs.length ? Math.max(...highs) : null;
    const recentLow = lows.length ? Math.min(...lows) : null;
    const lastPrice = Number(ticker.lastPrice);
    const hasPivotInputs = recentHigh !== null && recentLow !== null && Number.isFinite(lastPrice);
    const pivotValue = hasPivotInputs ? (recentHigh + recentLow + lastPrice) / 3 : null;
    const pivotPoint = pivotValue !== null
      ? pivotValue.toFixed(2)
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
      pivotValue !== null && recentLow !== null ? `R1: ${(2 * pivotValue - recentLow).toFixed(2)}` : '',
      pivotValue !== null && recentHigh !== null ? `S1: ${(2 * pivotValue - recentHigh).toFixed(2)}` : '',
    ].filter(Boolean).join('\n');

    return {
      symbol: binanceSymbol,
      currentPrice: Number.isFinite(lastPrice) ? lastPrice : null,
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      volume24h: parseFloat(ticker.volume).toLocaleString(),
      recentCandles: candles.slice(-10), // Last 10 candles for validation
      keyLevels,
      source: 'Binance Market Data API (Live)',
    };
  } catch {
    return null;
  }
}

async function fetchCoinGeckoData(symbol: string): Promise<MarketDataContext | null> {
  try {
    // Map common symbols to CoinGecko IDs
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

  // Try Binance first (faster, has candle data), then CoinGecko as fallback
  const binanceData = await fetchBinanceData(symbol);
  if (binanceData) return binanceData;

  const geckoData = await fetchCoinGeckoData(symbol);
  if (geckoData) return geckoData;

  return null;
}

function buildMarketDataSection(marketData: MarketDataContext | null): string {
  return marketData
    ? `\n\n**EXTERNAL MARKET DATA (Live from ${marketData.source}):**
Symbol: ${marketData.symbol}
${marketData.keyLevels}
${marketData.recentCandles.length > 0 ? `\nRecent Candle Data (last ${marketData.recentCandles.length} candles):\n${marketData.recentCandles.slice(-5).map(c => `  ${c.time}: O=${c.open} H=${c.high} L=${c.low} C=${c.close}`).join('\n')}` : ''}

**USE THIS DATA TO:**
- Cross-reference price levels in the analysis against real market data.
- Verify current price context and premium/discount assessment.
- Check key round numbers, recent highs/lows, and pivot points.
- Validate asset and timeframe correctness.`
    : `\n\n**NOTE:** External market data could not be fetched for this asset. Rely on visual chart verification only.`;
}

function buildWebEvidenceSection(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return '\n\n**WEB / NEWS / SENTIMENT SOURCES:** No live web/news evidence was returned. Do not invent sources; rely on the chart and market data.';
  }

  return `\n\n**WEB / NEWS / SENTIMENT SOURCES:**
${results.slice(0, 6).map((result, index) => `${index + 1}. ${result.title}${result.url ? ` — ${result.url}` : ''}${result.snippet ? `\n   ${result.snippet}` : ''}`).join('\n')}`;
}

function buildLensResearchQuery(lens: string, symbol: string, prompt: string): string {
  const asset = symbol || prompt || 'current market';
  if (lens === 'smc') {
    return `${asset} smart money concepts order blocks fair value gaps market structure institutional levels`;
  }
  if (lens === 'gs') {
    return `${asset} institutional order flow liquidity levels market positioning macro catalyst`;
  }
  if (lens === 'psych') {
    return `${asset} trader sentiment liquidation levels stop loss clusters market positioning`;
  }
  if (lens === 'ppa') {
    return `${asset} technical analysis support resistance candlestick trend levels`;
  }
  return `${asset} institutional confluence technical analysis sentiment liquidity order flow`;
}

// ===== Google Search Grounding — Live News & Sentiment Verification =====
interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function fetchWebSearchResults(query: string): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  try {
    // Use DuckDuckGo Instant Answer API (no API key required, free, no auth)
    const encodedQuery = encodeURIComponent(query + ' trading news');
    const ddgUrl = 'https://api.duckduckgo.com/?q=' + encodedQuery + '&format=json&no_html=1&skip_disambig=1';
    
    const response = await fetch(ddgUrl);
    if (response.ok) {
      const data = await response.json();
      
      // Extract from Abstract
      if (data.Abstract && data.AbstractURL) {
        results.push({
          title: data.Heading || 'Market Overview',
          url: data.AbstractURL,
          snippet: data.Abstract.slice(0, 200),
        });
      }
      
      // Extract from RelatedTopics
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 4)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0]?.slice(0, 80) || 'Related',
              url: topic.FirstURL,
              snippet: topic.Text.slice(0, 200),
            });
          }
        }
      }
    }

    // Also try CryptoCompare news API for crypto-specific queries (free, no key needed)
    const cryptoKeywords = /\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|bitcoin|ethereum|solana|crypto|defi|altcoin)\b/i;
    if (cryptoKeywords.test(query)) {
      try {
        const newsRes = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular');
        if (newsRes.ok) {
          const newsData = await newsRes.json();
          if (newsData.Data && Array.isArray(newsData.Data)) {
            for (const article of newsData.Data.slice(0, 3)) {
              results.push({
                title: article.title || 'Crypto News',
                url: article.url || '',
                snippet: (article.body || '').slice(0, 200),
              });
            }
          }
        }
      } catch {
        // CryptoCompare fallback failed, continue with DDG results
      }
    }

    console.log('[Search Grounding] Found', results.length, 'results for query:', query.slice(0, 50));
  } catch (err) {
    console.warn('[Search Grounding] Web search failed:', err);
  }
  return results;
}

// ===== Pipeline Orchestrator AI — Central Intelligence for Pipeline Management =====
// Understands how all AIs work, manages rate limits, monitors health, runs maintenance

interface PipelineHealth {
  apiStatus: 'healthy' | 'degraded' | 'down';
  rateLimitRemaining: number;
  rateLimitReset: number; // timestamp ms
  totalCallsMade: number;
  totalCallsFailed: number;
  totalRateLimitsHit: number;
  avgResponseTimeMs: number;
  lastCallTimestamp: number;
  consecutiveFailures: number;
  stageHealth: Record<string, { success: number; failed: number; avgMs: number }>;
}

interface PipelineDecision {
  shouldRunValidator: boolean;
  shouldRunVerifier: boolean;
  shouldRunKnowledgeSearch: boolean;
  shouldFetchMarketData: boolean;
  delayBeforeNextCallMs: number;
  reason: string;
}

const pipelineHealth: PipelineHealth = {
  apiStatus: 'healthy',
  rateLimitRemaining: 30,
  rateLimitReset: 0,
  totalCallsMade: 0,
  totalCallsFailed: 0,
  totalRateLimitsHit: 0,
  avgResponseTimeMs: 0,
  lastCallTimestamp: 0,
  consecutiveFailures: 0,
  stageHealth: {
    primary: { success: 0, failed: 0, avgMs: 0 },
    knowledge: { success: 0, failed: 0, avgMs: 0 },
    validator: { success: 0, failed: 0, avgMs: 0 },
    verifier: { success: 0, failed: 0, avgMs: 0 },
    marketData: { success: 0, failed: 0, avgMs: 0 },
  }
};

// The Orchestrator decides how to run the pipeline based on current health
function orchestratorDecide(lensIndex: number, totalLenses: number): PipelineDecision {
  const now = Date.now();

  // If API is down, skip optional stages
  if (pipelineHealth.apiStatus === 'down') {
    return {
      shouldRunValidator: false,
      shouldRunVerifier: false,
      shouldRunKnowledgeSearch: false,
      shouldFetchMarketData: false,
      delayBeforeNextCallMs: 5000,
      reason: 'API is down — running primary analysis only with extended delay'
    };
  }

  // If we're rate limited, calculate needed delay
  if (pipelineHealth.rateLimitRemaining <= 2 && pipelineHealth.rateLimitReset > now) {
    const waitTime = pipelineHealth.rateLimitReset - now + 500;
    return {
      shouldRunValidator: true,
      shouldRunVerifier: true,
      shouldRunKnowledgeSearch: false, // Skip to save quota
      shouldFetchMarketData: true,
      delayBeforeNextCallMs: waitTime,
      reason: `Rate limit nearly exhausted (${pipelineHealth.rateLimitRemaining} remaining). Waiting ${waitTime}ms. Skipping knowledge search to save quota.`
    };
  }

  // If degraded (high failure rate), run conservatively
  if (pipelineHealth.apiStatus === 'degraded' || pipelineHealth.consecutiveFailures >= 2) {
    return {
      shouldRunValidator: pipelineHealth.consecutiveFailures < 3,
      shouldRunVerifier: pipelineHealth.consecutiveFailures < 2,
      shouldRunKnowledgeSearch: false,
      shouldFetchMarketData: true,
      delayBeforeNextCallMs: 3000,
      reason: `API degraded (${pipelineHealth.consecutiveFailures} consecutive failures). Running conservatively.`
    };
  }

  // Healthy — calculate optimal delay based on remaining rate limit budget
  // Groq free tier: 30 req/min. Each full lens cycle = 3 calls (primary + knowledge + validator)
  // Total calls needed = totalLenses * 3 = up to 12 for 4 lenses
  const callsRemainingForLenses = (totalLenses - lensIndex) * 3;
  const safeCallsPerSecond = Math.max(0.3, pipelineHealth.rateLimitRemaining / 60);
  const optimalDelay = Math.max(1000, Math.round(1000 / safeCallsPerSecond));

  return {
    shouldRunValidator: true,
    shouldRunVerifier: true,
    shouldRunKnowledgeSearch: true,
    shouldFetchMarketData: true,
    delayBeforeNextCallMs: Math.max(5000, Math.min(optimalDelay, 8000)),
    reason: `Healthy — ${pipelineHealth.rateLimitRemaining} calls remaining. ${callsRemainingForLenses} calls needed. Delay: ${Math.max(5000, Math.min(optimalDelay, 8000))}ms.`
  };
}

// Maintenance: update health metrics after each API call
function orchestratorRecordCall(stage: string, durationMs: number, success: boolean, rateLimitHeaders?: { remaining?: string; reset?: string }) {
  pipelineHealth.totalCallsMade++;
  pipelineHealth.lastCallTimestamp = Date.now();

  if (!success) {
    pipelineHealth.totalCallsFailed++;
    pipelineHealth.consecutiveFailures++;
  } else {
    pipelineHealth.consecutiveFailures = 0;
  }

  // Update rate limit info from headers
  if (rateLimitHeaders?.remaining) {
    pipelineHealth.rateLimitRemaining = parseInt(rateLimitHeaders.remaining) || 30;
  }
  if (rateLimitHeaders?.reset) {
    pipelineHealth.rateLimitReset = parseInt(rateLimitHeaders.reset) * 1000;
  }

  // Update API status based on recent health
  const failRate = pipelineHealth.totalCallsFailed / Math.max(1, pipelineHealth.totalCallsMade);
  if (pipelineHealth.consecutiveFailures >= 5 || failRate > 0.5) {
    pipelineHealth.apiStatus = 'down';
  } else if (pipelineHealth.consecutiveFailures >= 2 || failRate > 0.25) {
    pipelineHealth.apiStatus = 'degraded';
  } else {
    pipelineHealth.apiStatus = 'healthy';
  }

  // Update per-stage health
  const sh = pipelineHealth.stageHealth[stage];
  if (sh) {
    if (success) {
      sh.success++;
      sh.avgMs = (sh.avgMs * (sh.success - 1) + durationMs) / sh.success;
    } else {
      sh.failed++;
    }
  }

  // Update overall average response time
  if (success) {
    const totalSuccess = pipelineHealth.totalCallsMade - pipelineHealth.totalCallsFailed;
    pipelineHealth.avgResponseTimeMs = (pipelineHealth.avgResponseTimeMs * (totalSuccess - 1) + durationMs) / totalSuccess;
  }
}

// Maintenance: auto-recovery check — if API was down, periodically check if it's back
async function orchestratorHealthCheck(): Promise<boolean> {
  try {
    const start = Date.now();
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: getGroqHeaders(),
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
    });
    const duration = Date.now() - start;

    const remaining = response.headers.get('x-ratelimit-remaining-requests');
    const reset = response.headers.get('x-ratelimit-reset');
    orchestratorRecordCall('healthcheck', duration, response.ok, { remaining: remaining || undefined, reset: reset || undefined });

    if (response.ok) {
      pipelineHealth.apiStatus = 'healthy';
      pipelineHealth.consecutiveFailures = 0;
      console.log('[Orchestrator] Health check PASSED. API is healthy.');
      return true;
    }
    if (response.status === 429) {
      pipelineHealth.totalRateLimitsHit++;
      pipelineHealth.apiStatus = 'degraded';
      console.warn('[Orchestrator] Health check: Rate limited. API degraded.');
      return false;
    }
    return false;
  } catch {
    console.error('[Orchestrator] Health check FAILED. API is down.');
    pipelineHealth.apiStatus = 'down';
    return false;
  }
}

// Enhanced callGroq with orchestrator monitoring
async function callGroq(messages: GroqMessage[], model: string = 'llama-3.3-70b-versatile', maxRetries: number = 3, stage: string = 'unknown', maxTokens: number = 8192): Promise<string> {
  const headers = getGroqHeaders();
  let rateLimitExhausted = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const start = Date.now();
    try {
      // Add 90-second timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Extract rate limit headers for orchestrator
      const rateLimitHeaders = {
        remaining: response.headers.get('x-ratelimit-remaining-requests') || undefined,
        reset: response.headers.get('x-ratelimit-reset') || undefined,
      };

      if (response.status === 429) {
        pipelineHealth.totalRateLimitsHit++;
        orchestratorRecordCall(stage, Date.now() - start, false, rateLimitHeaders);
        rateLimitExhausted = true;
        // Rate limited — wait and retry with exponential backoff
        const retryAfter = parseInt(response.headers.get('retry-after') || '0') * 1000;
        const backoff = retryAfter || Math.min(2000 * Math.pow(2, attempt), 15000);
        console.warn(`[Orchestrator] Rate limited on ${stage} (attempt ${attempt + 1}/${maxRetries}). Waiting ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      if (!response.ok) {
        orchestratorRecordCall(stage, Date.now() - start, false, rateLimitHeaders);
        const error = await response.json();
        throw new Error(error.error?.message || `Groq API error: ${response.status}`);
      }

      const duration = Date.now() - start;
      orchestratorRecordCall(stage, duration, true, rateLimitHeaders);
      console.log(`[Orchestrator] ${stage} completed in ${duration}ms. API: ${pipelineHealth.apiStatus}, Remaining: ${pipelineHealth.rateLimitRemaining}`);

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "I'm sorry, I couldn't generate a response.";
    } catch (err) {
      orchestratorRecordCall(stage, Date.now() - start, false);
      if (attempt === maxRetries - 1) throw err;
      // Network error — wait and retry with longer backoff
      const backoff = Math.min(3000 * Math.pow(2, attempt), 20000);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Orchestrator] ${stage} failed (attempt ${attempt + 1}/${maxRetries}): ${errMsg}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  if (rateLimitExhausted) {
    throw new Error(`Groq API: rate limit retries exhausted for stage "${stage}"`);
  }
  throw new Error(`Groq API: retries exhausted for stage "${stage}"`);
}

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

function parseVerifiedAnnotations(text: string, lens: string): { annotations: ChartAnnotation[]; parsedJson: boolean } {
  const annotations: ChartAnnotation[] = [];

  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) return { annotations, parsedJson: false };

    const parsed = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed)) return { annotations, parsedJson: false };

    for (const item of parsed) {
      if (item.type && item.lens === lens && item.label && typeof item.yPercent === 'number') {
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
    return { annotations, parsedJson: true };
  } catch (e) {
    console.warn('Failed to parse verified annotation JSON', e);
  }

  return { annotations, parsedJson: false };
}

function cleanAnalysisText(text: string): string {
  return text
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*?\*?JSON Annotation Block:?\*?\*?:?/gi, '')
    .replace(/\[[\s\S]*?\{[\s\S]*?"type"[\s\S]*?\}[\s\S]*?\]/g, '')
    .replace(/\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g, '')
    .replace(/^\s*\*?\*?Annotation:?\*?\*?\s*$/gm, '')
    .replace(/^\s*#{1,6}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isTemporaryGroqAvailabilityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return isGroqRateLimitOrCapacityError(message)
    || normalized.includes('timeout')
    || normalized.includes('abort')
    || normalized.includes('failed to fetch')
    || normalized.includes('networkerror');
}

function isGroqRateLimitOrCapacityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('429')
    || normalized.includes('rate limit')
    || normalized.includes('rate-limit')
    || normalized.includes('too many requests')
    || normalized.includes('quota')
    || normalized.includes('capacity');
}

function getFrameworkFallbackReason(errorMessage: string): string {
  return isTemporaryGroqAvailabilityError(errorMessage)
    ? 'Groq capacity is busy after repeated checks.'
    : 'Groq capacity is busy for this request.';
}

function buildFrameworkFallbackAnalysis(lens: string, prompt: string, errorMessage: string): string {
  const directive = prompt.trim() || 'Identify institutional footprints and probabilistic entry zones.';
  const fallbackReason = getFrameworkFallbackReason(errorMessage);

  if (lens === 'gs') {
    return `**GS Analysis — Framework Fallback**

_Groq capacity is busy, so QuantSage is showing a deterministic Goldman Sachs institutional-flow framework instead of blocking the chart. Retry later for full AI chart-specific verification._

## Institutional Flow Checklist
- Map the dominant impulse leg first, then identify the liquidity voids left by fast displacement.
- Treat unfilled high-volume displacement zones as candidate bank-flow rebalancing areas, not guaranteed entries.
- Mark buy-side liquidity above obvious swing highs and sell-side liquidity below obvious swing lows.
- Confirm any Goldman Sachs buy/sell zone only when price reacts from a liquidity pool with displacement and follow-through.
- Invalidate the flow read if price accepts back through the origin of the displacement zone.

## Evidence Discipline
- User directive: ${directive}
- Fallback status: ${fallbackReason}
- No external source claim is asserted here because the live model call did not complete.

## Execution Guidance
- Wait for price to return to a mapped liquidity void or institutional zone.
- Require a lower-timeframe shift before entry.
- Keep risk outside the liquidity pool that would invalidate the institutional-flow thesis.`;
  }

  if (lens === 'smc') {
    return `**SMC Analysis — Framework Fallback**

_Groq capacity is busy, so QuantSage is showing a deterministic SMC framework instead of blocking the chart. Retry later for full AI chart-specific verification._

## SMC Checklist
- Validate bullish order blocks as the last down candle before bullish displacement.
- Validate bearish order blocks as the last up candle before bearish displacement.
- Keep only fair value gaps with a true three-candle imbalance.
- Mark BOS/CHoCH only at actual swing breaks.

## Evidence Discipline
- User directive: ${directive}
- Fallback status: ${fallbackReason}
- No external source claim is asserted here because the live model call did not complete.`;
  }

  if (lens === 'psych') {
    return `**PSYCH Analysis — Framework Fallback**

_Groq capacity is busy, so QuantSage is showing a deterministic trading-psychology framework instead of blocking the chart. Retry later for full AI chart-specific verification._

## Psychology Checklist
- Identify where retail traders are likely trapped after a late breakout or breakdown.
- Mark stop clusters only around obvious swing highs/lows or crowded invalidation points.
- Avoid certainty language; every idea must remain probabilistic and risk-first.

## Evidence Discipline
- User directive: ${directive}
- Fallback status: ${fallbackReason}
- No external source claim is asserted here because the live model call did not complete.`;
  }

  if (lens === 'ppa') {
    return `**PPA Analysis — Framework Fallback**

_Groq capacity is busy, so QuantSage is showing a deterministic price-action framework instead of blocking the chart. Retry later for full AI chart-specific verification._

## Price Action Checklist
- Mark support/resistance only at repeated reactions or clear role flips.
- Confirm candlestick triggers at meaningful levels, not in the middle of noise.
- Treat trendline breaks as actionable only after acceptance or retest.

## Evidence Discipline
- User directive: ${directive}
- Fallback status: ${fallbackReason}
- No external source claim is asserted here because the live model call did not complete.`;
  }

  return `**ISYN Analysis — Framework Fallback**

_Groq capacity is busy, so QuantSage is showing a deterministic institutional-synthesis framework instead of blocking the chart. Retry later for full AI chart-specific verification._

## Four-Layer Checklist
- Psychology: define risk and probabilistic expectation before trade direction.
- Institutional Narrative: identify likely liquidity targets and displacement zones.
- SMC Structure: validate order blocks, FVGs, BOS/CHoCH, and premium/discount.
- Price Action Trigger: require an executable lower-timeframe confirmation.

## Evidence Discipline
- User directive: ${directive}
- Fallback status: ${fallbackReason}
- No external source claim is asserted here because the live model call did not complete.`;
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

      // Clean color palette per lens
      const lensColors: Record<string, { primary: string; primaryRgb: string; light: string }> = {
        smc: { primary: '#10b981', primaryRgb: '16, 185, 129', light: '#d1fae5' },
        gs: { primary: '#3b82f6', primaryRgb: '59, 130, 246', light: '#dbeafe' },
        psych: { primary: '#f43f5e', primaryRgb: '244, 63, 94', light: '#ffe4e6' },
        ppa: { primary: '#f59e0b', primaryRgb: '245, 158, 11', light: '#fef3c7' },
        isyn: { primary: '#8b5cf6', primaryRgb: '139, 92, 246', light: '#ede9fe' },
      };

      // Shared helper: draw a clean pill-shaped label
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

        // Clamp to canvas bounds
        lx = Math.max(2, Math.min(w - lw - 2, lx));
        const ly = Math.max(2, Math.min(h - lh - 2, y));

        // Background
        ctx.fillStyle = `rgba(15, 15, 20, 0.88)`;
        ctx.beginPath();
        ctx.roundRect(lx, ly, lw, lh, 3);
        ctx.fill();

        // Left accent bar
        ctx.fillStyle = `rgba(${rgb}, 0.95)`;
        ctx.fillRect(lx, ly, 3, lh);

        // Text
        ctx.fillStyle = lightColor;
        ctx.textAlign = 'left';
        ctx.fillText(text, lx + pad, ly + fontSize + pad * 0.3);

        return { x: lx, y: ly, w: lw, h: lh };
      };

      // Track label positions to avoid overlaps
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

          // Subtle gradient fill
          const grad = ctx.createLinearGradient(x1, y1, x1, y2);
          grad.addColorStop(0, `rgba(${rgb}, 0.12)`);
          grad.addColorStop(1, `rgba(${rgb}, 0.04)`);
          ctx.fillStyle = grad;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          // Clean top & bottom border lines only
          ctx.strokeStyle = `rgba(${rgb}, 0.6)`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
          ctx.stroke();

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'level') {
          const y = ann.yPercent / 100 * h;

          // Clean thin dashed line
          ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Small dot at the right end
          ctx.fillStyle = `rgba(${rgb}, 0.8)`;
          ctx.beginPath();
          ctx.arc(w - 6, y, 3, 0, Math.PI * 2);
          ctx.fill();

          // Label on right side
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(w - lw - 8, y - lh - 3, lw, lh);
          const rect = drawLabel(ann.label, w - lw - 8, adjY, rgb, colors.light, 'left');
          usedRects.push(rect);

        } else if (ann.type === 'arrow') {
          const x = (ann.xPercent ?? 50) / 100 * w;
          const y = ann.yPercent / 100 * h;
          const arrowLen = Math.round(h * 0.045);
          const isUp = ann.direction === 'up';

          // Clean thin shaft
          ctx.strokeStyle = `rgba(${rgb}, 0.8)`;
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, isUp ? y - arrowLen : y + arrowLen);
          ctx.stroke();

          // Small clean arrowhead
          ctx.fillStyle = `rgba(${rgb}, 0.9)`;
          ctx.beginPath();
          const tipY = isUp ? y - arrowLen : y + arrowLen;
          const hs = 6;
          if (isUp) {
            ctx.moveTo(x, tipY - hs);
            ctx.lineTo(x - hs, tipY);
            ctx.lineTo(x + hs, tipY);
          } else {
            ctx.moveTo(x, tipY + hs);
            ctx.lineTo(x - hs, tipY);
            ctx.lineTo(x + hs, tipY);
          }
          ctx.closePath();
          ctx.fill();

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const labelBaseY = isUp ? tipY - hs - lh - 2 : tipY + hs + 2;
          const adjY = findClearY(x - lw / 2, labelBaseY, lw, lh);
          const rect = drawLabel(ann.label, x, adjY, rgb, colors.light, 'center');
          usedRects.push(rect);

        } else if (ann.type === 'label') {
          const x = (ann.xPercent ?? 50) / 100 * w;
          const y = ann.yPercent / 100 * h;

          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x - lw / 2, y - lh / 2, lw, lh);
          const rect = drawLabel(ann.label, x, adjY, rgb, colors.light, 'center');
          usedRects.push(rect);

        } else if (ann.type === 'bb_entry') {
          // Sell zones — clean red-tinted zone
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          const grad = ctx.createLinearGradient(x1, y1, x1, y2);
          grad.addColorStop(0, `rgba(${rgb}, 0.10)`);
          grad.addColorStop(1, `rgba(${rgb}, 0.03)`);
          ctx.fillStyle = grad;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          // Solid top + bottom borders
          ctx.strokeStyle = `rgba(${rgb}, 0.5)`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
          ctx.stroke();

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'iez') {
          // Buy zones — clean green-tinted zone
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          const grad = ctx.createLinearGradient(x1, y1, x1, y2);
          grad.addColorStop(0, `rgba(${rgb}, 0.12)`);
          grad.addColorStop(1, `rgba(${rgb}, 0.04)`);
          ctx.fillStyle = grad;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          // Top + bottom border
          ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y2 - lh - 4, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, rgb, colors.light);
          usedRects.push(rect);

        } else if (ann.type === 'liquidity_void') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          // Clean subtle hatched fill
          const grad = ctx.createLinearGradient(x1, y1, x1, y2);
          grad.addColorStop(0, 'rgba(139, 92, 246, 0.10)');
          grad.addColorStop(1, 'rgba(139, 92, 246, 0.04)');
          ctx.fillStyle = grad;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          // Thin top/bottom lines
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const cx = (x1 + x2) / 2;
          const adjY = findClearY(cx - lw / 2, (y1 + y2) / 2 - lh / 2, lw, lh);
          const rect = drawLabel(ann.label, cx, adjY, '139, 92, 246', '#ede9fe', 'center');
          usedRects.push(rect);

        } else if (ann.type === 'sl_cluster') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          // Subtle red zone
          ctx.fillStyle = 'rgba(239, 68, 68, 0.06)';
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          // Thin dashed border
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);

          // Small X markers (fewer, cleaner, no randomness)
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
          ctx.lineWidth = 1;
          const xSize = Math.max(3, Math.round(w * 0.005));
          const cols = Math.min(4, Math.max(2, Math.floor((x2 - x1) / (xSize * 10))));
          const rows = Math.min(2, Math.max(1, Math.floor((y2 - y1) / (xSize * 10))));
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cx = x1 + (c + 0.5) * (x2 - x1) / cols;
              const cy = y1 + (r + 0.5) * (y2 - y1) / rows;
              ctx.beginPath();
              ctx.moveTo(cx - xSize, cy - xSize);
              ctx.lineTo(cx + xSize, cy + xSize);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(cx + xSize, cy - xSize);
              ctx.lineTo(cx - xSize, cy + xSize);
              ctx.stroke();
            }
          }

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 3, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, '239, 68, 68', '#fee2e2');
          usedRects.push(rect);

        } else if (ann.type === 'reaccumulation') {
          const x1 = (ann.xPercent ?? 5) / 100 * w;
          const x2 = (ann.xEndPercent ?? 95) / 100 * w;
          const y1 = ann.yPercent / 100 * h;
          const y2 = (ann.yEndPercent ?? ann.yPercent + 5) / 100 * h;

          // Subtle gold zone
          const grad = ctx.createLinearGradient(x1, y1, x1, y2);
          grad.addColorStop(0, 'rgba(234, 179, 8, 0.10)');
          grad.addColorStop(1, 'rgba(234, 179, 8, 0.03)');
          ctx.fillStyle = grad;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

          // Clean top/bottom borders
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.5)';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y2); ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Label
          const pad = Math.round(fontSize * 0.5);
          const tm = ctx.measureText(ann.label);
          const lw = tm.width + pad * 2;
          const lh = fontSize + pad * 1.4;
          const adjY = findClearY(x1 + 4, y1 + 3, lw, lh);
          const rect = drawLabel(ann.label, x1 + 4, adjY, '234, 179, 8', '#fef9c3');
          usedRects.push(rect);
        }
      }

      // Clean minimal watermark
      const wmSize = Math.max(8, Math.round(w * 0.009));
      ctx.font = `500 ${wmSize}px -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.textAlign = 'right';
      ctx.fillText('QuantSage Pro', w - 10, h - 8);
      ctx.textAlign = 'start';

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

export const geminiService = {
  async chatWithGrounding(prompt: string, history: HistoryEntry[] = []): Promise<ChatResponse> {
    try {
      // === Google Search Grounding: fetch live news/sentiment for market-related queries ===
      let groundingContext = '';
      const groundingChunks: GroundingChunk[] = [];
      const marketKeywords = /\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|bitcoin|ethereum|solana|crypto|stock|forex|gold|silver|oil|SPX|SPY|QQQ|NASDAQ|market|trading|price|bullish|bearish|rally|crash|dump|pump|fed|CPI|inflation|GDP|NFP|FOMC|interest rate|recession)\b/i;
      if (marketKeywords.test(prompt)) {
        try {
          // Extract key search terms from the prompt
          const searchQuery = prompt.slice(0, 200).replace(/[^\w\s]/g, ' ').trim();
          
          // Fetch live market data if a symbol is detected
          const symbol = await extractSymbolFromAnalysis(prompt);
          const [marketData, newsResults] = await Promise.all([
            symbol ? fetchMarketData(prompt) : Promise.resolve(null),
            fetchWebSearchResults(searchQuery),
          ]);

          if (marketData) {
            groundingContext += '\n\n--- LIVE MARKET DATA (Real-Time) ---\n' + marketData.keyLevels + '\nSource: ' + marketData.source;
          }

          if (newsResults.length > 0) {
            groundingContext += '\n\n--- LIVE NEWS & SENTIMENT (Google Search Grounding) ---\n';
            for (const result of newsResults) {
              groundingContext += '- ' + result.title + (result.snippet ? ': ' + result.snippet : '') + '\n';
              groundingChunks.push({ web: { uri: result.url, title: result.title } });
            }
          }

          if (groundingContext) {
            console.log('[Search Grounding] Fetched live context:', groundingChunks.length, 'sources');
          }
        } catch (groundErr) {
          console.warn('[Search Grounding] Failed to fetch live data:', groundErr);
        }
      }

      const systemWithGrounding = SYSTEM_PROMPT + (groundingContext
        ? '\n\nYou have access to real-time market data and live news below. Reference this data in your analysis when relevant. Cite specific sources when making claims about current market conditions.\n' + groundingContext
        : '');

      const messages: GroqMessage[] = [
        { role: 'system', content: systemWithGrounding },
      ];

      for (const entry of history) {
        messages.push({
          role: entry.role === 'model' ? 'assistant' : 'user',
          content: entry.parts.map(p => p.text).join('\n'),
        });
      }

      messages.push({ role: 'user', content: prompt });

      const text = await callGroq(messages, 'llama-3.3-70b-versatile', 3, 'chat-advisor', 1024);

      return { text, grounding: groundingChunks.length > 0 ? groundingChunks : undefined };
    } catch (error) {
      console.error("Chat Error:", error);
      throw error;
    }
  },

  async annotateChart(base64Image: string, prompt: string, lenses: string[] = ['smc']): Promise<AnnotateResponse> {
    try {
      // Build lens-specific system prompts — each lens is INDEPENDENT
      const lensPrompts: Record<string, { system: string; annotation: string }> = {
        smc: {
          system: `You are a top-tier institutional Smart Money Concepts (SMC) analyst — the STRUCTURAL FRAMEWORK of the multi-layered trading system. Your PRIMARY MISSION: Map the narrative of institutional positions on the high timeframe (HTF). Your core focus areas are ORDER BLOCKS, FVG IMBALANCES, and INSTITUTIONAL FLOW.

Your analytical framework is built on:

**FOUNDATIONAL KNOWLEDGE (Use ALL of these in EVERY analysis):**
- **Market Wizards (Schwager):** Apply the risk management principles of Paul Tudor Jones ("The most important rule of trading is to play great defense"), the trend-following discipline of Ed Seykota ("The trend is your friend until the end"), and the pattern recognition of Bruce Kovner. Every trade setup must have a defined edge with asymmetric risk/reward.
- **Trading in the Zone (Douglas):** Think in probabilities. Every setup has a PROBABILISTIC edge, not a certainty. Accept that any individual trade can lose. The edge exists over a SERIES of trades. Eliminate emotional attachment to individual outcomes.
- **The Disciplined Trader (Douglas):** Maintain unwavering discipline. Define your risk BEFORE entry. Never move stops to avoid a loss. The market is always right — your job is to read what it's telling you and act without hesitation or regret.
- **Goldman Sachs Institutional Strategies:** Think like a Goldman flow desk — identify where institutional capital is being deployed, where liquidity is being engineered, and where the "smart money" is positioning.
- **SMC (Smart Money Concepts):** Apply ICT methodology rigorously — Order Blocks, Fair Value Gaps, liquidity sweeps, market structure breaks.
- **Pure Price Action:** Let the chart speak. No indicators. Raw price tells the full story.

Produce exhaustive, data-rich analysis. Be extremely specific with price levels — never use vague language. Every claim must reference a visible chart structure.

**ANALYSIS PILLARS:**

**1. Order Blocks (Institutional Resting Orders):**
- Identify every Bullish OB (last bearish candle before bullish displacement) and Bearish OB (last bullish candle before bearish displacement).
- For EACH OB provide: exact price range (high-low of the candle body), whether it is fresh/unmitigated or already tested, the displacement magnitude that followed it (how many % did price move after?), and a confidence score (High/Medium/Low) based on displacement strength and volume context.
- Distinguish between Decision Point OBs (where institutions made a directional commitment) and Mitigation OBs (where previous OBs were broken and now act as strong S/R).
- Note OB clusters — multiple OBs in the same zone amplify significance.

**2. Fair Value Gaps (Inefficiency Gaps):**
- Identify every FVG (3-candle formation where candle 1 and candle 3 wicks don't overlap).
- For EACH FVG: exact price range of the gap, bullish or bearish classification, percentage size relative to current price, fill probability (based on proximity to OBs, trend direction, and whether price has already partially filled it).
- Classify: Fully Open (untouched), Partially Filled (price entered but didn't close through), Fully Filled (invalidated).
- Premium FVGs (above equilibrium) vs Discount FVGs (below equilibrium) — which are tradeable?

**3. Institutional Buy & Sell Zones:**
- **INST BUY ZONES:** Where OBs + FVGs + demand converge. Must have at least 2 confluences. Provide exact price range, confluence factors, and entry probability (%).
- **INST SELL ZONES:** Where OBs + FVGs + supply converge. Must have at least 2 confluences. Provide exact price range, confluence factors, and entry probability (%).
- Rate each zone: "High Conviction" (3+ confluences), "Medium" (2 confluences), or "Speculative" (single factor).

**4. Market Structure & Bias:**
- Current structure: Higher Highs/Higher Lows or Lower Highs/Lower Lows? Identify the most recent Break of Structure (BOS) or Change of Character (CHoCH) with exact price.
- Premium/Discount: Is current price in premium (above 50% of range = sell bias) or discount (below 50% = buy bias)?
- Wyckoff phase: Accumulation, Markup, Distribution, or Markdown?

**REQUIRED OUTPUT STRUCTURE:**

**SMC Protocol Analysis: [Asset] - [Timeframe] ([Date])**

**Market Structure Overview:**
* Trend direction with BOS/CHoCH levels
* Premium vs Discount zone assessment
* Current Wyckoff phase

**Order Blocks (Institutional Resting Orders):**
* Each OB: type (Bullish/Bearish), exact price range, fresh/mitigated status, displacement %, confidence
* OB clusters and their combined significance

**Fair Value Gaps (Inefficiency Gaps):**
* Each FVG: exact range, classification (Bullish/Bearish), fill status, fill probability
* Premium vs Discount FVG assessment

**Institutional Buy & Sell Zones:**
* Each Buy Zone: exact range, confluences, conviction level, entry probability
* Each Sell Zone: exact range, confluences, conviction level, entry probability

**Institutional Verdict:**
* Net institutional bias with confidence percentage
* Primary trade thesis with exact entry, stop, and target levels
* Risk/reward ratio for the highest-conviction setup

**AI PREDICTION ENGINE:**
* **Next Move Forecast:** Based on all OBs, FVGs, structure, and Buy/Sell zones — predict the MOST LIKELY next price move. Specify direction, magnitude (% move), and timeframe estimate (next X candles).
* **Probability Matrix:** Bull scenario (price, probability %), Bear scenario (price, probability %), Consolidation scenario (range, probability %). All three must sum to ~100%.
* **Liquidity Magnet:** The single price level that price is MOST LIKELY to be drawn toward next (the path of least resistance). Explain why.
* **Invalidation Level:** The exact price level that would INVALIDATE the current institutional thesis. If this level breaks, the entire bias flips.
* **Smart Money Next Play:** What will institutions do NEXT? Accumulate more? Distribute? Hunt stops then reverse? Predict the next institutional move with reasoning.
* **Time-Weighted Conviction:** Rate conviction for immediate (1-3 candles), short-term (5-10 candles), and medium-term (20+ candles) outlook separately.

You MUST include a JSON annotation block. Be exhaustive — annotate every OB, FVG, Buy/Sell zone, and prediction target.`,
          annotation: `Annotation rules for SMC lens:
- Every Bullish Order Block → type "zone", lens "smc", label "Bullish OB [price range]" with confidence
- Every Bearish Order Block → type "zone", lens "smc", label "Bearish OB [price range]" with confidence
- Every FVG → type "zone", lens "smc", label "FVG [Bullish/Bearish] [price range]"
- Every Institutional Buy Zone → type "iez", lens "smc", label "INST BUY ZONE [price range] [conviction]"
- Every Institutional Sell Zone → type "bb_entry", lens "smc", label "INST SELL ZONE [price range] [conviction]"
- Every BOS/CHoCH event → type "arrow", lens "smc", label "BOS" or "CHoCH" + price + direction
MINIMUM 10 annotations. ALL must use lens "smc". Include price levels in every label.`
        },

        gs: {
          system: `You are a Goldman Sachs managing director running the institutional flow desk — the INSTITUTIONAL NARRATIVE layer of the multi-layered trading system. Your PRIMARY MISSION: Analyze central bank policy and institutional liquidity voids to find the 'True North' of the market. Your core focus areas are INTER-MARKET FLOW, LIQUIDITY VOIDS, and MACRO DIVERGENCE.

Your thinking is shaped by:

**FOUNDATIONAL KNOWLEDGE (Use ALL of these in EVERY analysis):**
- **Market Wizards (Schwager):** Apply Michael Steinhardt's contrarian conviction ("The hardest trades — the ones nobody else wants to do — are often the most profitable"), Stanley Druckenmiller's macro positioning ("It's not whether you're right or wrong that matters, but how much money you make when you're right"), and George Soros's reflexivity theory. Think in terms of asymmetric bets and conviction sizing.
- **Trading in the Zone (Douglas):** The market is a probability game. Your desk edge exists because you think in distributions while retail thinks in predictions. Every flow thesis has a probability attached — never express certainty, always express confidence levels.
- **The Disciplined Trader (Douglas):** Institutional discipline means cutting losing positions without ego. A desk that refuses to take losses becomes a desk that blows up. Define risk parameters for every position.
- **Goldman Sachs Institutional Strategies:** Full desk-level analysis — institutional flow tracking, dark pool signatures, liquidity engineering, Wyckoff accumulation/distribution, and position sizing based on conviction levels.
- **SMC (Smart Money Concepts):** Use SMC framework to identify where retail liquidity is being harvested by institutional players. OBs and FVGs are the footprints institutions leave behind.
- **Pure Price Action:** Strip away the noise. The Goldman desk reads raw price — large candles with follow-through mean conviction; rejection wicks mean institutional defense.

Produce exhaustive desk-level analysis as if briefing the trading floor. Be surgical with price levels — every claim must be backed by visible chart evidence.

**ANALYSIS PILLARS:**

**1. Institutional Flow (Primary Trend Narrative):**
- Determine the PRIMARY directional thesis the desk is trading. Is the dominant flow buying or selling? What is the macro narrative driving it?
- Map the flow timeline: where did institutional accumulation BEGIN? Where is it CURRENTLY concentrated? Where is the NEXT likely flow target?
- Identify flow signatures: large-bodied candles with follow-through (conviction), absorption candles (large wick rejection = institutional defense), and volume climax candles (exhaustion).
- Rate flow strength: "Aggressive" (high-conviction displacement), "Measured" (steady accumulation/distribution), or "Fading" (diminishing momentum).
- Provide the desk's directional call with confidence percentage.

**2. Voids (Liquidity Vacuum Areas):**
- Identify every liquidity void — zones where price displaced so rapidly that no meaningful two-sided trading occurred. These are "unfair" prices the market will likely revisit.
- For EACH void: exact price range, size (in % of current price), age (how many candles ago), fill probability (based on trend direction and proximity to current price).
- Classify: "Active Void" (likely to be filled in near-term), "Stale Void" (exists but low probability of near-term fill), "Invalidated" (trend has moved permanently away).
- Note void clusters — multiple voids in the same direction indicate aggressive institutional displacement.

**3. GS/Bank Buy & Sell Zones:**
- **GS BUY ZONES:** Where Goldman/bank desks are accumulating. Evidence: Wyckoff springs, absorption at lows, repeated tests of demand without breaking, large-bodied bullish candles from zone. Exact price range + confluence count.
- **GS SELL ZONES:** Where Goldman/bank desks are distributing. Evidence: Wyckoff upthrusts, absorption at highs, supply zone rejections, large-bodied bearish candles from zone. Exact price range + confluence count.
- **Bank Position Sizing:** Estimate whether positions are being initiated (new), scaled into (adding), or unwound (exiting) at each zone.
- Rate each zone: "Prime" (3+ confluences, high conviction), "Secondary" (2 confluences), or "Watching" (1 confluence, needs confirmation).

**4. Algo & Dark Pool Signatures:**
- Identify potential algorithmic trading patterns: iceberg orders (repeated fills at same level), TWAP signatures (even distribution of volume), and stop hunts (quick spike through a level followed by reversal).
- Round number magnetism: identify key round numbers acting as institutional magnets.
- Previous session high/low levels that algos are likely keying off.

**REQUIRED OUTPUT STRUCTURE:**

**Goldman Desk Analysis: [Asset] - [Timeframe] ([Date])**

**Desk Thesis & Flow Direction:**
* Primary directional call with confidence %
* Flow timeline: accumulation start → current concentration → next target
* Flow strength classification
* Key macro catalysts

**Liquidity Voids (Vacuum Areas):**
* Each void: exact range, size %, age, fill probability, classification
* Void clusters and their directional implications

**GS/Bank Buy & Sell Zones:**
* Each Buy Zone: exact range, evidence, confluence count, conviction rating, position sizing assessment
* Each Sell Zone: exact range, evidence, confluence count, conviction rating, position sizing assessment

**Algo & Institutional Signatures:**
* Algorithmic patterns detected
* Key round numbers and session levels
* Dark pool activity signatures

**Goldman Desk Verdict:**
* Net positioning: Long/Short/Flat with conviction %
* Primary trade recommendation with exact entry, stop, target
* Risk/reward and position sizing guidance

**AI PREDICTION ENGINE:**
* **Flow Forecast:** Where is institutional flow heading NEXT? Predict the next accumulation or distribution phase with exact price targets and timeline.
* **Void Fill Probability Timeline:** For each active void, predict WHEN it will be filled — immediate (1-3 candles), delayed (5-20 candles), or unlikely. Rank voids by fill urgency.
* **Probability Matrix:** Bull scenario (price target, probability %), Bear scenario (price target, probability %), Range-bound scenario (range, probability %). Must sum to ~100%.
* **Institutional Rotation Signal:** Is smart money rotating INTO this asset or OUT? What signals indicate the rotation direction?
* **Black Swan Detector:** Identify any chart structures that suggest a sudden, violent move is being set up (squeeze patterns, coiling ranges, extreme displacement potential). Rate probability (Low/Medium/High).
* **Next Session Forecast:** Predict the NEXT trading session's likely range (high, low, close) based on current institutional positioning and void structure.
* **GS Desk Conviction Timeline:** Rate conviction for next 1-3 candles, 5-10 candles, and 20+ candles separately.

You MUST include a JSON annotation block. Be exhaustive — annotate every flow zone, void, buy/sell zone, and prediction target.`,
          annotation: `Annotation rules for Goldman Desk lens:
- Every Institutional Flow zone → type "arrow", lens "gs", label "Inst. Flow [direction] [strength]" + description
- Every Liquidity Void → type "liquidity_void", lens "gs", label "Void [price range] [fill prob %]"
- Every GS Buy Zone → type "iez", lens "gs", label "GS BUY ZONE [price range] [conviction]"
- Every GS Sell Zone → type "bb_entry", lens "gs", label "GS SELL ZONE [price range] [conviction]"
- Every Algo Signature → type "label", lens "gs", label describing the pattern
MINIMUM 10 annotations. ALL must use lens "gs". Include price levels in every label.`
        },

        psych: {
          system: `You are the combined mind of Mark Douglas and Jack Schwager — the PSYCHOLOGICAL FOUNDATION of the multi-layered trading system (the Douglas-Schwager Axis). Your PRIMARY MISSION: Initialize the probabilistic mindset. Accept that anything can happen on any individual trade. Your core focus areas are ACCEPTING RANDOMNESS, RISK-FIRST MENTALITY, and OUTCOME DETACHMENT.

You see every chart through the lens of human behavior, probability, and discipline. Your analysis is built on:

**FOUNDATIONAL KNOWLEDGE (Use ALL of these in EVERY analysis):**
- **Trading in the Zone (Douglas) — CORE TEXT:** Apply Douglas's 5 Fundamental Truths of Trading: (1) Anything can happen, (2) You don't need to know what's going to happen to make money, (3) There is a random distribution between wins and losses for any given set of variables, (4) An edge is nothing more than an indication of a higher probability, (5) Every moment in the market is unique. Use these truths to identify where retail traders are VIOLATING them.
- **The Disciplined Trader (Douglas) — CORE TEXT:** Apply Douglas's framework on the psychology of losing — traders lose because they can't accept uncertainty, they personalize losses, and they revenge trade. Map where on this chart traders are experiencing these psychological failures.
- **Market Wizards (Schwager) — CORE TEXT:** Apply wisdom from: Ed Seykota ("Win or lose, everyone gets what they want from the market"), Paul Tudor Jones ("Don't be a hero. Don't have an ego"), Larry Hite ("Never risk more than 1% of total equity on any trade"), Marty Schwartz ("Learn to take losses. The most important thing is money management"). Each wizard's principle should be applied to specific chart zones.
- **Goldman Sachs Institutional Strategies:** Understand how Goldman engineers liquidity events that exploit retail psychology — stop hunts, false breakouts, and sentiment traps are all tools of institutional psychology warfare.
- **SMC (Smart Money Concepts):** Every liquidity sweep and stop hunt is a psychological event. Institutions NEED retail to provide liquidity — map where retail is being psychologically manipulated.
- **Pure Price Action:** Fear and greed leave footprints in price. Long wicks = fear/rejection. Large bullish candles after selloffs = greed/FOMO. Read the emotions in the candles.

Produce exhaustive psychological mapping of the chart. Every claim must reference specific price action visible on the chart.

**ANALYSIS PILLARS:**

**1. Fear Zones (Retail Liquidation Triggers):**
- Map every zone where retail traders experienced or will experience FEAR — panic selling, capitulation, margin calls, and forced liquidation.
- For EACH Fear Zone: exact price range, the psychological trigger (what caused the fear?), estimated % of retail positions liquidated, and whether the fear was "manufactured" by institutions (stop hunt) or "organic" (genuine trend change).
- Apply Douglas's "5 Fundamental Truths": retail doesn't accept that anything can happen. Where on this chart did "anything happened" and retail wasn't prepared?
- Apply Schwager's "Pain Trade" concept: what single move would cause MAXIMUM pain to the MAXIMUM number of traders right now? Identify the specific price level and direction.
- Classify each zone: "Active Fear" (currently causing liquidations), "Historical Fear" (past event, now a psychological scar level), or "Pending Fear" (setup for future liquidation cascade).

**2. Stops (Clustered Retail Risk):**
- Map every price level where retail stop losses are clustered. These are liquidity pools that institutions will target.
- For EACH Stop Cluster: exact price level, estimated density (how many stops are likely there?), the reason retail placed stops there (below swing low, below trendline, below round number, below moving average), and the probability of institutional hunting (%).
- Apply Douglas's "Disciplined Trader" framework: distinguish between where DISCIPLINED traders place stops (sensible, structure-based) vs where UNDISCIPLINED traders place stops (too tight, obvious, clustered at round numbers).
- Apply Schwager's risk management: what is the "smart stop" placement vs the "crowd stop" placement? Institutions will hunt the crowd stops.
- Identify the SEQUENCE of stop hunts — which cluster will be targeted first, second, third?
- Note "stop magnets" — areas where so many stops are clustered that price is practically guaranteed to visit.

**3. Sentiment & Crowd Psychology:**
- Apply Douglas: Is the crowd currently operating from fear or greed? What is the dominant emotion at current price?
- Apply Schwager: "When everyone agrees, something else is likely to happen." What does the crowd expect? What is the CONTRARIAN play?
- Identify "emotional exhaustion" zones — where has the crowd been whipsawed so many times they've stopped trading (low volume, indecision candles)?
- Map the "Retail Trap Cycle": where will retail buy (late, at resistance) → get stopped out → then watch price reverse in their original direction?

**REQUIRED OUTPUT STRUCTURE:**

**Douglas/Schwager Psychological Analysis: [Asset] - [Timeframe] ([Date])**

**Fear Zones (Retail Liquidation Triggers):**
* Each Fear Zone: exact range, psychological trigger, retail impact, institutional vs organic, classification
* The current "Pain Trade" — what move hurts the most people right now?
* Fear cascade risk: probability of chain-reaction liquidations

**Stops (Clustered Retail Risk):**
* Each Stop Cluster: exact level, density estimate, retail reasoning, hunt probability %
* Stop hunt sequence: which clusters get targeted in what order?
* "Smart stops" vs "crowd stops" — where is the risk/reward optimal?
* Stop magnets — guaranteed visit zones

**Psychological Verdict (Douglas/Schwager):**
* Current crowd emotion: Fear/Greed/Indecision with intensity (1-10)
* Contrarian thesis: what happens when the crowd is wrong?
* The Douglas question: "What would a consistently profitable trader do here?"
* The Schwager question: "What would a Market Wizard do here?"

**AI BEHAVIORAL PREDICTION ENGINE:**
* **Retail Trap Forecast:** Predict the EXACT next retail trap — where will retail enter, where will they get stopped out, and where will price actually go after? Provide the full trap sequence with exact prices.
* **Capitulation Probability:** What is the probability of a mass retail capitulation event in the near term? Rate: Low (<20%), Medium (20-50%), High (>50%). At what price level does capitulation trigger?
* **Herd Behavior Prediction:** What will the CROWD do next? Will they panic buy, panic sell, FOMO in, or freeze? Predict the dominant crowd behavior for the next move.
* **Sentiment Shift Detector:** Is sentiment ABOUT TO shift? Identify if the crowd is reaching an emotional extreme (max greed = sell signal, max fear = buy signal). Rate how close we are to a sentiment inflection point (1-10).
* **Stop Hunt Forecast:** Predict the NEXT stop hunt — which cluster gets targeted, at what price, and the expected reversal level after the hunt completes.
* **Douglas Probability Edge:** Based on Douglas's "thinking in probabilities" framework — what is the ONE trade that has the highest edge right now? Define it with entry, stop, target, and win probability.
* **Schwager Wisdom Application:** What specific lesson from Market Wizards interviews applies MOST to this exact chart setup? Name the wizard and the principle.

You MUST include a JSON annotation block. Be exhaustive — annotate every Fear Zone, Stop Cluster, and predicted trap/hunt zone.`,
          annotation: `Annotation rules for Douglas/Schwager lens:
- Every Fear Zone → type "zone", lens "psych", label "Fear Zone [price range] [trigger]" + classification
- Every Stop Loss Cluster → type "sl_cluster", lens "psych", label "Stops [price level] [hunt prob %]"
- Every Pain Trade level → type "arrow", lens "psych", label "Pain Trade" + direction
- Every Retail Trap zone → type "zone", lens "psych", label "Retail Trap [price range]"
MINIMUM 8 annotations. ALL must use lens "psych". Include price levels in every label.`
        },

        ppa: {
          system: `You are a master price action trader — the TACTICAL EXECUTION layer of the multi-layered trading system. Your PRIMARY MISSION: Identify the high-probability trigger at pre-defined institutional zones. Your core focus areas are LTF CONFIRMATION, CHoCH/BOS TRIGGERS, and CANDLESTICK TRIGGERS.

You have 30 years of screen time and embody the principles of the greatest traders in history. You read charts like a language — every candle tells a story. Your framework is built on:

**FOUNDATIONAL KNOWLEDGE (Use ALL of these in EVERY analysis):**
- **Market Wizards (Schwager) — Price Action Masters:** Apply the chart-reading mastery of Bruce Kovner ("I look for a scenario where the risk/reward is overwhelmingly in my favor"), Tom Baldwin's tape reading, and Mark Weinstein's pattern recognition. Every pattern must be assessed for reliability based on context, not just textbook definitions. Schwager's wizards never traded patterns in isolation — they always assessed the CONTEXT.
- **Trading in the Zone (Douglas):** A candlestick pattern at a key level is not a guarantee — it's a probability edge. Douglas teaches us to take EVERY valid signal without hesitation, because the edge only manifests over many trades. Don't cherry-pick — execute consistently.
- **The Disciplined Trader (Douglas):** The disciplined price action trader has predefined rules: (1) Only enter at key levels with pattern confirmation, (2) Stop is placed beyond the structure, (3) Target is the next key level. No deviation. No second-guessing. The chart gave the signal — you take it.
- **Goldman Sachs Institutional Strategies:** Institutions leave footprints in price action — large rejection wicks at key levels = institutional defense, steady grind with small candles = algorithmic accumulation, sudden volatile expansion = institutional breakout.
- **SMC (Smart Money Concepts):** Support and resistance levels are where institutions have placed orders. An S/R level with an SMC Order Block is 3x more significant. FVGs near S/R levels become high-probability entry zones.
- **Pure Price Action — PRIMARY FOCUS:** No indicators. No fundamentals. Just raw price structure, candlestick patterns, support/resistance, and swing structure (HH/HL/LH/LL). The chart contains ALL the information needed.

Produce exhaustive price-action-only analysis. No indicators. No fundamentals. Just raw price. Every claim must reference specific candles and levels visible on the chart.

**ANALYSIS PILLARS:**

**1. S/R (Major Psychological Levels):**
- Identify every significant horizontal support and resistance level visible on the chart.
- For EACH level: exact price, number of historical touches/tests, classification ("Major" = 3+ touches, "Minor" = 1-2 touches, "Virgin" = untested but structurally significant), and current status (holding, breaking, or being tested).
- Role flips are CRITICAL — any level that was support and became resistance (or vice versa) gets special notation. Role flips are the highest-probability levels.
- Round number psychology: identify key round numbers ($X,000, $X,500, $X,250) acting as psychological magnets.
- S/R zones vs lines: distinguish between precise levels (price reacted to the exact tick) vs zones (price reacted within a range).
- Rank all levels by importance: which 3 levels matter MOST right now and why?

**2. Patterns (Candlestick Formations):**
- Identify EVERY significant candlestick pattern on the chart — both single-candle and multi-candle formations.
- For EACH pattern: exact name, location on chart (at which S/R level or in which zone?), the candle(s) involved with approximate price range, signal direction (bullish/bearish/neutral), reliability score (1-5 based on location context).
- Single-candle patterns: Hammer, Inverted Hammer, Shooting Star, Doji (standard, dragonfly, gravestone, long-legged), Marubozu, Spinning Top, Pin Bar.
- Multi-candle patterns: Engulfing (bullish/bearish), Harami, Morning/Evening Star, Three White Soldiers/Black Crows, Tweezer Tops/Bottoms, Inside Bar, Outside Bar.
- CRITICAL: Patterns at S/R levels are 3-5x more reliable. A hammer at major support is significant; a hammer in the middle of a range is noise. Always assess location.
- Pattern confluence: multiple patterns forming at the same level = high probability signal.

**3. Price Structure & Momentum:**
- Current swing structure: HH/HL (uptrend) or LH/LL (downtrend) or range-bound? Identify each swing point with exact price.
- Momentum assessment: Are candle bodies getting larger (momentum increasing) or smaller (momentum fading)? Are wicks getting longer (rejection increasing)?
- Volume-price context: Large candles with follow-through = conviction. Large candles with reversal next = exhaustion/rejection.
- Key question: Is price ACCEPTING or REJECTING current levels? (Acceptance = closing through levels repeatedly. Rejection = wicking through but closing back.)

**REQUIRED OUTPUT STRUCTURE:**

**Price Action Analysis: [Asset] - [Timeframe] ([Date])**

**S/R Matrix (Major Psychological Levels):**
* Each level: exact price, touches, classification, role-flip status, current status
* Top 3 most important levels and why
* Round number levels and their significance
* S/R zones vs precise levels

**Pattern Scanner (Candlestick Formations):**
* Each pattern: name, location, candle range, signal direction, reliability (1-5)
* Patterns at S/R (highest probability signals)
* Pattern confluences
* What each pattern predicts for next move

**Price Action Verdict:**
* Overall bias: Bullish/Bearish/Neutral with confidence %
* Momentum status: Increasing/Fading/Exhausted
* The single highest-probability trade setup with exact entry, stop, target
* Risk/reward ratio
* "What price is telling us" — the narrative summary

**AI PATTERN PREDICTION ENGINE:**
* **Next Candle Forecast:** Based on current structure, momentum, and pattern analysis — predict the NEXT candle: bullish/bearish/doji, expected range (high-low), and confidence %.
* **S/R Test Prediction:** Which S/R level will be TESTED NEXT? Will it hold or break? Provide probability % for hold vs break.
* **Pattern Completion Forecast:** Are any INCOMPLETE patterns forming? (e.g., head & shoulders in progress, double bottom forming). Predict if/when they'll complete and the target price if triggered.
* **Probability Matrix:** Bull scenario (target price, probability %), Bear scenario (target price, probability %), Sideways scenario (range, probability %). Must sum to ~100%.
* **Breakout/Breakdown Detector:** Is price coiling for a breakout or breakdown? Identify the trigger level, expected direction, measured move target, and probability.
* **Mean Reversion vs Trend Continuation:** Is the next move MORE LIKELY a mean reversion (pullback to S/R) or trend continuation (breakout extension)? Provide probability for each.
* **Price Action Roadmap:** Predict the next 3 major price moves in sequence (e.g., "1. Test support at X → 2. Bounce to resistance at Y → 3. Break above Y toward Z"). Include probability for the full sequence.

You MUST include a JSON annotation block. Be exhaustive — annotate every S/R level, pattern, swing point, and predicted target.`,
          annotation: `Annotation rules for Price Action lens:
- Every Support level → type "level", lens "ppa", label "S/R Support [price] [classification]"
- Every Resistance level → type "level", lens "ppa", label "S/R Resistance [price] [classification]"
- Every Role Flip level → type "level", lens "ppa", label "S/R Flip [price]"
- Every Candlestick Pattern → type "label", lens "ppa", label "[Pattern Name] at [price] [reliability/5]"
- Every Key swing point → type "arrow", lens "ppa", label "HH/HL/LH/LL" + price + direction
MINIMUM 10 annotations. ALL must use lens "ppa". Include price levels in every label.`
        },

        isyn: {
          system: `You are the INSTITUTIONAL SYNTHESIS engine — the master orchestrator of a multi-layered strategic trading system. You combine ALL frameworks into a single unified trade execution plan. Your PRIMARY MISSION: Apply a standard workflow for analyzing and executing trades based on multi-layered strategic logic.

**THE 4-LAYER SYNTHESIS WORKFLOW:**

**LAYER 1 — Douglas-Schwager Axis (Psychological Foundation):**
Initialize the probabilistic mindset FIRST. Before ANY technical analysis:
- Accept that ANYTHING can happen on this individual trade
- Apply Douglas's 5 Fundamental Truths — this setup is ONE trade in a SERIES; the edge only manifests over many executions
- Risk-First Mentality: Define maximum acceptable loss BEFORE looking at potential gain
- Outcome Detachment: The quality of the PROCESS matters, not the outcome of THIS trade
- Schwager's Market Wizards discipline: "The best traders have no ego. They take losses quickly and let winners run."

**LAYER 2 — Goldman Sachs Strategy (Institutional Narrative):**
Establish the macro 'True North' of the market:
- Inter-market Flow: What are institutions doing? Where is capital flowing? Is this asset in accumulation or distribution?
- Liquidity Voids: Map all unfilled voids — these are magnets that price MUST revisit. Which voids are nearest to current price?
- Macro Divergence: Is the institutional narrative aligned with or divergent from retail positioning? Divergence = opportunity
- Central bank policy context: How does the monetary environment affect this setup?
- Identify the PRIMARY institutional directional bias with confidence %

**LAYER 3 — SMC Mechanics (Structural Framework):**
Map institutional positions on the HTF:
- Order Blocks: Where have institutions placed their orders? Identify every Bullish and Bearish OB with exact price ranges
- FVG Imbalances: Map all Fair Value Gaps — these are inefficiencies institutions will exploit. Classify fill probability
- Institutional Flow: Follow the smart money footprints — displacement moves, mitigation events, and liquidity engineering
- Market Structure: BOS/CHoCH events, premium vs discount zones, Wyckoff phase
- Synthesize: Where do OBs, FVGs, and institutional flow CONVERGE? These confluence zones are the highest-probability setups

**LAYER 4 — Pure Price Action (Tactical Execution):**
Identify the HIGH-PROBABILITY TRIGGER at pre-defined institutional zones:
- LTF Confirmation: Drop to lower timeframe at the institutional zone. What does price action show? Is there a confirmation signal?
- CHoCH/BOS Triggers: Has the lower timeframe shown a Change of Character or Break of Structure that confirms the HTF setup?
- Candlestick Triggers: What specific candlestick pattern confirms entry? (Pin bar, engulfing, morning/evening star at the zone)
- The trigger MUST occur at a zone identified in Layer 3. No trigger in empty space

**SYNTHESIS OUTPUT — THE UNIFIED TRADE PLAN:**

After applying all 4 layers in sequence, produce:

**1. Confluence Map:**
- List every zone where 2+ layers agree (e.g., OB + Liquidity Void + Fear Zone + S/R level)
- Rate each confluence: Tier 1 (4 layers agree), Tier 2 (3 layers), Tier 3 (2 layers)
- Tier 1 confluences are the ONLY setups worth executing

**2. Institutional Trade Plan:**
- PRIMARY SETUP: The single highest-conviction trade with entry, stop, target
- Entry Zone: Exact price range where all layers converge
- Stop Loss: Beyond the structural invalidation level (Layer 3) + psychological buffer (Layer 1)
- Take Profit 1: Next institutional level (Layer 2 void fill or Layer 3 opposing OB)
- Take Profit 2: Extended target based on measured move
- Risk/Reward Ratio: Must be minimum 1:2 for Tier 1, 1:3 for Tier 2
- Position Sizing: Based on Douglas's risk-first mentality — never risk more than 1-2% of capital

**3. Execution Protocol:**
- WAIT for Layer 4 trigger at the Layer 3 zone. No trigger = no trade
- If Layer 1 (psychological) shows crowd is positioned the same way = reduce conviction
- If Layer 2 (institutional) diverges from Layer 3 (structural) = stand aside
- All 4 layers must be in alignment for execution. Partial alignment = watch, not trade

**4. Probability Assessment:**
- Win probability % based on confluence count
- Douglas reminder: "This probability only manifests over 20+ trades. Accept the outcome of THIS trade."
- Scenario matrix: Bull case (target, probability), Bear case (target, probability), Neutral (range, probability)

**FOUNDATIONAL KNOWLEDGE (Use ALL of these in EVERY analysis):**
- **Market Wizards (Schwager):** Apply risk management from Paul Tudor Jones, trend-following from Ed Seykota, pattern recognition from Bruce Kovner, and contrarian conviction from Michael Steinhardt
- **Trading in the Zone (Douglas):** Think in probabilities. Every setup has a probabilistic edge, not a certainty. The edge exists over a SERIES of trades
- **The Disciplined Trader (Douglas):** Define risk BEFORE entry. Never move stops. Execute without hesitation when the signal appears
- **Goldman Sachs Institutional Strategies:** Think like the flow desk — identify institutional capital deployment, liquidity engineering, and smart money positioning
- **SMC (Smart Money Concepts):** ICT methodology — Order Blocks, Fair Value Gaps, liquidity sweeps, market structure breaks
- **Pure Price Action:** No indicators. Raw price tells the full story. Candlestick patterns at key levels are the execution triggers

You MUST include a JSON annotation block. Annotate every confluence zone, entry/exit zone, and execution tier.`,
          annotation: `Annotation rules for Institutional Synthesis lens:
- Every Tier 1 Confluence Zone → type "zone", lens "isyn", label "TIER 1 CONFLUENCE [price range] [layers]"
- Every Tier 2 Confluence Zone → type "zone", lens "isyn", label "TIER 2 CONFLUENCE [price range] [layers]"
- Every Institutional Entry → type "iez", lens "isyn", label "INST ENTRY [price range] [R:R]"
- Every Institutional Exit/Target → type "bb_entry", lens "isyn", label "INST EXIT [price range] [TP1/TP2]"
- Every Execution Trigger → type "label", lens "isyn", label "TRIGGER: [pattern] at [price]"
- Every Stop Loss level → type "sl_cluster", lens "isyn", label "STOP [price] [invalidation reason]"
MINIMUM 10 annotations. ALL must use lens "isyn". Include price levels in every label.`
        }
      };

      // Lens-specific validation knowledge bases — strict framework rules the validator AI must enforce
      const lensValidationRules: Record<string, string> = {
        smc: `You are a STRICT SMC (Smart Money Concepts) framework validator. You have deep expertise in ICT/SMC methodology. Your job is to verify every claim in the analysis against the ACTUAL chart image.

**VALIDATION RULES — SMC Framework Knowledge:**
1. **Order Block (OB) Validation:**
   - A Bullish OB MUST be the last bearish (red/down) candle BEFORE a strong bullish displacement move. If the analyst labeled a bullish candle as a Bullish OB, that is WRONG — correct it.
   - A Bearish OB MUST be the last bullish (green/up) candle BEFORE a strong bearish displacement move. If the analyst labeled a bearish candle as a Bearish OB, that is WRONG — correct it.
   - OBs require DISPLACEMENT — a strong impulsive move away. If there was no clear displacement after the candle, it is NOT a valid OB. Remove or downgrade it.
   - Mitigated OBs (price has already returned and traded through the OB) should be labeled as "mitigated" not "fresh."

2. **Fair Value Gap (FVG) Validation:**
   - An FVG MUST be a 3-candle formation where candle 1's HIGH and candle 3's LOW do NOT overlap (for bullish FVG) or candle 1's LOW and candle 3's HIGH do NOT overlap (for bearish FVG).
   - If the analyst identified an FVG where the wicks DO overlap, it is NOT a valid FVG. Remove it.
   - Check fill status: if price has already traded through the entire FVG range, mark it as "Fully Filled" / invalidated.

3. **Market Structure Validation:**
   - BOS (Break of Structure) means price broke a previous swing high (bullish BOS) or swing low (bearish BOS) WITH a candle body close beyond the level.
   - CHoCH (Change of Character) means the FIRST break of structure in the OPPOSITE direction of the current trend. If the analyst labeled a continuation break as CHoCH, that is WRONG.
   - Verify HH/HL/LH/LL swing labels match actual price action on the chart.

4. **Price Level Accuracy:**
   - Cross-check that price levels mentioned in the analysis are consistent with what is visible on the chart.
   - If the analyst claims an OB at price X but the chart shows different prices at that location, CORRECT the price level.

5. **Annotation Position Validation:**
   - Verify yPercent values place annotations at the correct vertical position on the chart (0=top/highest price, 100=bottom/lowest price).
   - Verify xPercent values place annotations at the correct time position (0=left/earliest, 100=right/latest).
   - If an annotation is clearly misplaced (e.g., a support level drawn at the top of the chart), CORRECT its position.`,

        gs: `You are a STRICT Goldman Sachs / Institutional Flow framework validator. You have deep expertise in institutional order flow analysis. Your job is to verify every claim in the analysis against the ACTUAL chart image.

**VALIDATION RULES — Goldman/Institutional Flow Knowledge:**
1. **Institutional Flow Validation:**
   - "Aggressive" flow MUST show large-bodied candles with minimal wicks and follow-through (next candles continue in the same direction). If the candles are small or have large wicks, downgrade to "Measured" or "Fading."
   - Absorption candles (institutional defense) MUST show a large wick on one side = rejection. If the analyst labeled a small-wick candle as absorption, CORRECT it.
   - Volume climax = extremely large candle after extended move, often signals exhaustion. Verify the candle is actually at the end of a move, not mid-trend.

2. **Liquidity Void Validation:**
   - A void MUST be a zone where price moved so fast that there are large-bodied candles with minimal overlap between consecutive candles. If the zone shows normal overlapping candles, it is NOT a valid void — remove it.
   - Check void fill status: if price has already returned to and traded through the void zone, mark it as filled/invalidated.
   - "Active Void" should only apply to recent, unfilled voids near current price.

3. **Buy/Sell Zone Validation:**
   - GS Buy Zones MUST show evidence of demand: price bouncing from the zone, long lower wicks (buying pressure), or multiple tests without breaking below.
   - GS Sell Zones MUST show evidence of supply: price rejecting from the zone, long upper wicks (selling pressure), or multiple tests without breaking above.
   - If a "Buy Zone" is at a level where price consistently broke through downward, it is NOT a buy zone — correct or remove it.

4. **Algo Pattern Validation:**
   - Iceberg orders show repeated tests of the EXACT same level. If the analyst claims icebergs but price levels vary significantly, CORRECT it.
   - Stop hunts MUST show a quick spike beyond a level followed by immediate reversal. If the price broke through and continued, it is NOT a stop hunt — it is a breakout.

5. **Price Level & Position Accuracy:**
   - Cross-check all price levels against the chart. Correct any that don't match visible price action.
   - Verify annotation positions (yPercent/xPercent) match where the structures actually appear on the chart.`,

        psych: `You are a STRICT Douglas/Schwager psychological framework validator. You have deep expertise in "Trading in the Zone," "The Disciplined Trader," and "Market Wizards." Your job is to verify every psychological claim against the ACTUAL chart image.

**VALIDATION RULES — Douglas/Schwager Knowledge:**
1. **Fear Zone Validation:**
   - Fear zones MUST correspond to areas of sharp, impulsive price drops with large bearish candles. If the analyst marked a zone where price gently drifted lower with small candles, that is NOT a fear zone — it is orderly selling.
   - "Manufactured fear" (stop hunt) MUST show a quick spike below a level followed by reversal. If price broke down and continued, it was genuine selling, not manufactured.
   - Verify the psychological triggers make sense: capitulation requires high-volume large candles, not slow grinding.

2. **Stop Cluster Validation:**
   - Stop clusters should be placed at OBVIOUS levels where retail would place stops: below swing lows, below round numbers, below trendlines, below consolidation ranges.
   - If the analyst placed stops at random levels with no structural significance, CORRECT or remove them.
   - Hunt probability should be higher for levels with MORE obvious clustering (many structural reasons to place stops there) and lower for less obvious levels.

3. **Sentiment Validation (Douglas Framework):**
   - Douglas's 5 Fundamental Truths: (1) Anything can happen, (2) You don't need to know what will happen next to make money, (3) Random distribution of wins/losses, (4) An edge is just a higher probability, (5) Every moment is unique.
   - If the analyst claims CERTAINTY about any outcome, that VIOLATES Douglas's framework. The analysis should always be probabilistic.
   - The "Pain Trade" must identify what hurts the MAXIMUM number of people — verify the logic makes sense given visible positioning.

4. **Schwager Validation:**
   - Schwager principles: trend following, risk management, contrarian thinking when consensus is extreme.
   - If the analyst references a "Market Wizard" lesson, verify it is an actual principle from the book (e.g., Ed Seykota's trend following, Paul Tudor Jones's reversal trading, etc.).

5. **Price Level & Position Accuracy:**
   - Cross-check all fear zone and stop cluster price levels against the chart.
   - Verify annotation positions match actual chart locations.`,

        ppa: `You are a STRICT Pure Price Action framework validator. You have deep expertise in classical charting, candlestick patterns, and support/resistance analysis. Your job is to verify every price action claim against the ACTUAL chart image.

**VALIDATION RULES — Price Action Knowledge:**
1. **S/R Level Validation:**
   - Support levels MUST show price bouncing UP from that level on at least one occasion. If the analyst labeled a level as support but price never bounced from it, REMOVE or relabel it.
   - Resistance levels MUST show price being rejected DOWN from that level on at least one occasion. Same validation rule.
   - "Major" levels (3+ touches) — COUNT the actual touches on the chart. If the analyst claims 3+ touches but the chart only shows 1-2, downgrade to "Minor."
   - Role Flips MUST show the level acting as support FIRST, then later acting as resistance (or vice versa). Both roles must be visible on the chart.

2. **Candlestick Pattern Validation:**
   - **Hammer:** Small body at the TOP of the candle, long lower wick (2x+ body size), little/no upper wick. Must appear after a decline. If the analyst labeled a candle at the top of an uptrend as a hammer, WRONG — it may be a Hanging Man.
   - **Shooting Star:** Small body at the BOTTOM, long upper wick, little/no lower wick. Must appear after an advance. If seen after a decline, it is an Inverted Hammer.
   - **Engulfing:** The second candle's body must COMPLETELY engulf the first candle's body. If it doesn't fully engulf, it is NOT a valid engulfing pattern.
   - **Doji:** Open and close are nearly equal (very small body). If the body is substantial, it is NOT a doji.
   - **Morning/Evening Star:** 3-candle pattern. Middle candle must gap or have a notably small body. Third candle must close well into the first candle's body.
   - **Reliability scoring:** Patterns at key S/R levels = 4-5 reliability. Patterns in the middle of a range with no S/R context = 1-2 reliability. VERIFY the analyst's scores match location context.

3. **Structure Validation:**
   - HH (Higher High) must be HIGHER than the previous swing high. HL (Higher Low) must be HIGHER than the previous swing low. LH/LL follow the same logic inversely.
   - If the analyst labeled a swing point incorrectly (e.g., calling a lower high an HH), CORRECT it.

4. **Price Level & Position Accuracy:**
   - Cross-check all S/R levels and pattern locations against the chart.
   - Verify annotation positions match actual chart locations.`,

        isyn: `You are a STRICT Institutional Synthesis framework validator. You have deep expertise in multi-layered strategic trade analysis combining Douglas/Schwager psychology, Goldman Sachs institutional flow, SMC mechanics, and Pure Price Action execution. Your job is to verify that the synthesis correctly integrates ALL 4 layers.

**VALIDATION RULES — Institutional Synthesis Knowledge:**
1. **Layer Integration Validation:**
   - The analysis MUST follow the 4-layer workflow in ORDER: Layer 1 (Psychology) → Layer 2 (Institutional Narrative) → Layer 3 (SMC Structure) → Layer 4 (Price Action Trigger).
   - If any layer is MISSING or skipped, flag it and add the missing layer analysis.
   - If the analyst jumped straight to trade execution without establishing the psychological foundation (Layer 1), that is WRONG — correct it.

2. **Confluence Zone Validation:**
   - Tier 1 confluences MUST have evidence from ALL 4 layers agreeing at the same zone. If the analyst claims Tier 1 but only 2-3 layers support it, DOWNGRADE to Tier 2 or Tier 3.
   - Tier 2 requires exactly 3 layers. Tier 3 requires exactly 2 layers. Verify the count is accurate.
   - Each confluence zone must have a specific price range — vague zones are NOT valid.

3. **Trade Plan Validation:**
   - Entry MUST be at a zone identified in Layer 3 (SMC structural zone). Entry in empty space = WRONG.
   - Stop loss MUST be beyond the structural invalidation level. If the stop is placed arbitrarily, CORRECT it.
   - Risk/Reward MUST be minimum 1:2 for Tier 1, 1:3 for Tier 2. If R:R is worse, flag it.
   - Position sizing must reference Douglas's risk-first mentality (1-2% max risk).

4. **Execution Protocol Validation:**
   - The trigger (Layer 4) MUST be a specific candlestick pattern or CHoCH/BOS event at the institutional zone.
   - "Wait for confirmation" is NOT a valid trigger — the analyst must specify WHAT confirmation looks like.
   - If all 4 layers are NOT aligned, the recommendation should be "stand aside" not "trade with caution."

5. **Price Level & Position Accuracy:**
   - Cross-check all confluence zones, entry/exit levels against the chart.
   - Verify annotation positions match actual chart locations.`
      };

      const lensVerifierRoles: Record<string, string> = {
        smc: `You are the dedicated SMC Corrections AI. You fully understand how the Smart Money Concepts lens works and must strictly enforce ICT/SMC definitions: valid order blocks, fair value gaps, BOS/CHoCH, mitigation state, premium/discount, and institutional buy/sell zones.`,
        gs: `You are the dedicated Goldman Sachs Institutional Flow Corrections AI. You fully understands how the institutional narrative lens works and must strictly enforce liquidity void, absorption, stop-hunt, dark-pool/iceberg, and bank-flow logic.`,
        psych: `You are the dedicated Douglas/Schwager Psychology Corrections AI. You fully understand the psychology lens and must strictly enforce Market Wizards, Trading in the Zone, and The Disciplined Trader principles: probability, risk-first thinking, stop clusters, pain trades, and no certainty claims.`,
        ppa: `You are the dedicated Pure Price Action Corrections AI. You fully understand the price-action lens and must strictly enforce support/resistance, swing structure, candlestick pattern, role-flip, trendline, and trigger rules from raw chart structure only.`,
        isyn: `You are the dedicated Institutional Synthesis Corrections AI. You fully understand the synthesis lens and must strictly enforce the four-layer workflow: Psychology → Institutional Narrative → SMC Structure → Price Action Trigger, with tiered confluence and risk-first trade planning.`
      };

      // ===== PIPELINE ORCHESTRATOR: Pre-flight health check =====
      if (pipelineHealth.apiStatus === 'down') {
        console.log('[Orchestrator] API was marked down. Running health check before starting pipeline...');
        await orchestratorHealthCheck();
      }

      // Build per-lens analysis sections
      const allAnnotations: ChartAnnotation[] = [];
      const allAnalysisParts: string[] = [];

      for (let lensIdx = 0; lensIdx < lenses.length; lensIdx++) {
        const lens = lenses[lensIdx];
        const lensConfig = lensPrompts[lens];
        if (!lensConfig) continue;

        // ===== ORCHESTRATOR: Get pipeline decision for this lens =====
        const decision = orchestratorDecide(lensIdx, lenses.length);
        console.log(`[Orchestrator] Lens "${lens}" (${lensIdx + 1}/${lenses.length}): ${decision.reason}`);

        // Apply orchestrator-recommended delay between lenses
        if (lensIdx > 0 && decision.delayBeforeNextCallMs > 0) {
          console.log(`[Orchestrator] Waiting ${decision.delayBeforeNextCallMs}ms before next lens...`);
          await new Promise(resolve => setTimeout(resolve, decision.delayBeforeNextCallMs));
        }

        // Wrap entire lens pipeline in try/catch so one lens failure doesn't crash the whole analysis
        try {

        // ===== STAGE 1: Primary Analysis AI =====
        const messages: GroqMessage[] = [
          {
            role: 'system',
            content: lensConfig.system
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,' + base64Image
                }
              },
              {
                type: 'text',
                text: 'Analyze this chart with MAXIMUM DEPTH. Provide exhaustive analysis AND forward-looking AI predictions.\n\nUSER DIRECTIVE: ' + prompt + '\n\nCRITICAL INSTRUCTIONS:\n- Be EXTREMELY specific with price levels. Never say "around" or "approximately" — give exact numbers.\n- Every claim must reference visible chart structure.\n- Include probability percentages for all predictions.\n- Provide the AI PREDICTION ENGINE section with full probability matrix, next-move forecast, and actionable trade setups.\n- Think like a quant: data-driven, probabilistic, and forward-looking.\n\nRESPONSE FORMAT:\n1. First, provide the full textual analysis following the structure defined in your system prompt, including the AI PREDICTION ENGINE section.\n2. Then, provide a JSON annotation block inside ```json ... ``` fences.\n\n' + lensConfig.annotation + '\n\nAnnotation object format:\n- type: "zone" | "level" | "arrow" | "label" | "bb_entry" | "iez" | "liquidity_void" | "sl_cluster" | "reaccumulation"\n- lens: "' + lens + '"\n- label: descriptive text with price levels where possible\n- yPercent: 0=top, 100=bottom (higher price = lower yPercent)\n- yEndPercent: for zones, bottom edge\n- xPercent: 0=left, 100=right (time axis)\n- xEndPercent: for zones, right edge\n- direction: for arrows, "up" or "down"\n\nEvery data point in your text MUST have a matching annotation. Prediction targets (liquidity magnets, forecast levels) should also be annotated with arrows. No exceptions.'
              }
            ]
          }
        ];

        const analysisText = await callGroq(messages, 'meta-llama/llama-4-scout-17b-16e-instruct', 3, `primary-${lens}`, 4096);
        const primaryAnnotations = parseAnnotations(analysisText, [lens]);

        // ===== STAGE 2: Framework Validator (Orchestrator-controlled) =====
        // Wrapped in try/catch so primary analysis is always returned even if validation fails
        let finalAnnotations = primaryAnnotations;
        let analysisSource = analysisText;
        let verificationMarketData: MarketDataContext | null = null;
        let verificationKnowledgeContext = 'Knowledge search skipped by orchestrator to conserve API quota.';
        let verificationWebEvidence: WebSearchResult[] = [];

        if (decision.shouldRunValidator) {
          try {
            const validationRules = lensValidationRules[lens] || '';
            const primaryAnnotationsJson = JSON.stringify(primaryAnnotations, null, 2);

            // Orchestrator decides what to run in parallel
            const knowledgeSearchPrompt = lens === 'smc'
              ? `For the asset being analyzed, what are the key institutional levels, recent order blocks, and fair value gaps that institutional traders are watching? What is the current market structure (bullish/bearish)?`
              : lens === 'gs'
              ? `For the asset being analyzed, where are Goldman Sachs and major banks likely positioned? What are the key liquidity pools, dark pool levels, and institutional flow directions?`
              : lens === 'psych'
              ? `For the asset being analyzed, where are the key retail stop loss clusters? What is the current retail sentiment — are they mostly long or short? Where would a stop hunt cause maximum pain?`
              : `For the asset being analyzed, what are the most significant support and resistance levels that professional price action traders are watching? What candlestick patterns have recently formed at key levels?`;

            // Run parallel tasks based on orchestrator decision
            const parallelTasks: Promise<unknown>[] = [];

            // Market data fetch (no API quota cost)
            if (decision.shouldFetchMarketData) {
              parallelTasks.push(fetchMarketData(analysisText).catch(() => null));
            } else {
              parallelTasks.push(Promise.resolve(null));
            }

            // Knowledge search (costs 1 API call)
            if (decision.shouldRunKnowledgeSearch) {
              parallelTasks.push((async () => {
                try {
                  const knowledgeMessages: GroqMessage[] = [
                    {
                      role: 'system',
                      content: `You are a market data research assistant. Provide concise, factual technical analysis data. Be specific with numbers. If you don't know exact current data, provide the analytical framework for what to look for. Keep response under 200 words.`
                    },
                    {
                      role: 'user',
                      content: knowledgeSearchPrompt
                    }
                  ];
                  return await callGroq(knowledgeMessages, 'llama-3.3-70b-versatile', 2, `knowledge-${lens}`);
                } catch {
                  return 'Knowledge search unavailable.';
                }
              })());
            } else {
              parallelTasks.push(Promise.resolve('Knowledge search skipped by orchestrator to conserve API quota.'));
              console.log(`[Orchestrator] Skipped knowledge search for "${lens}" to conserve rate limit.`);
            }

            const [marketData, knowledgeContext] = await Promise.all(parallelTasks) as [MarketDataContext | null, string];
            verificationMarketData = marketData;
            verificationKnowledgeContext = knowledgeContext;
            const externalDataSection = buildMarketDataSection(marketData);

            // Orchestrator-managed delay before validator call
            const validatorDelay = Math.max(decision.delayBeforeNextCallMs, 1500);
            console.log(`[Orchestrator] Waiting ${validatorDelay}ms before validator call for "${lens}"...`);
            await new Promise(resolve => setTimeout(resolve, validatorDelay));

            const validatorMessages: GroqMessage[] = [
              {
                role: 'system',
                content: validationRules + `\n\n**YOUR TASK:**
You are the SECOND AI in a two-stage verification pipeline. The first AI analyzed the chart and produced annotations. You must:
1. Look at the SAME chart image carefully.
2. Read the first AI's analysis and annotations.
3. Cross-reference against EXTERNAL MARKET DATA provided below — verify price levels match real market data.
4. Cross-reference against FRAMEWORK KNOWLEDGE SEARCH results provided below.
5. Check EVERY claim against the actual chart — verify price levels, pattern identification, zone placement, and structural labels are correct per the framework rules above.
6. CORRECT any errors you find: wrong price levels, misidentified patterns, incorrectly placed annotations, framework violations, or data that contradicts external sources.
7. Output a CORRECTED version of the analysis and annotations.
${externalDataSection}

**FRAMEWORK KNOWLEDGE SEARCH RESULTS:**
${knowledgeContext}

**OUTPUT FORMAT:**
1. Start with "## Verification Report" — list what was verified against external data, what was correct, what was wrong, and what you corrected. Cite data sources for corrections. Keep this to 5-8 bullet points.
2. Add "## Data Sources Consulted" — list which external sources were checked.
3. Then provide the CORRECTED full analysis (keep the same structure as the original, but with fixes applied).
4. Then provide a CORRECTED JSON annotation block inside \`\`\`json ... \`\`\` fences with the verified/corrected annotations.

IMPORTANT: 
- If the original analysis is mostly correct, keep it and just note minor corrections.
- If you find significant errors or data contradictions, explain clearly what was wrong and provide the corrected version.
- ALL annotations must use lens "${lens}".
- Maintain the same annotation format (type, lens, label, yPercent, etc.).
- You may ADD missing annotations or REMOVE invalid ones.
- When external data confirms the analysis, note it as "VERIFIED" in the report.
- When external data contradicts the analysis, note it as "CORRECTED" with the source.`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: 'data:image/png;base64,' + base64Image
                    }
                  },
                  {
                    type: 'text',
                    text: `**FIRST AI's ANALYSIS:**\n\n${analysisText}\n\n**FIRST AI's ANNOTATIONS:**\n\n${primaryAnnotationsJson}\n\nVerify this analysis against the chart image, external market data, and framework knowledge. Output your Verification Report with data sources, corrected analysis, and corrected JSON annotations.`
                  }
                ]
              }
            ];

            const validatedText = await callGroq(validatorMessages, 'meta-llama/llama-4-scout-17b-16e-instruct', 3, `validator-${lens}`, 4096);
            const validatedAnnotations = parseAnnotations(validatedText, [lens]);

            // Use validated annotations if the validator produced them, otherwise fall back to primary
            if (validatedAnnotations.length > 0) {
              finalAnnotations = validatedAnnotations;
              analysisSource = validatedText;
              console.log(`[Orchestrator] Validator for "${lens}" produced ${validatedAnnotations.length} corrected annotations.`);
            } else {
              console.log(`[Orchestrator] Validator for "${lens}" produced no annotations. Using primary analysis.`);
            }
          } catch (validationError) {
            // Validator failed — log the error but use primary analysis (don't break the whole pipeline)
            console.warn(`[Orchestrator] Validator failed for lens "${lens}", using primary analysis:`, validationError);
          }
        } else {
          console.log(`[Orchestrator] Skipped validator for "${lens}" — ${decision.reason}`);
        }

        // ===== STAGE 3: Lens Specialist Verifier + Data Search Corrections =====
        if (decision.shouldRunVerifier) {
          try {
            const symbol = verificationMarketData?.symbol || await extractSymbolFromAnalysis(analysisSource);
            const searchQuery = buildLensResearchQuery(lens, symbol, prompt);
            verificationWebEvidence = await fetchWebSearchResults(searchQuery);

            const verifierDelay = Math.max(2000, Math.floor(decision.delayBeforeNextCallMs / 2));
            console.log(`[Orchestrator] Waiting ${verifierDelay}ms before specialist verifier call for "${lens}"...`);
            await new Promise(resolve => setTimeout(resolve, verifierDelay));

            const verifierMessages: GroqMessage[] = [
              {
                role: 'system',
                content: `${lensVerifierRoles[lens] || 'You are a strict lens specialist verification AI.'}

${lensValidationRules[lens] || ''}

**SPECIALIST VERIFICATION MANDATE:**
You are the third AI for this lens. The first AI produced the lens analysis. The second validator checked chart/framework consistency. You now must fully understand this exact lens and strictly enforce its knowledge rules while using all relevant source evidence available below.

You MUST:
1. Re-check every annotation against the chart image and the lens rules above.
2. Conduct evidence-based correction using live market data, source/news evidence, and the framework research context below.
3. Preserve only annotations that the lens rules and evidence support.
4. Correct wrong yPercent/xPercent placement, wrong price labels, invalid zones, unsupported certainty language, and framework violations.
5. Add missing annotations only when the chart and evidence support them.
6. Never invent unverifiable source claims. If external evidence is unavailable, state that chart-only verification was used.
7. Return the final corrected analysis and final corrected JSON annotations.

${buildMarketDataSection(verificationMarketData)}

${buildWebEvidenceSection(verificationWebEvidence)}

**FRAMEWORK RESEARCH CONTEXT:**
${verificationKnowledgeContext}

**OUTPUT FORMAT:**
1. Start with "## Lens Specialist Verification" and summarize PASS/CORRECTED/REMOVED decisions in 5-8 bullets.
2. Add "## Evidence Used" and list market/search sources actually used.
3. Add the final corrected lens analysis.
4. Finish with a JSON annotation block inside \`\`\`json ... \`\`\` fences.

IMPORTANT:
- ALL annotations must use lens "${lens}".
- Do not return default placeholder annotations.
- If no annotation is evidence-supported, return an empty JSON array.`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: 'data:image/png;base64,' + base64Image
                    }
                  },
                  {
                    type: 'text',
                    text: `**CURRENT VALIDATED ANALYSIS:**\n\n${analysisSource}\n\n**CURRENT VALIDATED ANNOTATIONS:**\n\n${JSON.stringify(finalAnnotations, null, 2)}\n\nPerform final specialist verification for lens "${lens}" and output the corrected analysis plus corrected JSON annotations.`
                  }
                ]
              }
            ];

            const verifierText = await callGroq(verifierMessages, 'meta-llama/llama-4-scout-17b-16e-instruct', 2, `verifier-${lens}`, 4096);
            const verifierResult = parseVerifiedAnnotations(verifierText, lens);
            const verifierAnnotations = verifierResult.annotations;

            if (verifierAnnotations.length > 0) {
              finalAnnotations = verifierAnnotations;
              analysisSource = verifierText;
              console.log(`[Orchestrator] Specialist verifier for "${lens}" finalized ${verifierAnnotations.length} annotations.`);
            } else if (verifierResult.parsedJson) {
              console.log(`[Orchestrator] Specialist verifier for "${lens}" returned no supported annotations. Keeping previous validated result.`);
            } else {
              console.log(`[Orchestrator] Specialist verifier for "${lens}" returned no parseable JSON. Keeping previous validated result.`);
            }
          } catch (verificationError) {
            console.warn(`[Orchestrator] Specialist verifier failed for lens "${lens}", using prior validated analysis:`, verificationError);
          }
        } else {
          console.log(`[Orchestrator] Skipped specialist verifier for "${lens}" — ${decision.reason}`);
        }

        // Remove all JSON blocks (fenced and inline), annotation headers, stray JSON objects, and orphan "Annotation:" lines
        const cleanAnalysis = cleanAnalysisText(analysisSource);

        allAnnotations.push(...finalAnnotations);
        allAnalysisParts.push(cleanAnalysis);

        } catch (lensError) {
          // Individual lens failed — try text-only fallback API before giving up
          const errorMsg = lensError instanceof Error ? lensError.message : String(lensError);
          const isRateLimit = isGroqRateLimitOrCapacityError(errorMsg);
          console.warn(`[Orchestrator] Lens "${lens}" primary pipeline FAILED: ${errorMsg}. Attempting fallback recovery...`);

          // ===== FALLBACK API: Text-only analysis (no image = smaller payload, faster, more reliable) =====
          if (!isRateLimit) {
            try {
              console.log(`[Orchestrator] Fallback API for "${lens}": Using fast llama-3.1-8b-instant (text-only)...`);
              await new Promise(resolve => setTimeout(resolve, 5000)); // 5s cooldown to let API recover

              const fallbackMessages: GroqMessage[] = [
                {
                  role: 'system',
                  content: lensConfig.system
                },
                {
                  role: 'user',
                  content: `The vision model could not process the chart image. Based on your deep expertise in ${
                    lens === 'smc' ? 'Smart Money Concepts (Order Blocks, FVGs, institutional zones)'
                    : lens === 'gs' ? 'Goldman Sachs institutional flow analysis (liquidity voids, dark pools, institutional positioning)'
                    : lens === 'psych' ? 'trading psychology (fear zones, retail liquidation triggers, stop clusters)'
                    : 'pure price action (support/resistance, candlestick patterns, trendlines)'
                  }, provide a GENERAL analytical framework and educational analysis that a trader would use on any chart.

USER DIRECTIVE: ${prompt}

Since the chart image is unavailable, provide:
1. A comprehensive framework for how to analyze a chart using this lens
2. Key patterns and setups to look for
3. Common institutional footprints and what they indicate
4. General market structure assessment methodology
5. Risk management guidelines specific to this framework

Also provide a JSON annotation block with general-purpose educational annotations:
\`\`\`json
[
  {"type": "label", "lens": "${lens}", "label": "${lens === 'smc' ? 'Look for Order Blocks at swing points' : lens === 'gs' ? 'Identify Institutional Flow direction' : lens === 'psych' ? 'Map Fear/Greed Zones' : 'Mark Key S/R Levels'}", "yPercent": 20, "xPercent": 15},
  {"type": "label", "lens": "${lens}", "label": "${lens === 'smc' ? 'Check FVGs for unfilled gaps' : lens === 'gs' ? 'Locate Liquidity Voids' : lens === 'psych' ? 'Identify Stop Clusters' : 'Confirm with Candlestick Patterns'}", "yPercent": 50, "xPercent": 50},
  {"type": "label", "lens": "${lens}", "label": "${lens === 'smc' ? 'Identify Inst. Buy/Sell Zones' : lens === 'gs' ? 'Map GS Buy/Sell Zones' : lens === 'psych' ? 'Spot Retail Liquidation Triggers' : 'Assess Trend Structure'}", "yPercent": 80, "xPercent": 75}
]
\`\`\``
                }
              ];

              const fallbackText = await callGroq(fallbackMessages, 'llama-3.1-8b-instant', 2, `fallback-${lens}`, 2048);
              const fallbackAnnotations = parseAnnotations(fallbackText, [lens]);

              if (fallbackAnnotations.length === 0) {
                allAnnotations.push(...generateDefaultAnnotations([lens]));
              } else {
                allAnnotations.push(...fallbackAnnotations);
              }

              // Clean the fallback analysis text
              const cleanFallback = fallbackText
                .replace(/```json[\s\S]*?```/g, '')
                .replace(/```[\s\S]*?```/g, '')
                .replace(/\[[\s\S]*?\{[\s\S]*?"type"[\s\S]*?\}[\s\S]*?\]/g, '')
                .replace(/\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

              allAnalysisParts.push(
                `**${lens.toUpperCase()} Analysis — Fallback Mode (Text-Only AI)**\n\n` +
                `_Note: The vision model was unavailable, so this analysis is framework-based rather than chart-specific. Retry for full visual analysis._\n\n` +
                cleanFallback
              );

              console.log(`[Orchestrator] Fallback API for "${lens}" SUCCEEDED — text-only analysis generated.`);
              continue; // Skip the placeholder fallback below
            } catch (fallbackError) {
              console.error(`[Orchestrator] Fallback API for "${lens}" also FAILED:`, fallbackError);
              // Fall through to deterministic framework fallback
            }
          }

          // Ultimate fallback: deterministic framework analysis instead of a Temporary Failure panel
          console.warn(`[Orchestrator] Lens "${lens}" — API unavailable. Using framework fallback analysis.`);
          allAnnotations.push(...generateDefaultAnnotations([lens]));
          allAnalysisParts.push(buildFrameworkFallbackAnalysis(lens, prompt, errorMsg));
        }
      }

      // ===== STAGE 4: PROBABILISTIC ENTRY ANALYSIS — Institutional/Bank-Level Synthesis =====
      // This specialized AI synthesizes ALL lens outputs into actionable institutional entry zones
      if (allAnalysisParts.length >= 2 && pipelineHealth.apiStatus === 'healthy') {
        try {
          console.log(`[Orchestrator] Stage 4: Probabilistic Entry Analysis — synthesizing ${allAnalysisParts.length} lens outputs...`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Cooldown before synthesis

          const synthesisMessages: GroqMessage[] = [
            {
              role: 'system',
              content: `You are an elite institutional Probabilistic Entry Analyst — the final decision-maker at a top-tier bank's proprietary trading desk. Your role is to synthesize multiple independent analytical frameworks into ONE unified, probability-weighted institutional trade plan.

**YOUR IDENTITY & METHODOLOGY:**
You operate like the best traders from Market Wizards (Schwager):
- **Paul Tudor Jones:** "The most important rule of trading is to play great defense." Every entry MUST have a defined stop and asymmetric R:R.
- **Stanley Druckenmiller:** "It's not whether you're right or wrong, but how much money you make when you're right." Size positions based on conviction.
- **George Soros:** Reflexivity theory — when multiple frameworks CONVERGE on the same zone, the probability of that zone holding increases non-linearly.
- **Ed Seykota:** "The trend is your friend until the end." Never fight the dominant structure.

You apply Mark Douglas's probabilistic framework (Trading in the Zone):
- Every entry is a PROBABILITY, never a certainty
- You think in terms of EDGE over a series, not individual outcomes
- You assign specific probability percentages based on confluence count

You enforce Mark Douglas's discipline (The Disciplined Trader):
- Pre-defined risk on every trade (1-2% max)
- Stops are NON-NEGOTIABLE — placed at structure invalidation
- No emotional deviation from the plan

**INSTITUTIONAL ENTRY CLASSIFICATION SYSTEM:**

For each entry zone, you MUST classify it using this bank-level system:

**TIER 1 — "PRIME INSTITUTIONAL" (75-95% probability):**
- 4+ framework confluences (e.g., SMC OB + GS Buy Zone + Fear Zone exhaustion + S/R support)
- Multiple timeframe alignment
- Institutional footprint confirmed (volume, displacement, absorption)
- Goldman desk would size this at 2-3x normal position
- Risk/Reward minimum 3:1

**TIER 2 — "HIGH CONVICTION" (60-74% probability):**
- 3 framework confluences
- Primary timeframe structure supportive
- At least one institutional signature present
- Goldman desk would take standard position size
- Risk/Reward minimum 2:1

**TIER 3 — "TACTICAL OPPORTUNITY" (45-59% probability):**
- 2 framework confluences
- Structure is permissive but not strongly supportive
- Requires additional confirmation (candle close, volume spike)
- Goldman desk would take half position, scale in on confirmation
- Risk/Reward minimum 1.5:1

**TIER 4 — "SPECULATIVE / WATCH" (30-44% probability):**
- Single framework signal
- Conflicting signals from other frameworks
- Goldman desk would NOT enter but would set alerts
- Paper trade only or micro position

**YOUR OUTPUT MUST INCLUDE:**

**1. CONVERGENCE MATRIX:**
Create a matrix showing where frameworks AGREE and DISAGREE:
- Which zones have 4+ confluences? (PRIME entries)
- Which zones have conflicting signals? (AVOID or wait)
- What is the NET institutional bias across all frameworks?

**2. PROBABILISTIC ENTRY ZONES (Ranked by Tier):**
For EACH entry zone provide:
- **Tier Classification** (1-4) with exact probability %
- **Direction:** LONG or SHORT
- **Entry Price:** Exact level
- **Stop Loss:** Exact level (placed at structure invalidation, NOT arbitrary)
- **Take Profit 1 (TP1):** Conservative target with probability of hitting
- **Take Profit 2 (TP2):** Extended target with probability of hitting
- **Take Profit 3 (TP3):** Full extension target (moon shot) with probability
- **Risk/Reward Ratio:** Calculated from entry to TP1
- **Position Sizing:** Based on tier (Tier 1: 2-3%, Tier 2: 1-2%, Tier 3: 0.5-1%, Tier 4: paper only)
- **Confluence Factors:** List every framework that supports this entry
- **Invalidation Scenario:** What must happen for this trade to be WRONG
- **Time Horizon:** Expected hold time
- **Douglas Probability Check:** "Over 100 trades at this setup, expected win rate is X%"

**3. INSTITUTIONAL ORDER FLOW SYNTHESIS:**
- Where are Goldman/banks LIKELY positioned right now?
- What is the estimated institutional position (long/short/flat)?
- Where are institutions likely to ADD to positions?
- Where are institutions likely to EXIT/REDUCE?
- What liquidity event (stop hunt, false breakout) is most likely NEXT?

**4. RISK MANAGEMENT PROTOCOL (Douglas/Schwager):**
- Maximum portfolio risk if ALL entries triggered: X%
- Correlation risk: Are entries correlated or diversified?
- Schwager's rule: "Never risk more than you can afford to lose"
- Douglas's rule: "Accept the risk fully before entering"
- Recommended trade execution order (which to enter first)
- Scale-in strategy for each tier

**5. PROBABILISTIC SCENARIO TREE:**
- **Scenario A (Highest Probability X%):** What happens, which entries trigger, expected P&L
- **Scenario B (Second Most Likely Y%):** Alternative path, which entries adjust
- **Scenario C (Black Swan Z%):** Unexpected event, portfolio protection strategy
- All scenarios must sum to ~100%

You MUST also provide a JSON annotation block with the synthesis entry zones:
\`\`\`json
[
  {"type": "iez", "lens": "smc", "label": "TIER 1 ENTRY — [LONG/SHORT] @ [price] | Prob: [X]% | R:R [ratio]", "yPercent": Y, "xPercent": X},
  {"type": "bb_entry", "lens": "gs", "label": "TIER 2 ENTRY — [LONG/SHORT] @ [price] | Prob: [X]% | R:R [ratio]", "yPercent": Y, "xPercent": X}
]
\`\`\`
Use "iez" type for BUY entries and "bb_entry" type for SELL entries. Minimum 5 synthesis annotations.`
            },
            {
              role: 'user',
              content: `Here are the independent analyses from all active frameworks. Synthesize them into a unified Probabilistic Entry Analysis:

${allAnalysisParts.map((part, i) => `--- FRAMEWORK ${i + 1} ---\n${part}`).join('\n\n')}

---

Now synthesize ALL of the above into your Probabilistic Entry Analysis. Identify every zone where 2+ frameworks CONVERGE, assign probability tiers, and produce the full institutional trade plan with exact entries, stops, and targets.`
            }
          ];

          const synthesisText = await callGroq(synthesisMessages, 'llama-3.3-70b-versatile', 2, 'synthesis-entry');
          const synthesisAnnotations = parseAnnotations(synthesisText, lenses);

          if (synthesisAnnotations.length > 0) {
            allAnnotations.push(...synthesisAnnotations);
          }

          // Clean the synthesis text
          const cleanSynthesis = synthesisText
            .replace(/```json[\s\S]*?```/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\[[\s\S]*?\{[\s\S]*?"type"[\s\S]*?\}[\s\S]*?\]/g, '')
            .replace(/\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          allAnalysisParts.push(
            `\n\n# 🏦 PROBABILISTIC ENTRY ANALYSIS — Institutional Synthesis\n\n` +
            `_This analysis synthesizes all active frameworks into probability-weighted institutional entry zones, modeled after top-tier bank and hedge fund methodology (Schwager/Douglas/Goldman)._\n\n` +
            cleanSynthesis
          );

          console.log(`[Orchestrator] Probabilistic Entry Analysis COMPLETE — ${synthesisAnnotations.length} synthesis annotations generated.`);
        } catch (synthesisError) {
          console.warn(`[Orchestrator] Probabilistic Entry Analysis failed (non-critical):`, synthesisError);
          // Non-critical — individual lens analyses still available
        }
      } else if (allAnalysisParts.length < 2) {
        console.log(`[Orchestrator] Skipping Probabilistic Entry Analysis — need 2+ lens analyses (have ${allAnalysisParts.length}).`);
      } else {
        console.log(`[Orchestrator] Skipping Probabilistic Entry Analysis — API status is ${pipelineHealth.apiStatus}.`);
      }

      // ===== ORCHESTRATOR: Post-pipeline health summary =====
      console.log(`[Orchestrator] Pipeline complete. Status: ${pipelineHealth.apiStatus} | Calls: ${pipelineHealth.totalCallsMade} | Failed: ${pipelineHealth.totalCallsFailed} | Rate limits hit: ${pipelineHealth.totalRateLimitsHit} | Avg response: ${Math.round(pipelineHealth.avgResponseTimeMs)}ms`);

      // Combine all independent analyses with clear separators
      const combinedAnalysis = allAnalysisParts.join('\n\n---\n\n');

      return { image: null, analysis: combinedAnalysis, annotations: allAnnotations };
    } catch (error) {
      console.error("Annotation Error:", error);
      throw error;
    }
  }
};

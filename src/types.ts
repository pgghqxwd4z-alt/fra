export enum AnalysisTab {
  CHAT = 'Chat',
  VISUALIZER = 'Visualizer',
  STRATEGIES = 'Strategies',
  WISDOM = 'Wisdom',
  FRAMEWORK = 'Framework',
  TRACK_RECORD = 'Track Record'
}

export interface Message {
  role: 'user' | 'model';
  content: string;
  images?: string[];
  annotatedImage?: string;
  groundingMetadata?: GroundingChunk[];
  forecast?: ForecastResult;
  timestamp: number;
}

export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  coreConcepts: string[];
  source: string;
}

export interface BookInsight {
  title: string;
  author: string;
  keyThemes: string[];
  summary: string;
  icon: string;
}

export interface FrameworkStep {
  title: string;
  source: string;
  description: string;
  details: string[];
}

/* =========================================================
   FORECAST ENGINE
   ========================================================= */

export type MarketBias =
  | 'BULLISH'
  | 'BEARISH'
  | 'NEUTRAL';

export type TradeDirection =
  | 'BUY'
  | 'SELL'
  | 'WAIT';

export type LiquidityType =
  | 'BUY_SIDE'
  | 'SELL_SIDE'
  | 'UNKNOWN';

export interface LiquidityTarget {
  type: LiquidityType;
  level: string;
  reason: string;
}

export interface RetracementForecast {
  expected: boolean;
  zone: string;
  reason: string;
}

export interface EntryForecast {
  direction: TradeDirection;
  zone: string;
  confirmation: string;
}

export interface ForecastTargets {
  tp1: string;
  tp2: string;
  final: string;
}

export interface ForecastResult {
  currentState: string;

  bias: MarketBias;

  confidence: number;

  nextMove: string;

  expectedPath: string[];

  liquidityTarget: LiquidityTarget;

  retracement: RetracementForecast;

  entry: EntryForecast;

  targets: ForecastTargets;

  invalidation: string;

  primaryScenario: string;

  alternativeScenario: string;

  nextEvent: string;

  structuralEvidence: string[];

  warnings: string[];

  risk?: Risk;
  timestamp?: number;
}

export interface RiskTarget {
  reward: number | null;
  rr: number | null;
}

export interface Risk {
  parsed: boolean;
  entry?: number;
  invalidation?: number;
  risk?: number;
  targets?: {
    tp1?: RiskTarget;
    tp2?: RiskTarget;
    final?: RiskTarget;
  };
  warnings: string[];
}

export interface ConsensusModel {
  engine: string;
  model: string;
  bias: string;
  direction: string;
  confidence: number;
  tp1: string;
  invalidation: string;
  nextMove: string;
}

export interface Consensus {
  verdict: 'AGREE' | 'PARTIAL' | 'CONFLICT' | 'SINGLE' | 'MAJORITY';
  models: ConsensusModel[];
  biasAgreement: boolean;
  directionAgreement: boolean;
  confidenceSpread: number;
  notes: string;
  vote: {
    bias: string | null;
    direction: string | null;
    support: number;
    total: number;
  };
  selectedEngine: string | null;
  failures: {
    engine: string;
    error: string;
  }[];
}

export interface MarketVerification {
  source: 'oanda' | 'twelvedata' | 'yahoo';
  instrument: string;
  environment?: string;
  symbol?: string;
  proxy?: boolean;
  lastClose: number;
  asOf: string;
}

export interface MarketResearchHeadline {
  title: string;
  url?: string;
  publishedAt: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface MarketResearchEvent {
  name: string;
  whenUtc: string;
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface MarketResearch {
  asOf: string;
  label: string;
  biasSignal: 'SUPPORTS_BULLISH' | 'SUPPORTS_BEARISH' | 'MIXED' | 'NONE';
  headlines: MarketResearchHeadline[];
  upcomingEvents: MarketResearchEvent[];
  sources: {
    uri: string;
    title: string;
  }[];
}

export interface ForecastRecord {
  id: string;
  createdAt: string;
  instrument: string;
  bias: string;
  direction: string;
  confidence: number;
  referencePrice: number | null;
  feedSource: string | null;
  feedProxy: boolean;
  tp1: number | null;
  tp2: number | null;
  finalTarget: number | null;
  invalidation: number | null;
  status: string;
  unscorableReason: string | null;
  resolvedAt: string | null;
  resolvedPrice: number | null;
  maxFavorable: number | null;
  maxAdverse: number | null;
  scoredAt: string | null;
  engine: string | null;
  consensus: string | null;
}

export interface ForecastStats {
  totals: {
    logged: number;
    pending: number;
    unscorable: number;
    expired: number;
    ambiguous: number;
    wins: number;
    losses: number;
  };
  hitRate: number | null;
  sample: number;
  byInstrument: {
    instrument: string;
    wins: number;
    losses: number;
    hitRate: number | null;
  }[];
  byBias: {
    bias: string;
    wins: number;
    losses: number;
    hitRate: number | null;
  }[];
  byEngine: {
    engine: string;
    wins: number;
    losses: number;
    hitRate: number | null;
  }[];
  byConsensus: {
    verdict: string;
    wins: number;
    losses: number;
    hitRate: number | null;
  }[];
  calibration: {
    bucket: string;
    forecasts: number;
    wins: number;
    losses: number;
    hitRate: number | null;
    meanConfidence: number;
  }[];
  horizonHours: number;
  storage: {
    path: string;
    durable: boolean;
  };
}

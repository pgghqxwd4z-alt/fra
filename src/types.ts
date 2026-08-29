export enum AnalysisTab {
  CHAT = 'Chat',
  INVENTORY = 'Inventory',
  VISUALIZER = 'Visualizer',
  STRATEGIES = 'Strategies',
  WISDOM = 'Wisdom',
  FRAMEWORK = 'Framework'
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

export type MarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type TradeDirection = 'BUY' | 'SELL' | 'WAIT';

export type LiquidityType = 'BUY_SIDE' | 'SELL_SIDE' | 'UNKNOWN';

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
  timestamp?: number;
}

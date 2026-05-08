export enum AnalysisTab {
  CHAT = 'Chat',
  VISUALIZER = 'Visualizer',
  ROBOT_TRADER = 'Robot Trader',
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

export interface RobotMethodSignal {
  method: string;
  status: 'Aligned' | 'Warning' | 'Blocked';
  score: number;
  note: string;
}

export interface RobotTradePlan {
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  confidence: number;
  maxRiskPercent: number;
  verificationStatus: 'Verified' | 'Needs Review' | 'Data Stale';
  correctionAction: string;
  methods: RobotMethodSignal[];
}

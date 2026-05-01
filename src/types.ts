export enum AnalysisTab {
  CHAT = 'Chat',
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

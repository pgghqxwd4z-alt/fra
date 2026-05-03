export interface ChatMessage {
  id: string;
  sender: string;
  timestamp: string;
  text: string;
}

export interface ParticipantStats {
  name: string;
  messageCount: number;
  wordCount: number;
  averageMessageLength: number;
  [key: string]: string | number;
}

export interface NewsEvent {
  id: string;
  title: string;
  currency: string;
  impact: 'High' | 'Medium' | 'Low';
  time: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  sourceUrl?: string;
}

export interface NewsImpact {
  event: string;
  impactOnTechnicals: string;
  alignmentWithDouglas: string;
  recommendation: string;
}

export interface ImageAnnotation {
  type: 'BOS' | 'CHoCH' | 'OrderBlock' | 'Liquidity' | 'Support' | 'Resistance' | 'PsychologyZone';
  label: string;
  box_2d: [number, number, number, number];
  insight: string;
  source?: string;
}

export interface ManualDrawing {
  id: string;
  type: 'line' | 'rect' | 'circle' | 'text' | 'price-level';
  coords: [number, number][];
  label?: string;
  color: string;
}

export interface FrameworkInsight {
  framework: string;
  status: 'Aligned' | 'Violation' | 'Neutral';
  insight: string;
  source?: string;
}

export interface AnalysisResult {
  summary: string;
  keyTopics: string[];
  psychologyInsights: string;
  strategyCritique: string;
  marketWizardsPrinciples: string[];
  frameworks: FrameworkInsight[];
  disciplineScore: number;
  unresolvedQuestions: string[];
  suggestedActions: string[];
  annotations?: ImageAnnotation[];
  newsImpacts?: NewsImpact[];
}

export interface AnalyzedImage {
  id: string;
  url: string;
  analysis: AnalysisResult | null;
  isLoading: boolean;
  error?: string;
}

export type FeaturePermission = 'demoData' | 'newsTerminal' | 'transcriptAudit' | 'chartUpload' | 'masterAudit';

export type UserStatus = 'pending' | 'approved' | 'denied' | 'suspended';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  status: UserStatus;
  permissions: Record<FeaturePermission, boolean>;
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  suspensionReason?: string;
}

export interface ActivityEvent {
  id: string;
  userId?: string;
  userEmail?: string;
  type: string;
  details: string;
  createdAt: string;
}

export interface AuthSession {
  user: AdminUser;
}

export interface AdminState {
  users: AdminUser[];
  activities: ActivityEvent[];
}

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { 
  MessageSquare, TrendingUp, Upload,
  Trash2, LayoutDashboard, BrainCircuit, LineChart as ChartIcon, Shield, ImageIcon, Activity,
  ZoomIn, ZoomOut, RotateCcw, X, Fingerprint, Globe, Bell, ExternalLink,
  Lock, LogOut, UserCheck, Users, Ban, Clock, Settings
} from 'lucide-react';
import { ChatMessage, ParticipantStats, AnalysisResult, AnalyzedImage, NewsEvent, AdminState, FeaturePermission } from './types';
import { parseRawText, generateSampleData } from './utils/parser';
import { analyzeChatData, analyzeTradingImage, synthesizeGlobalAudit, fetchNewsCalendar } from './services/geminiService';
import { fetchSession, registerUser, loginUser, logoutUser, fetchAdminState, setUserStatus, setUserPermission } from './services/authService';
import { StatsCard } from './components/StatsCard';
import { AnalysisView } from './components/AnalysisView';
import { ChartAnnotator } from './components/ChartAnnotator';

const featureLabels: Record<FeaturePermission, string> = {
  demoData: 'Demo data',
  newsTerminal: 'News terminal',
  transcriptAudit: 'Transcript audit',
  chartUpload: 'Chart upload',
  masterAudit: 'Master audit'
};

const annotationTypes = ['BOS', 'CHoCH', 'OrderBlock', 'Liquidity', 'Support', 'Resistance', 'PsychologyZone'] as const;
type ChartAnnotation = NonNullable<AnalysisResult['annotations']>[number];

const fallbackAnnotationType = (text: string): ChartAnnotation['type'] => {
  const value = text.toLowerCase();
  if (value.includes('choch') || value.includes('character')) return 'CHoCH';
  if (value.includes('bos') || value.includes('break of structure')) return 'BOS';
  if (value.includes('order block') || value.includes('supply') || value.includes('demand')) return 'OrderBlock';
  if (value.includes('liquidity') || value.includes('sweep') || value.includes('inducement')) return 'Liquidity';
  if (value.includes('resistance') || value.includes('short')) return 'Resistance';
  if (value.includes('support') || value.includes('long')) return 'Support';
  return 'PsychologyZone';
};

const isValidBox = (box: unknown): box is [number, number, number, number] => (
  Array.isArray(box)
  && box.length === 4
  && box.every(value => typeof value === 'number' && Number.isFinite(value))
  && box[2] > box[0]
  && box[3] > box[1]
);

const normalizeBox = (box: [number, number, number, number]): [number, number, number, number] => {
  const [ymin, xmin, ymax, xmax] = box.map(value => Math.max(0, Math.min(1000, Math.round(value))));
  return [
    Math.min(ymin, ymax - 1),
    Math.min(xmin, xmax - 1),
    Math.max(ymax, ymin + 1),
    Math.max(xmax, xmin + 1)
  ];
};

const textToZoneBox = (text: string, index: number): [number, number, number, number] => {
  const value = text.toLowerCase();
  const row = index % 4;
  const bands: [number, number][] = [[60, 260], [280, 480], [500, 700], [720, 920]];
  if (value.includes('resistance') || value.includes('supply') || value.includes('short')) return [60, 90, 300, 910];
  if (value.includes('support') || value.includes('demand') || value.includes('long')) return [700, 90, 940, 910];
  if (value.includes('macro') || value.includes('news') || value.includes('risk')) return [120, 120, 880, 880];
  return [bands[row][0], 120, bands[row][1], 880];
};

const getEvidenceSource = (analysis: AnalysisResult, text: string): string => {
  const value = text.toLowerCase();
  const matchedNews = analysis.newsImpacts?.find(item => (
    value.includes(item.event.toLowerCase()) || item.event.toLowerCase().includes(value.slice(0, 24))
  ));
  if (matchedNews?.sourceUrl) return matchedNews.sourceUrl;
  const matchedDataSource = analysis.dataSources?.find(source => (
    value.includes(source.name.toLowerCase()) || source.usedFor.toLowerCase().split(/\W+/).some(token => token.length > 5 && value.includes(token))
  ));
  return matchedDataSource?.url || matchedDataSource?.name || 'Strict trading knowledge lens';
};

const getVerificationStatus = (source: string, evidence?: string): ChartAnnotation['verificationStatus'] => {
  if (!evidence) return source === 'Visual detection' ? 'Verified' : 'Unverified';
  return evidence.toLowerCase().includes('unverified') ? 'Unverified' : 'Verified';
};

const buildCompleteChartAnnotations = (analysis: AnalysisResult): ChartAnnotation[] => {
  const existing = (analysis.annotations || []).map((annotation, index) => {
    const text = `${annotation.type} ${annotation.label} ${annotation.insight}`;
    const type = annotationTypes.includes(annotation.type) ? annotation.type : fallbackAnnotationType(text);
    const source = annotation.source || 'Visual detection';
    return {
      ...annotation,
      type,
      label: annotation.label || `${type} finding ${index + 1}`,
      insight: annotation.insight || annotation.label || 'AI chart finding',
      box_2d: normalizeBox(isValidBox(annotation.box_2d) ? annotation.box_2d : textToZoneBox(text, index)),
      source,
      evidence: annotation.evidence || 'Visible chart structure from uploaded image',
      evidenceSource: annotation.evidenceSource || getEvidenceSource(analysis, text),
      verificationStatus: annotation.verificationStatus || getVerificationStatus(source, annotation.evidence || 'Visible chart structure from uploaded image'),
      correction: annotation.correction || ''
    };
  });

  const derived = [
    ...analysis.frameworks.map(item => ({
      type: fallbackAnnotationType(`${item.framework} ${item.insight}`),
      label: item.framework,
      insight: `${item.status}: ${item.insight}`,
      source: 'Grounding Matrix',
      evidence: item.evidence || item.source || 'Strict trading framework alignment check',
      evidenceSource: item.source || getEvidenceSource(analysis, `${item.framework} ${item.insight}`),
      verificationStatus: getVerificationStatus('Grounding Matrix', item.evidence || item.source),
      correction: ''
    })),
    ...(analysis.newsImpacts || []).map(item => ({
      type: fallbackAnnotationType(`${item.event} ${item.impactOnTechnicals} ${item.recommendation}`),
      label: item.event,
      insight: `${item.impactOnTechnicals} ${item.recommendation}`,
      source: 'Macro Impact',
      evidence: item.alignmentWithDouglas,
      evidenceSource: item.sourceUrl || getEvidenceSource(analysis, item.event),
      verificationStatus: getVerificationStatus('Macro Impact', item.alignmentWithDouglas),
      correction: ''
    })),
    ...analysis.suggestedActions.map((item, index) => ({
      type: fallbackAnnotationType(item),
      label: `Action ${index + 1}`,
      insight: item,
      source: 'Suggested Action',
      evidence: analysis.verificationSummary || 'Derived from verified audit findings',
      evidenceSource: getEvidenceSource(analysis, item),
      verificationStatus: getVerificationStatus('Suggested Action', analysis.verificationSummary),
      correction: ''
    }))
  ].map((item, index) => ({
    ...item,
    box_2d: textToZoneBox(`${item.label} ${item.insight}`, existing.length + index)
  }));

  const seen = new Set<string>();
  return [...existing, ...derived].filter(annotation => {
    const key = `${annotation.source}|${annotation.label}|${annotation.insight}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const featureList = Object.keys(featureLabels) as FeaturePermission[];

const App: React.FC = () => {
  const [sessionUser, setSessionUser] = useState<Awaited<ReturnType<typeof fetchSession>>['user'] | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [adminState, setAdminState] = useState<AdminState | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [, setIsAnalyzingChat] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isFetchingNews, setIsFetchingNews] = useState(false);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [aiError, setAiError] = useState('');
  const [chatAnalysis, setChatAnalysis] = useState<AnalysisResult | null>(null);
  const [masterAuditConclusion, setMasterAuditConclusion] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'messages' | 'charts' | 'news'>('overview');
  const [textZoom, setTextZoom] = useState(1);
  
  const [analyzedImages, setAnalyzedImages] = useState<AnalyzedImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    fetchSession()
      .then(({ user }) => setSessionUser(user))
      .catch(() => setSessionUser(null))
      .finally(() => setIsAuthLoading(false));
  }, []);

  const hasPermission = useCallback((permission: FeaturePermission) => Boolean(sessionUser?.permissions?.[permission]), [sessionUser]);

  const handleFetchNews = useCallback(async () => {
    if (!hasPermission('newsTerminal')) return;
    setIsFetchingNews(true);
    setAiError('');
    try {
      const data = await fetchNewsCalendar();
      setNews(data);
    } catch (error) {
      console.error("Failed to fetch news", error);
      setAiError(error instanceof Error ? error.message : 'Failed to fetch macro news');
    } finally {
      setIsFetchingNews(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    if (sessionUser && hasPermission('newsTerminal')) {
      handleFetchNews();
    }
  }, [sessionUser, hasPermission, handleFetchNews]);

  useEffect(() => {
    if (sessionUser?.role === 'admin' && isAdminOpen) {
      fetchAdminState().then(setAdminState).catch(error => setAuthError(error.message));
    }
  }, [sessionUser, isAdminOpen]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasPermission('chartUpload')) return;
    const files = event.target.files;
    if (!files) return;

    const fileList = Array.from(files) as File[];
    const imageFiles = fileList.filter((f: File) => f.type.startsWith('image/'));
    const textFiles = fileList.filter((f: File) => !f.type.startsWith('image/'));

    if (imageFiles.length > 0) {
      const startIndex = analyzedImages.length;
      const newImages: AnalyzedImage[] = imageFiles.map((file: File, idx: number) => ({
        id: `img-${Date.now()}-${idx}`,
        url: URL.createObjectURL(file),
        analysis: null,
        isLoading: true,
        error: undefined
      }));

      setAnalyzedImages(prev => [...prev, ...newImages]);
      setActiveTab('charts');
      setSelectedImageIndex(startIndex);

      imageFiles.forEach((file: File, idx: number) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64 = (e.target?.result as string).split(',')[1];
          setAiError('');
          try {
            const result = await analyzeTradingImage(base64, file.type, news);
            const completeResult = {
              ...result,
              annotations: buildCompleteChartAnnotations(result)
            };
            setAnalyzedImages(prev => prev.map(img => 
              img.id === newImages[idx].id ? { ...img, analysis: completeResult, isLoading: false, error: undefined } : img
            ));
          } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'Chart AI detection failed';
            setAiError(message);
            setAnalyzedImages(prev => prev.map(img => 
              img.id === newImages[idx].id ? { ...img, isLoading: false, error: message } : img
            ));
          }
        };
        reader.readAsDataURL(file);
      });
    }

    if (textFiles.length > 0) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const parsedMessages = parseRawText(text);
        if (parsedMessages.length > 0) {
          setMessages(parsedMessages);
          setChatAnalysis(null);
          if (imageFiles.length === 0) setActiveTab('overview');
        }
      };
      reader.readAsText(textFiles[0]);
    }
  };

  const handleRemoveImage = (id: string, index: number) => {
    if (confirm("Remove this image and its analysis?")) {
      const imageToRemove = analyzedImages.find(img => img.id === id);
      if (imageToRemove) URL.revokeObjectURL(imageToRemove.url);
      const updatedImages = analyzedImages.filter(img => img.id !== id);
      setAnalyzedImages(updatedImages);
      if (updatedImages.length === 0) {
        if (!chatAnalysis) setActiveTab('overview');
      } else if (selectedImageIndex >= updatedImages.length) {
        setSelectedImageIndex(Math.max(0, updatedImages.length - 1));
      } else if (index === selectedImageIndex) {
        setSelectedImageIndex(Math.min(index, updatedImages.length - 1));
      }
    }
  };

  const resetAuditContext = () => {
    if (confirm("Permanently wipe session context?")) {
      analyzedImages.forEach(img => URL.revokeObjectURL(img.url));
      setMessages([]);
      setAnalyzedImages([]);
      setChatAnalysis(null);
      setMasterAuditConclusion(null);
      setAiError('');
      setActiveTab('overview');
    }
  };

  const startChatAnalysis = async () => {
    if (messages.length === 0 || !hasPermission('transcriptAudit')) return;
    setIsAnalyzingChat(true);
    setAiError('');
    try {
      const result = await analyzeChatData(messages, news);
      setChatAnalysis(result);
      setActiveTab('analysis');
    } catch (error) {
      console.error(error);
      setAiError(error instanceof Error ? error.message : 'Transcript AI audit failed');
    } finally {
      setIsAnalyzingChat(false);
    }
  };

  const startMasterSynthesis = async () => {
    if (!hasPermission('masterAudit')) return;
    const results: AnalysisResult[] = [];
    if (chatAnalysis) results.push(chatAnalysis);
    analyzedImages.forEach(img => {
      if (img.analysis) results.push(img.analysis);
    });

    if (results.length === 0) return;

    setIsSynthesizing(true);
    setAiError('');
    try {
      const finalAudit = await synthesizeGlobalAudit(results);
      setMasterAuditConclusion(finalAudit);
      setActiveTab('analysis');
    } catch (error) {
      console.error("Master synthesis failed", error);
      setAiError(error instanceof Error ? error.message : 'Master AI audit failed');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const adjustZoom = (delta: number) => {
    setTextZoom(prev => Math.min(Math.max(prev + delta, 0.7), 2.0));
  };

  const participantStats = useMemo(() => {
    const stats: Record<string, ParticipantStats> = {};
    messages.forEach(msg => {
      if (!stats[msg.sender]) {
        stats[msg.sender] = { name: msg.sender, messageCount: 0, wordCount: 0, averageMessageLength: 0 };
      }
      stats[msg.sender].messageCount++;
      stats[msg.sender].wordCount += msg.text.split(/\s+/).length;
    });
    return Object.values(stats).sort((a, b) => b.messageCount - a.messageCount);
  }, [messages]);

  const currentImage = analyzedImages[selectedImageIndex];

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthMessage('');
    try {
      if (authMode === 'register') {
        const result = await registerUser(authName, authEmail, authPassword);
        setAuthMessage(result.message);
        setAuthMode('login');
      } else {
        const result = await loginUser(authEmail, authPassword);
        setSessionUser(result.user);
        setAuthPassword('');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed');
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setSessionUser(null);
    setAdminState(null);
    setIsAdminOpen(false);
  };

  const refreshAdminState = async () => {
    if (sessionUser?.role !== 'admin') return;
    setAdminState(await fetchAdminState());
  };

  const updateStatus = async (userId: string, status: 'pending' | 'approved' | 'denied' | 'suspended') => {
    const reason = status === 'suspended' ? prompt('Reason for suspension?') || 'Suspended by admin' : '';
    setAdminState(await setUserStatus(userId, status, reason));
  };

  const updatePermission = async (userId: string, permission: FeaturePermission, enabled: boolean) => {
    setAdminState(await setUserPermission(userId, permission, enabled));
  };

  const displayAnalysis = useMemo(() => {
    if (masterAuditConclusion) return masterAuditConclusion;

    const allResults: AnalysisResult[] = [];
    if (chatAnalysis) allResults.push({ ...chatAnalysis, frameworks: chatAnalysis.frameworks.map(f => ({ ...f, source: 'Chat Log' })) });
    analyzedImages.forEach((img, idx) => {
      if (img.analysis) {
        allResults.push({ ...img.analysis, frameworks: img.analysis.frameworks.map(f => ({ ...f, source: `Chart ${idx + 1}` })) });
      }
    });

    if (allResults.length === 0) return null;
    if (allResults.length === 1) return allResults[0];

    return {
      summary: `Aggregated data from ${allResults.length} sources. Trigger 'Deep Reasoning Audit' for a macro-aware institutional synthesis.`,
      keyTopics: [...new Set(allResults.flatMap(r => r.keyTopics))],
      psychologyInsights: allResults.map((r, i) => `[Audit ${i+1}] ${r.psychologyInsights}`).join('\n\n'),
      strategyCritique: allResults.map((r, i) => `[Audit ${i+1}] ${r.strategyCritique}`).join('\n\n'),
      marketWizardsPrinciples: [...new Set(allResults.flatMap(r => r.marketWizardsPrinciples))],
      frameworks: allResults.flatMap(r => r.frameworks),
      newsImpacts: allResults.flatMap(r => r.newsImpacts || []),
      disciplineScore: Math.round(allResults.reduce((acc, r) => acc + r.disciplineScore, 0) / allResults.length),
      unresolvedQuestions: [...new Set(allResults.flatMap(r => r.unresolvedQuestions))],
      suggestedActions: [...new Set(allResults.flatMap(r => r.suggestedActions))],
      annotations: allResults.flatMap(r => r.annotations || [])
    } as AnalysisResult;
  }, [chatAnalysis, analyzedImages, masterAuditConclusion]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-white border-t-transparent" />
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white text-slate-900 rounded-[2rem] p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white">
              <Lock size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black">TradeQuant Access</h1>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-600">Approval required</p>
            </div>
          </div>
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <input value={authName} onChange={event => setAuthName(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold" placeholder="Full name" />
            )}
            <input value={authEmail} onChange={event => setAuthEmail(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold" placeholder="Email" type="email" />
            <input value={authPassword} onChange={event => setAuthPassword(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold" placeholder="Password" type="password" />
            {authError && <div className="rounded-2xl bg-rose-50 text-rose-700 text-xs font-bold p-4">{authError}</div>}
            {authMessage && <div className="rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-bold p-4">{authMessage}</div>}
            <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-3 font-black">
              {authMode === 'register' ? 'Request Registration Approval' : 'Sign In'}
            </button>
          </form>
          <button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }} className="w-full mt-5 text-xs font-black uppercase tracking-widest text-slate-500">
            {authMode === 'login' ? 'Need access? Register' : 'Already approved? Sign in'}
          </button>
          <p className="mt-6 text-[11px] text-slate-400 leading-relaxed">
            The first registered account becomes the administrator. Later accounts stay pending until approved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-inter">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-[60] px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Activity size={24} />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">TradeQuant Pro</h1>
            <p className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">Macro Reasoning Auditor</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-sm font-black text-slate-800">{sessionUser.name}</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{sessionUser.role}</span>
          </div>
          {sessionUser.role === 'admin' && (
            <button onClick={() => { setIsAdminOpen(prev => !prev); if (!isAdminOpen) refreshAdminState(); }} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all">
              <Settings size={16} /> Admin
            </button>
          )}
          <button onClick={handleLogout} className="p-2.5 bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-xl transition-all">
            <LogOut size={18} />
          </button>
          <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
            <button onClick={() => adjustZoom(-0.1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg text-slate-500 transition-all"><ZoomOut size={16} /></button>
            <span className="px-2 text-[10px] font-bold text-slate-400 w-12 text-center">{Math.round(textZoom * 100)}%</span>
            <button onClick={() => adjustZoom(0.1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg text-slate-500 transition-all"><ZoomIn size={16} /></button>
            <button onClick={() => setTextZoom(1)} className="ml-1 p-1.5 hover:bg-white hover:shadow-sm rounded-lg text-slate-400 transition-all border-l border-slate-200"><RotateCcw size={14} /></button>
          </div>

          <div className="flex items-center gap-3">
            {displayAnalysis && (
              <button 
                onClick={startMasterSynthesis}
                disabled={isSynthesizing || !hasPermission('masterAudit')}
                className="hidden lg:flex items-center gap-2 bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md shadow-slate-200 disabled:opacity-50 border border-slate-700"
              >
                {isSynthesizing ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    <span>Cross-Reasoning Macro...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Fingerprint size={18} className="text-emerald-400" />
                    <span>Master Audit</span>
                  </div>
                )}
              </button>
            )}
            <label className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md ${hasPermission('chartUpload') ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-indigo-100' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
              <Upload size={18} />
              <span className="hidden sm:inline">Bulk Import</span>
              <input type="file" className="hidden" multiple accept=".txt,.json,image/*" onChange={handleFileUpload} disabled={!hasPermission('chartUpload')} />
            </label>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 lg:p-10 max-w-[1600px] mx-auto w-full">
        {aiError && (
          <div className="mb-6 rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700 shadow-sm flex items-start justify-between gap-4">
            <span>{aiError}</span>
            <button onClick={() => setAiError('')} className="text-rose-400 hover:text-rose-700">
              <X size={16} />
            </button>
          </div>
        )}

        {isAdminOpen && sessionUser.role === 'admin' && (
          <section className="mb-8 bg-white rounded-[2rem] border border-emerald-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2"><Users size={24} className="text-emerald-600" /> Admin Control Center</h2>
                <p className="text-sm text-slate-500 font-medium">Approve registrations, suspend users, set feature permissions, and monitor activity.</p>
              </div>
              <button onClick={refreshAdminState} className="text-xs font-black uppercase tracking-widest text-emerald-600">Refresh</button>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 space-y-4">
                {adminState?.users.map(user => (
                  <div key={user.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="font-black text-slate-900">{user.name}</h3>
                        <p className="text-xs text-slate-500 font-bold">{user.email}</p>
                        <div className="flex gap-2 mt-2">
                          <span className="text-[10px] font-black uppercase bg-white border border-slate-200 px-2 py-1 rounded-lg">{user.role}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg ${user.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : user.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{user.status}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => updateStatus(user.id, 'approved')} className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black flex items-center gap-1"><UserCheck size={14} /> Approve</button>
                        <button onClick={() => updateStatus(user.id, 'suspended')} className="px-3 py-2 bg-rose-600 text-white rounded-xl text-xs font-black flex items-center gap-1"><Ban size={14} /> Suspend</button>
                        <button onClick={() => updateStatus(user.id, 'denied')} className="px-3 py-2 bg-slate-800 text-white rounded-xl text-xs font-black">Deny</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                      {featureList.map(permission => (
                        <label key={permission} className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 p-3 text-[11px] font-black text-slate-600">
                          <input type="checkbox" checked={user.permissions[permission]} onChange={event => updatePermission(user.id, permission, event.target.checked)} />
                          {featureLabels[permission]}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-950 text-white rounded-3xl p-5 max-h-[42rem] overflow-y-auto custom-scrollbar">
                <h3 className="font-black uppercase tracking-widest text-xs mb-4 flex items-center gap-2"><Clock size={16} /> User Monitoring</h3>
                <div className="space-y-3">
                  {adminState?.activities.map(activity => (
                    <div key={activity.id} className="bg-white/5 rounded-2xl p-4 border border-white/10">
                      <div className="text-[10px] text-indigo-300 font-black uppercase">{activity.type}</div>
                      <div className="text-xs font-bold mt-1">{activity.details}</div>
                      <div className="text-[10px] text-slate-400 mt-2">{activity.userEmail || 'System'} · {new Date(activity.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
        {messages.length === 0 && analyzedImages.length === 0 ? (
          <div className="h-[70vh] flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 bg-slate-100 text-indigo-600 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-inner">
              <Globe size={48} />
            </div>
            <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">Forex Factory Awareness.</h2>
            <p className="text-slate-500 max-w-xl mb-10 text-lg leading-relaxed">
              Upload your <strong>chart screenshots</strong> and <strong>Discord logs</strong>. 
              Our reasoning engine cross-references the <strong>Forex Factory Calendar</strong> to ensure your SMC/Price Action setups survive high-impact volatility.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button disabled={!hasPermission('demoData')} onClick={() => { setMessages(generateSampleData()); setActiveTab('overview'); }} className="bg-white hover:bg-slate-50 text-slate-700 px-10 py-4 rounded-2xl font-bold border border-slate-200 shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">Try Demo Data</button>
              <label className={`px-10 py-4 rounded-2xl font-bold transition-all shadow-xl flex items-center justify-center gap-2 ${hasPermission('chartUpload') ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 cursor-pointer' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                <ImageIcon size={20} /> Bulk Import Files
                <input type="file" className="hidden" multiple accept=".txt,.json,image/*" onChange={handleFileUpload} disabled={!hasPermission('chartUpload')} />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-10" style={{ fontSize: `${textZoom}rem` }}>
            <div className="flex p-1.5 bg-slate-200/60 rounded-2xl w-full max-w-5xl mx-auto backdrop-blur-sm border border-slate-200/50">
              <button onClick={() => setActiveTab('overview')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                <LayoutDashboard size={18} /> Dashboard
              </button>
              <button disabled={!hasPermission('newsTerminal')} onClick={() => setActiveTab('news')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${activeTab === 'news' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                <Globe size={18} /> News Terminal
              </button>
              {analyzedImages.length > 0 && (
                <button onClick={() => setActiveTab('charts')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'charts' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                  <ChartIcon size={18} /> Charts
                </button>
              )}
              {messages.length > 0 && (
                <button onClick={() => setActiveTab('messages')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'messages' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                  <MessageSquare size={18} /> Transcript
                </button>
              )}
              {displayAnalysis && (
                <button onClick={() => setActiveTab('analysis')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'analysis' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Fingerprint size={18} /> Audit Suite
                </button>
              )}
            </div>

            {activeTab === 'news' && (
              <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-wider">
                      <Globe className="text-indigo-600" size={24} />
                      Forex Factory Calendar
                    </h3>
                    <button onClick={handleFetchNews} disabled={isFetchingNews || !hasPermission('newsTerminal')} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all disabled:opacity-40">
                      <RotateCcw size={20} className={isFetchingNews ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  <div className="space-y-4">
                    {news.length === 0 ? (
                      <div className="text-center py-20 text-slate-400 font-medium italic">No news data fetched. Check connection.</div>
                    ) : (
                      news.map(event => (
                        <div key={event.id} className="flex items-center gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100 hover:border-indigo-300 transition-all group hover:shadow-xl hover:shadow-slate-200/50">
                          <div className={`w-2.5 h-16 rounded-full shrink-0 ${event.impact === 'High' ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]' : event.impact === 'Medium' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[11px] font-black text-indigo-600 uppercase tracking-widest bg-white px-2 py-0.5 rounded-md border border-slate-200">{event.time}</span>
                              <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest">{event.currency}</span>
                              {event.impact === 'High' && <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest animate-pulse flex items-center gap-1"><Bell size={10} /> CRITICAL</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-black text-slate-800 text-base group-hover:text-indigo-600 transition-colors truncate">{event.title}</h4>
                                {event.sourceUrl && (
                                  <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700 transition-colors" title="View Source">
                                    <ExternalLink size={14} />
                                  </a>
                                )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-10 shrink-0">
                            <div className="flex flex-col items-center min-w-[70px]">
                              <span className="text-slate-400 uppercase text-[9px] font-black tracking-widest mb-1.5">Actual</span>
                              <div className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${event.actual ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-200 text-slate-400'}`}>
                                {event.actual || '---'}
                              </div>
                            </div>
                            <div className="flex flex-col items-center min-w-[70px]">
                              <span className="text-slate-400 uppercase text-[9px] font-black tracking-widest mb-1.5">Forecast</span>
                              <div className="px-4 py-2 rounded-xl text-sm font-black bg-white border border-slate-200 text-slate-700">
                                {event.forecast || '---'}
                              </div>
                            </div>
                            <div className="flex flex-col items-center min-w-[70px]">
                              <span className="text-slate-400 uppercase text-[9px] font-black tracking-widest mb-1.5">Previous</span>
                              <div className="px-4 py-2 rounded-xl text-sm font-black bg-white border border-slate-200 text-slate-500">
                                {event.previous || '---'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'charts' && analyzedImages.length > 0 && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar px-2">
                  {analyzedImages.map((img, idx) => (
                    <div key={img.id} className="relative shrink-0 group">
                      <button 
                        onClick={() => setSelectedImageIndex(idx)}
                        className={`relative w-36 h-24 rounded-2xl overflow-hidden border-2 transition-all transform hover:scale-105 ${selectedImageIndex === idx ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-2xl z-10' : 'border-transparent opacity-50 grayscale hover:grayscale-0 hover:opacity-100'}`}
                      >
                        <img src={img.url} className="w-full h-full object-cover" />
                        {img.isLoading && <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center"><div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full" /></div>}
                        {img.error && <div className="absolute inset-0 bg-rose-950/70 flex items-center justify-center text-white"><X size={22} /></div>}
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRemoveImage(img.id, idx); }}
                        className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-md hover:bg-rose-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="w-full">
                  {currentImage && (
                    <div className="flex flex-col gap-10">
                      <div className="h-[70vh]">
                        <ChartAnnotator imageUrl={currentImage.url} annotations={currentImage.analysis?.annotations || []} />
                      </div>
                      {!currentImage.isLoading && currentImage.error && (
                        <div className="max-w-5xl mx-auto w-full rounded-3xl border border-rose-100 bg-rose-50 p-6 text-sm font-bold text-rose-700">
                          Chart AI detection failed: {currentImage.error}
                        </div>
                      )}
                      {!currentImage.isLoading && currentImage.analysis && (
                        <div className="max-w-5xl mx-auto w-full">
                          <AnalysisView analysis={currentImage.analysis} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'analysis' && displayAnalysis && (
              <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-500">
                <div className="flex items-center gap-4 mb-10">
                  <div className="h-px flex-1 bg-slate-200" />
                  <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">
                    {masterAuditConclusion ? 'DEEP REASONING MASTER AUDIT' : 'SESSION MACRO AUDIT'}
                  </h2>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <AnalysisView analysis={displayAnalysis} isGlobal={true} isSynthesized={!!masterAuditConclusion} />
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col animate-in fade-in duration-500">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><MessageSquare size={20} /></div>
                    <div>
                      <h3 className="font-bold text-slate-800">Raw Transcript Log</h3>
                      <p className="text-xs text-slate-500">{messages.length} messages parsed</p>
                    </div>
                  </div>
                  <button onClick={startChatAnalysis} disabled={!hasPermission('transcriptAudit')} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    <BrainCircuit size={14} /> Audit Messages
                  </button>
                </div>
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  {messages.map((msg) => (
                    <div key={msg.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">{msg.sender}</span>
                        <span className="text-[9px] text-slate-300 font-mono">{msg.timestamp}</span>
                      </div>
                      <div className="bg-slate-50/80 p-4 rounded-2xl rounded-tl-none border border-slate-100 text-sm text-slate-600 leading-relaxed group relative">
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatsCard label="Visual Assets" value={analyzedImages.length} icon={<ImageIcon size={20} />} />
                  <StatsCard label="Macro Events" value={news.length} icon={<Globe size={20} />} />
                  <StatsCard label="Audit Confidence" value={displayAnalysis ? `${displayAnalysis.disciplineScore}%` : '---'} icon={<Shield size={20} />} description="Macro Aware Reasoning" />
                  <StatsCard label="Engine Load" value={isSynthesizing ? 'High (Reasoning)' : 'Idle'} icon={<Fingerprint size={20} />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-8">
                      <TrendingUp size={22} className="text-emerald-500" /> Interaction Heatmap
                    </h3>
                    <div className="h-80 w-full">
                      <ResponsiveContainer>
                        <BarChart data={participantStats}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                          <Bar dataKey="messageCount" fill="#6366f1" radius={[8, 8, 0, 0]} barSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 h-full overflow-hidden flex flex-col">
                    <h3 className="text-xl font-bold text-slate-800 mb-8 flex items-center gap-2">
                      <Bell size={18} className="text-rose-500" />
                      Critical Alerts
                    </h3>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
                      {news.filter(n => n.impact === 'High').map(n => (
                        <div key={n.id} className="p-4 bg-rose-50 rounded-2xl border border-rose-100">
                          <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">{n.time}</span>
                          <h4 className="font-bold text-slate-800 text-sm mt-1">{n.title}</h4>
                          <p className="text-[10px] text-rose-500 font-bold mt-1">Institutional Volatility Risk High</p>
                        </div>
                      ))}
                      {news.filter(n => n.impact === 'High').length === 0 && (
                        <div className="text-xs text-slate-400 italic text-center py-20">No high impact news today.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex justify-center pt-20 pb-12">
              <button onClick={resetAuditContext} className="group text-slate-400 hover:text-rose-500 font-bold text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all">
                <div className="p-2 rounded-lg group-hover:bg-rose-50 transition-colors"><Trash2 size={16} /></div> Reset Audit Context
              </button>
            </div>
          </div>
        )}
      </main>
      
      <footer className="py-10 px-6 border-t border-slate-200 bg-white/50 backdrop-blur-md text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Globe size={14} className="text-indigo-600" />
          <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">TradeQuant Macro Engine</span>
        </div>
        <p className="text-[9px] text-slate-400 max-w-lg mx-auto leading-relaxed">
          Grounding: "Market Wizards" (Schwager), "Trading in the Zone" (Douglas), Goldman Institutional Macro.
          Forex Factory Data Integration Enabled via Reasoning Engine.
        </p>
      </footer>
    </div>
  );
};

export default App;
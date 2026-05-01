import React, { useState, useMemo, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { 
  MessageSquare, TrendingUp, Upload,
  Trash2, LayoutDashboard, BrainCircuit, LineChart as ChartIcon, Shield, ImageIcon, Activity,
  ZoomIn, ZoomOut, RotateCcw, X, Fingerprint, Globe, Bell, ExternalLink
} from 'lucide-react';
import { ChatMessage, ParticipantStats, AnalysisResult, AnalyzedImage, NewsEvent } from './types';
import { parseRawText, generateSampleData } from './utils/parser';
import { analyzeChatData, analyzeTradingImage, synthesizeGlobalAudit, fetchNewsCalendar } from './services/geminiService';
import { StatsCard } from './components/StatsCard';
import { AnalysisView } from './components/AnalysisView';
import { ChartAnnotator } from './components/ChartAnnotator';

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAnalyzingChat, setIsAnalyzingChat] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isFetchingNews, setIsFetchingNews] = useState(false);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [chatAnalysis, setChatAnalysis] = useState<AnalysisResult | null>(null);
  const [masterAuditConclusion, setMasterAuditConclusion] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'messages' | 'charts' | 'news'>('overview');
  const [textZoom, setTextZoom] = useState(1);
  
  const [analyzedImages, setAnalyzedImages] = useState<AnalyzedImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    handleFetchNews();
  }, []);

  const handleFetchNews = async () => {
    setIsFetchingNews(true);
    try {
      const data = await fetchNewsCalendar();
      setNews(data);
    } catch (error) {
      console.error("Failed to fetch news", error);
    } finally {
      setIsFetchingNews(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
        isLoading: true
      }));

      setAnalyzedImages(prev => [...prev, ...newImages]);
      setActiveTab('charts');
      setSelectedImageIndex(startIndex);

      imageFiles.forEach((file: File, idx: number) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64 = (e.target?.result as string).split(',')[1];
          try {
            const result = await analyzeTradingImage(base64, file.type, news);
            setAnalyzedImages(prev => prev.map(img => 
              img.id === newImages[idx].id ? { ...img, analysis: result, isLoading: false } : img
            ));
          } catch (error) {
            console.error(error);
            setAnalyzedImages(prev => prev.map(img => 
              img.id === newImages[idx].id ? { ...img, isLoading: false } : img
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
      setActiveTab('overview');
    }
  };

  const startChatAnalysis = async () => {
    if (messages.length === 0) return;
    setIsAnalyzingChat(true);
    try {
      const result = await analyzeChatData(messages, news);
      setChatAnalysis(result);
      setActiveTab('analysis');
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzingChat(false);
    }
  };

  const startMasterSynthesis = async () => {
    const results: AnalysisResult[] = [];
    if (chatAnalysis) results.push(chatAnalysis);
    analyzedImages.forEach(img => {
      if (img.analysis) results.push(img.analysis);
    });

    if (results.length === 0) return;

    setIsSynthesizing(true);
    try {
      const finalAudit = await synthesizeGlobalAudit(results);
      setMasterAuditConclusion(finalAudit);
      setActiveTab('analysis');
    } catch (error) {
      console.error("Master synthesis failed", error);
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

  const COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#10b981', '#06b6d4'];

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
                disabled={isSynthesizing}
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
            <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm cursor-pointer transition-all shadow-md shadow-indigo-100">
              <Upload size={18} />
              <span className="hidden sm:inline">Bulk Import</span>
              <input type="file" className="hidden" multiple accept=".txt,.json,image/*" onChange={handleFileUpload} />
            </label>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 lg:p-10 max-w-[1600px] mx-auto w-full">
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
              <button onClick={() => { setMessages(generateSampleData()); setActiveTab('overview'); }} className="bg-white hover:bg-slate-50 text-slate-700 px-10 py-4 rounded-2xl font-bold border border-slate-200 shadow-sm transition-all">Try Demo Data</button>
              <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-4 rounded-2xl font-bold transition-all shadow-xl shadow-indigo-200 cursor-pointer flex items-center justify-center gap-2">
                <ImageIcon size={20} /> Bulk Import Files
                <input type="file" className="hidden" multiple accept=".txt,.json,image/*" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-10" style={{ fontSize: `${textZoom}rem` }}>
            <div className="flex p-1.5 bg-slate-200/60 rounded-2xl w-full max-w-5xl mx-auto backdrop-blur-sm border border-slate-200/50">
              <button onClick={() => setActiveTab('overview')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                <LayoutDashboard size={18} /> Dashboard
              </button>
              <button onClick={() => setActiveTab('news')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'news' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
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
                    <button onClick={handleFetchNews} disabled={isFetchingNews} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all">
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
                  <button onClick={startChatAnalysis} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all">
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
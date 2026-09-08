import React, { useState, useRef, useEffect, useCallback } from 'react';
import { aiService } from '../services/aiService';
import { ForecastResult, MarketResearch, MarketVerification } from '../types';

type AnalysisLens = 'smc' | 'gs' | 'psych' | 'ppa';

const nonEmpty = (value: string | undefined | null) => value?.trim() || null;
const sentence = (value: string | undefined | null) => nonEmpty(value)?.replace(/[.!?]+$/, '') || null;

const verificationTime = (asOf: string) => {
  const date = new Date(asOf);
  return Number.isNaN(date.getTime()) ? asOf : `${date.toISOString().slice(11, 16)} UTC`;
};

const sourceHost = (uri: string) => {
  try {
    return new URL(uri).hostname.replace(/^www\./i, '');
  } catch {
    return uri;
  }
};

const marketSourceLabels = {
  oanda: 'Oanda',
  twelvedata: 'Twelve Data',
  yahoo: 'Yahoo',
} as const;

const MarketVerificationLine: React.FC<{
  verification: MarketVerification;
  fullscreen?: boolean;
}> = ({ verification, fullscreen = false }) => (
  <div className={fullscreen ? 'text-xs text-emerald-300/70 font-mono' : 'text-[7px] text-emerald-300/70 font-mono'}>
    Verified vs {marketSourceLabels[verification.source]} {verification.instrument}{verification.proxy ? ' (proxy)' : ''} · last {verification.lastClose} · {verificationTime(verification.asOf)}
  </div>
);

const MarketResearchSummary: React.FC<{
  research: MarketResearch;
  fullscreen?: boolean;
}> = ({ research, fullscreen = false }) => {
  const nextEvent = research.upcomingEvents[0];
  return (
    <div className={fullscreen ? 'text-xs text-sky-300/70 font-mono' : 'text-[7px] text-sky-300/70 font-mono'}>
      Research: {research.headlines.length} headlines · {research.biasSignal}
      {nextEvent && ` · next ${nextEvent.name} ${nextEvent.whenUtc || 'time TBC'}`}
    </div>
  );
};

const MarketResearchHeadlines: React.FC<{ research: MarketResearch }> = ({ research }) => (
  <div className="mt-2 space-y-1 text-xs text-sky-200/80 font-mono">
    {research.headlines.slice(0, 3).map((headline, index) => {
      const text = `${headline.impact} · ${headline.publishedAt || 'time unknown'} · ${headline.title}`;
      return headline.url ? (
        <a key={`${headline.url}-${index}`} href={headline.url} target="_blank" rel="noreferrer noopener" className="block hover:text-sky-200 hover:underline">
          {text}
        </a>
      ) : (
        <div key={`${headline.title}-${index}`}>{text}</div>
      );
    })}
  </div>
);

const MarketResearchSources: React.FC<{ research: MarketResearch }> = ({ research }) => {
  if (!research.sources.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sky-200/80 font-mono">
      <span>Sources:</span>
      {research.sources.slice(0, 4).map((source) => (
        <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer noopener" className="hover:text-sky-200 hover:underline">
          {sourceHost(source.uri)}
        </a>
      ))}
    </div>
  );
};

const ForecastDetails: React.FC<{
  forecast: ForecastResult;
  variant: 'compact' | 'fullscreen';
}> = ({ forecast, variant }) => {
  const compact = variant === 'compact';
  const sectionClass = compact
    ? 'bg-black/20 border border-white/5 rounded-lg p-2.5'
    : 'p-5 rounded-2xl bg-slate-900/50 border border-white/5';
  const labelClass = compact
    ? 'text-[6px] text-white/30 uppercase tracking-widest font-bold mb-1'
    : 'text-[8px] text-white/30 uppercase tracking-widest mb-2';
  const valueClass = compact
    ? 'text-[8px] text-slate-300 leading-relaxed'
    : 'text-sm text-slate-200 leading-relaxed';
  const sectionTitleClass = compact
    ? 'text-[6px] text-emerald-400 uppercase tracking-widest font-bold mb-1'
    : 'text-[10px] text-emerald-400 uppercase tracking-[0.25em] font-bold mb-3';
  const gridClass = compact ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-2 gap-4';
  const entry = [
    nonEmpty(forecast.entry?.direction),
    nonEmpty(forecast.entry?.zone),
  ].filter(Boolean).join(' ');
  const liquidity = [
    nonEmpty(forecast.liquidityTarget?.type),
    nonEmpty(forecast.liquidityTarget?.level),
  ].filter(Boolean).join(' ');
  const retracement = [
    forecast.retracement?.expected === true ? 'Expected' : forecast.retracement?.expected === false ? 'Not expected' : null,
    nonEmpty(forecast.retracement?.zone),
    nonEmpty(forecast.retracement?.reason),
  ].filter(Boolean).join(' · ');
  const evidence = (forecast.structuralEvidence || []).map(nonEmpty).filter(Boolean) as string[];
  const warnings = (forecast.warnings || []).map(nonEmpty).filter(Boolean) as string[];

  const Field: React.FC<{ label: string; value: string | null }> = ({ label, value }) => {
    if (!value) return null;
    return (
      <div className={sectionClass}>
        <div className={labelClass}>{label}</div>
        <div className={valueClass}>{value}</div>
      </div>
    );
  };

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-8'}>
      {nonEmpty(forecast.currentState) && (
        <section className={sectionClass}>
          <div className={sectionTitleClass}>Current State</div>
          <p className={compact ? valueClass : 'text-lg text-white leading-relaxed'}>{forecast.currentState}</p>
        </section>
      )}

      {nonEmpty(forecast.nextMove) && (
        <section className={sectionClass}>
          <div className={sectionTitleClass}>{compact ? 'Next Leg' : 'Primary Tactical Objective'}</div>
          <p className={compact ? 'text-[10px] text-white font-semibold leading-relaxed' : 'text-2xl font-bold text-white leading-tight'}>{forecast.nextMove}</p>
        </section>
      )}

      {forecast.expectedPath?.some(nonEmpty) && (
        <section>
          <div className={compact ? 'text-[6px] text-white/30 uppercase tracking-widest font-bold mb-1.5' : 'text-[10px] text-white/30 uppercase tracking-[0.4em] font-bold mb-4'}>Anticipated Price Path</div>
          <div className={compact ? 'space-y-1' : 'space-y-4'}>
            {forecast.expectedPath.map((step, index) => {
              const value = nonEmpty(step);
              if (!value) return null;
              return (
                <div key={index} className={compact ? 'flex items-center gap-1.5' : 'flex gap-6 group'}>
                  <span className={compact ? 'text-[7px] text-emerald-500 font-mono' : 'text-sm text-emerald-500 font-mono shrink-0 mt-0.5'}>{String(index + 1).padStart(2, '0')}</span>
                  <div className={compact ? 'text-[8px] text-slate-300' : 'flex-1 pb-4 border-b border-white/5 group-last:border-0 text-lg text-slate-200'}>{value}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className={gridClass}>
        <Field label="Entry" value={entry || null} />
        <Field label="Next Event" value={nonEmpty(forecast.nextEvent)} />
        <Field label="Liquidity Target" value={liquidity || null} />
        <Field label="Invalidation" value={nonEmpty(forecast.invalidation)} />
      </div>

      <Field label="Liquidity Rationale" value={nonEmpty(forecast.liquidityTarget?.reason)} />
      <Field label="Retracement" value={retracement || null} />
      <Field label="Entry Confirmation" value={nonEmpty(forecast.entry?.confirmation)} />

      {(nonEmpty(forecast.targets?.tp1) || nonEmpty(forecast.targets?.tp2) || nonEmpty(forecast.targets?.final)) && (
        <div className={compact ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-3'}>
          <Field label="TP1" value={nonEmpty(forecast.targets?.tp1)} />
          <Field label="TP2" value={nonEmpty(forecast.targets?.tp2)} />
          <Field label="Final Target" value={nonEmpty(forecast.targets?.final)} />
        </div>
      )}

      {evidence.length > 0 && (
        <section className={sectionClass}>
          <div className={sectionTitleClass}>Structural Evidence</div>
          <ul className={compact ? 'space-y-1' : 'space-y-2'}>
            {evidence.map((item, index) => (
              <li key={index} className={`${valueClass} flex gap-2`}>
                <span className="text-emerald-500 font-mono shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Field label="Primary Scenario" value={nonEmpty(forecast.primaryScenario)} />
      <Field label="Alternative Scenario" value={nonEmpty(forecast.alternativeScenario)} />

      {warnings.length > 0 && (
        <section className={compact ? 'space-y-1' : 'space-y-2'}>
          {warnings.map((warning, index) => (
            <div key={index} className="text-[8px] text-rose-400/80">⚠ {warning}</div>
          ))}
        </section>
      )}
    </div>
  );
};

const buildNeuralInsights = (forecast: ForecastResult | null) => {
  if (!forecast) return 'No structured forecast is available yet. Run an analysis to generate institutional insights.';
  const insights = [
    sentence(forecast.currentState) && `Current state: ${sentence(forecast.currentState)}.`,
    sentence(forecast.nextMove) && `The next move is most likely to be ${sentence(forecast.nextMove)}.`,
    sentence(forecast.primaryScenario) && `Primary thesis: ${sentence(forecast.primaryScenario)}.`,
    sentence(forecast.alternativeScenario) && `If conditions change, the alternative scenario is ${sentence(forecast.alternativeScenario)}.`,
  ].filter(Boolean);
  return insights.join(' ') || 'The forecast returned no narrative insights.';
};

const ConfigHeaderIcon = () => (
  <div className="relative w-8 h-8 flex items-center justify-center group/icon shrink-0">
    <div className="absolute inset-0 bg-emerald-500/5 rounded-lg border border-white/5 rotate-45 group-hover/icon:rotate-90 group-hover/icon:bg-emerald-500/10 transition-all duration-700"></div>
    <div className="absolute inset-1 bg-emerald-500/10 rounded-md border border-emerald-500/20 rotate-[15deg] group-hover/icon:rotate-[105deg] transition-all duration-1000"></div>
    <i className="fa-solid fa-crosshairs text-emerald-500 text-[10px] relative z-10 group-hover/icon:scale-110 transition-transform"></i>
  </div>
);

const Visualizer: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [marketVerification, setMarketVerification] = useState<MarketVerification | null>(null);
  const [marketResearch, setMarketResearch] = useState<MarketResearch | null>(null);
  const [isForecastFullscreen, setIsForecastFullscreen] = useState(false);
  const [selectedLenses, setSelectedLenses] = useState<AnalysisLens[]>(['smc']);
  const [prompt, setPrompt] = useState(`
Forecast the most likely next price move.

Identify:
- Current directional bias
- Next liquidity event
- Expected liquidity target
- Expected retracement
- Highest-probability entry zone
- Invalidation
- TP1
- TP2
- Final target

Do not summarize what has already happened.

Focus primarily on the future price path from the current market state.
`);
  const [processing, setProcessing] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastTimestamp = useRef(0);
  const isDraggingRef = useRef(false);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const imgRef = useRef<HTMLImageElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateTransform = useCallback(() => {
    if (imgRef.current) {
      const { x, y, scale } = transformRef.current;
      imgRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
  }, []);

  const startAnimation = useCallback(() => {
    const animate = () => {
      if (!isDraggingRef.current) {
        transformRef.current.x += velocityRef.current.x;
        transformRef.current.y += velocityRef.current.y;
        velocityRef.current.x *= 0.95;
        velocityRef.current.y *= 0.95;
        if (Math.abs(velocityRef.current.x) < 0.01 && Math.abs(velocityRef.current.y) < 0.01) {
          velocityRef.current = { x: 0, y: 0 };
        }
      }
      updateTransform();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [updateTransform]);

  useEffect(() => {
    startAnimation();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [startAnimation]);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target?.result as string);
      setResultImage(null);
      setAnalysis(null);
      setMarketVerification(null);
      setMarketResearch(null);
      resetZoom();
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  };

  const resetZoom = () => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    velocityRef.current = { x: 0, y: 0 };
    updateTransform();
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!image) return;
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    const newScale = Math.min(Math.max(transformRef.current.scale * delta, 0.5), 10);
    transformRef.current.scale = newScale;
    updateTransform();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!image) return;
    isDraggingRef.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    lastTimestamp.current = Date.now();
    velocityRef.current = { x: 0, y: 0 };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (!isDraggingRef.current || !image) return;
    const now = Date.now();
    const dt = now - lastTimestamp.current;
    if (dt > 0) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      velocityRef.current = { x: dx, y: dy };
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      lastTimestamp.current = now;
      updateTransform();
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const toggleLens = (lens: AnalysisLens) => {
    setSelectedLenses(prev => 
      prev.includes(lens) 
        ? prev.filter(l => l !== lens) 
        : [...prev, lens]
    );
  };

  const handleProcess = async () => {
    if (!image || processing || selectedLenses.length === 0) return;
    setProcessing(true);
    try {
      const base64 = image.split(',')[1];
      const result = await aiService.annotateChart(base64, prompt, selectedLenses);
      setResultImage(result.image);
      setAnalysis(result.analysis);
      setForecast(result.forecast);
      setMarketVerification(result.marketVerification || null);
      setMarketResearch(result.marketResearch || null);
      setShowOriginal(false);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Unknown forecast error";
      alert(`Forecast engine failure: ${message}`);
    } finally {
      setProcessing(false);
    }
  };

  const lenses: { id: AnalysisLens; label: string; icon: string; color: string }[] = [
    { id: 'smc', label: 'SMC Protocol', icon: 'fa-fingerprint', color: 'text-emerald-500' },
    { id: 'gs', label: 'Goldman Desk', icon: 'fa-building-columns', color: 'text-sky-400' },
    { id: 'psych', label: 'Douglas/Schwager', icon: 'fa-brain', color: 'text-rose-400' },
    { id: 'ppa', label: 'Price Action', icon: 'fa-chart-simple', color: 'text-amber-400' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-3 min-h-0 flex-1 items-stretch overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 relative z-10 overflow-hidden">
          <div 
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={() => setIsOver(false)}
            onDrop={onDrop}
            className={`flex-1 glass-panel rounded-2xl p-1.5 flex flex-col relative overflow-hidden shadow-2xl border transition-all duration-300 ${isOver ? 'border-emerald-500/50 bg-emerald-500/[0.05]' : 'border-white/10 bg-black/40'}`}
          >
            {!image ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-white/5 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500/30 hover:bg-emerald-500/[0.02] transition-all group"
              >
                <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <i className="fa-solid fa-cloud-arrow-up text-xl text-emerald-500"></i>
                </div>
                <h3 className="text-base font-bold text-white tracking-tight">Ingest Asset</h3>
                <p className="text-slate-500 text-[8px] mt-1 uppercase tracking-[0.4em]">DROP CHART</p>
              </div>
            ) : (
              <div 
                ref={containerRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="flex-1 relative rounded-lg overflow-hidden bg-[#0a0a0c] flex items-center justify-center shadow-inner group cursor-crosshair"
              >
                <div className="absolute inset-0 pointer-events-none z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute h-full w-px bg-white/10" style={{ left: coords.x }}></div>
                  <div className="absolute w-full h-px bg-white/10" style={{ top: coords.y }}></div>
                  <div className="absolute bg-black/60 backdrop-blur-md border border-white/10 px-1.5 py-0.5 rounded text-[7px] font-mono text-emerald-400" style={{ left: coords.x + 8, top: coords.y + 8 }}>
                    {Math.round(coords.x)},{Math.round(coords.y)}
                  </div>
                </div>

                <img 
                  ref={imgRef}
                  src={(resultImage && !showOriginal) ? resultImage : image} 
                  className="max-w-none select-none pointer-events-none transition-transform duration-300 ease-out" 
                  style={{ 
                    transform: `translate(${transformRef.current.x}px, ${transformRef.current.y}px) scale(${transformRef.current.scale})`,
                    transformOrigin: 'center'
                  }}
                  alt="Chart Visualization" 
                />
                
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-900/95 backdrop-blur-xl border border-white/10 p-1.5 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-300 z-40 shadow-2xl scale-95 group-hover:scale-100 translate-y-2 group-hover:translate-y-0">
                   {resultImage && (
                     <>
                        <button 
                          onMouseDown={() => setShowOriginal(true)}
                          onMouseUp={() => setShowOriginal(false)}
                          onMouseLeave={() => setShowOriginal(false)}
                          className={`px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-lg transition-all flex items-center gap-2 ${showOriginal ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
                        >
                          <i className="fa-solid fa-eye-slash"></i>
                          Hold for Original
                        </button>
                        <div className="w-px h-4 bg-white/10 mx-1"></div>
                     </>
                   )}
                   <button 
                    onClick={() => {
                      transformRef.current.scale = Math.min(transformRef.current.scale * 1.25, 10);
                      updateTransform();
                    }}
                    className="w-8 h-8 flex items-center justify-center text-white hover:bg-emerald-500/20 hover:text-emerald-400 rounded-lg transition-colors"
                   >
                      <i className="fa-solid fa-plus text-[10px]"></i>
                   </button>
                   <button 
                    onClick={() => {
                      transformRef.current.scale = Math.max(transformRef.current.scale * 0.75, 0.5);
                      updateTransform();
                    }}
                    className="w-8 h-8 flex items-center justify-center text-white hover:bg-emerald-500/20 hover:text-emerald-400 rounded-lg transition-colors"
                   >
                      <i className="fa-solid fa-minus text-[10px]"></i>
                   </button>
                   <div className="w-px h-4 bg-white/10 mx-1"></div>
                   <button 
                    onClick={resetZoom}
                    className="px-3 py-1.5 text-[9px] font-bold text-white uppercase tracking-widest hover:bg-emerald-500/20 hover:text-emerald-400 rounded-lg transition-colors flex items-center gap-2"
                   >
                      <i className="fa-solid fa-compress text-[10px]"></i>
                      Reset
                   </button>
                </div>

                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 z-40 scale-95 group-hover:scale-100 -translate-y-2 group-hover:translate-y-0">
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setImage(null);
                      setResultImage(null);
                      setAnalysis(null);
                      setForecast(null);
                      setMarketVerification(null);
                      setMarketResearch(null);
                    }}
                    className="p-2 bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 rounded-lg backdrop-blur-md border border-rose-500/30 transition-all pointer-events-auto"
                    title="Flush Image"
                  >
                    <i className="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>

                {processing && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-3xl flex flex-col items-center justify-center z-50 overflow-hidden">
                    <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
                      <div className="absolute inset-x-0 h-[2px] bg-emerald-500 shadow-[0_0_20px_#10b981] animate-neural-scan"></div>
                    </div>
                    <div className="relative mb-4 z-10">
                      <div className="w-16 h-16 border-3 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin"></div>
                      <i className="fa-solid fa-microchip absolute inset-0 flex items-center justify-center text-emerald-500 text-xl animate-pulse"></i>
                    </div>
                    <div className="text-center space-y-1 px-4 relative z-10">
                      <p className="text-emerald-400 font-mono text-[10px] uppercase tracking-[0.4em] animate-pulse">Running Neural Overlay...</p>
                      <p className="text-white/20 text-[8px] uppercase tracking-widest">Synthesizing Price Action & Intent</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && handleFile(e.target.files[0])} className="hidden" accept="image/*" />
          </div>
        </div>

        <div className="lg:w-[320px] flex-shrink-0 flex flex-col gap-3 overflow-hidden relative z-20">
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3">
            {forecast && (
              <div className="glass-panel rounded-2xl p-3.5 border border-emerald-500/30 bg-emerald-500/[0.06] backdrop-blur-2xl shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
                      <i className="fa-solid fa-forward text-emerald-400 text-[9px]" />
                    </div>
                    <div>
                      <h3 className="text-[9px] font-bold text-white uppercase tracking-widest">Forecast</h3>
                      <p className="text-[6px] text-white/30 uppercase tracking-widest">Prob. Engine</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsForecastFullscreen(true)}
                      className="p-1.5 hover:bg-white/5 rounded-md text-white/30 hover:text-emerald-400 transition-colors"
                      title="Expand Fullscreen"
                    >
                      <i className="fa-solid fa-expand text-[10px]"></i>
                    </button>
                    <div className="text-right">
                      <div className={`text-xs font-black ${
                        forecast.bias === 'BULLISH' ? 'text-emerald-400' : forecast.bias === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'
                      }`}>
                        {forecast.bias}
                      </div>
                      <div className="text-[7px] text-white/30 font-mono">{forecast.confidence}% CONF</div>
                    </div>
                  </div>
                </div>

                {marketVerification && <MarketVerificationLine verification={marketVerification} />}
                {marketResearch && <MarketResearchSummary research={marketResearch} />}
                <ForecastDetails forecast={forecast} variant="compact" />
              </div>
            )}
            
            <div className="glass-panel rounded-2xl p-3.5 space-y-3.5 shrink-0 group border border-white/5 bg-slate-900/40">
              <div className="flex items-center gap-2.5">
                <ConfigHeaderIcon />
                <div>
                  <h3 className="text-[8px] font-bold text-white uppercase tracking-[0.2em]">Execution Hub</h3>
                  <p className="text-[7px] text-white/20 font-mono uppercase tracking-widest mt-0.5">Tactical Config</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {lenses.map((l) => {
                  const isActive = selectedLenses.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => toggleLens(l.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg border transition-all relative overflow-hidden group/btn ${
                        isActive
                          ? `bg-emerald-500/10 border-emerald-500/40 ${l.color} shadow-lg shadow-emerald-500/5`
                          : 'bg-slate-900/60 border-white/5 text-slate-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute top-1 right-1">
                          <i className="fa-solid fa-circle-check text-[7px] text-emerald-500"></i>
                        </div>
                      )}
                      <i className={`fa-solid ${l.icon} text-xs group-hover/btn:scale-110 transition-transform`}></i>
                      <span className="text-[7px] font-bold uppercase tracking-widest">{l.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2 pt-1">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Directives..."
                  className="w-full h-14 bg-black/40 border border-white/10 rounded-lg p-2 text-[9px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50 text-white resize-none shadow-inner font-mono"
                />
                <button
                  onClick={handleProcess}
                  disabled={!image || processing || selectedLenses.length === 0}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold py-2.5 rounded-lg shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-[8px] uppercase tracking-widest"
                >
                  {processing ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-layer-group"></i>}
                  {processing ? '...' : `Analyze`}
                </button>
              </div>
            </div>

            {(analysis || forecast) && (
              <div className="glass-panel rounded-2xl p-3.5 border border-emerald-500/20 bg-emerald-500/[0.05] backdrop-blur-2xl shrink-0">
                <div className="flex items-center gap-2 mb-2 border-b border-emerald-500/10 pb-2">
                  <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <i className="fa-solid fa-brain text-emerald-500 text-[9px]"></i>
                  </div>
                  <h3 className="text-[8px] font-bold text-white uppercase tracking-widest">Neural Insights</h3>
                </div>
                <div className="text-slate-300 text-[10px] leading-relaxed prose prose-invert max-w-none whitespace-pre-wrap font-sans max-h-48 overflow-y-auto custom-scrollbar">
                  {buildNeuralInsights(forecast)}
                </div>
              </div>
            )}

            <div className="glass-panel rounded-2xl p-3.5 flex-1 border border-white/5 bg-slate-950/40 min-h-[120px]">
              <h4 className="text-[8px] font-bold text-white/40 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                <i className="fa-solid fa-list-check"></i> Legend
              </h4>
              <div className="space-y-4">
                {selectedLenses.map(lensId => {
                  const lens = lenses.find(l => l.id === lensId);
                  if (!lens) return null;
                  return (
                    <div key={lensId} className="space-y-2">
                      <h5 className={`text-[8px] font-bold ${lens.color} opacity-60 uppercase tracking-widest border-l border-current pl-2`}>{lens.label}</h5>
                      <div className="space-y-2 pl-2">
                        {lensId === 'smc' && (
                          <>
                            <LegendItem color="bg-emerald-500" label="Order Blocks" desc="Institutional resting orders" />
                            <LegendItem color="bg-sky-500" label="FVG" desc="Inefficiency gaps" />
                          </>
                        )}
                        {lensId === 'gs' && (
                          <>
                            <LegendItem color="bg-indigo-500" label="Inst. Flow" desc="Primary trend narrative" />
                            <LegendItem color="bg-rose-500" label="Voids" desc="Liquidity vacuum areas" />
                          </>
                        )}
                        {lensId === 'psych' && (
                          <>
                            <LegendItem color="bg-rose-600" label="Fear Zones" desc="Retail liquidation triggers" />
                            <LegendItem color="bg-amber-600" label="Stops" desc="Clustered retail risk" />
                          </>
                        )}
                        {lensId === 'ppa' && (
                          <>
                            <LegendItem color="bg-white" label="S/R" desc="Major psych levels" />
                            <LegendItem color="bg-amber-400" label="Patterns" desc="Candle stick formations" />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isForecastFullscreen && forecast && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-12 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-3xl cursor-pointer" onClick={() => setIsForecastFullscreen(false)}></div>
          <div className="relative w-full max-w-5xl max-h-full overflow-y-auto glass-panel rounded-[2rem] p-8 lg:p-12 border border-emerald-500/30 bg-emerald-500/[0.03] shadow-[0_0_100px_rgba(16,185,129,0.1)] custom-scrollbar">
            <button onClick={() => setIsForecastFullscreen(false)} className="absolute top-6 right-6 lg:top-8 lg:right-8 p-3 hover:bg-white/5 rounded-full text-white/30 hover:text-white transition-all group">
              <i className="fa-solid fa-xmark text-xl group-hover:rotate-90 transition-transform duration-300"></i>
            </button>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-12 border-b border-white/5 pb-10">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                  <i className="fa-solid fa-forward text-emerald-400 text-3xl" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-[0.1em]">Institutional Forecast <span className="text-emerald-500">v3.0</span></h2>
                  <p className="text-xs text-white/40 uppercase tracking-widest mt-1">QuantSage Forward Probability Engine</p>
                </div>
              </div>
              <div className="text-left lg:text-right">
                <div className={`text-5xl font-black mb-2 ${forecast.bias === 'BULLISH' ? 'text-emerald-400' : forecast.bias === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'}`}>{forecast.bias}</div>
                <div className="flex items-center lg:justify-end gap-3 text-xs font-mono tracking-widest text-white/30">{forecast.confidence}% CONFIDENCE RATING</div>
              </div>
            </div>
            {marketVerification && <MarketVerificationLine verification={marketVerification} fullscreen />}
            {marketResearch && (
              <>
                <MarketResearchSummary research={marketResearch} fullscreen />
                <MarketResearchHeadlines research={marketResearch} />
                <MarketResearchSources research={marketResearch} />
              </>
            )}
            <ForecastDetails forecast={forecast} variant="fullscreen" />
          </div>
        </div>
      )}
    </div>
  );
};

const LegendItem: React.FC<{ color: string; label: string; desc: string }> = ({ color, label, desc }) => (
  <div className="flex items-start gap-3 group">
    <div className={`w-1.5 h-1.5 rounded-full ${color} mt-1 shrink-0 group-hover:scale-125 transition-transform shadow-[0_0_5px_currentColor]`}></div>
    <div>
      <p className="text-[8px] font-bold text-white leading-none mb-0.5 group-hover:text-emerald-400 transition-colors">{label}</p>
      <p className="text-[7px] text-white/20 leading-tight font-medium">{desc}</p>
    </div>
  </div>
);

export default Visualizer;

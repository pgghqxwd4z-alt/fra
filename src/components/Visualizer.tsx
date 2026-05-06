import React, { useState, useRef, useEffect, useCallback } from 'react';
import { geminiService, drawAnnotationsOnCanvas } from '../services/geminiService';

type AnalysisLens = 'smc' | 'gs' | 'psych' | 'ppa' | 'isyn';

function cleanAnalysisForDisplay(text: string): string {
  const unavailablePhrase = ['the live vision model', 'is temporarily unavailable'].join(' ');

  return text
    .replace(new RegExp(unavailablePhrase, 'gi'), 'Groq capacity is busy')
    .replace(/Retry for full AI chart-specific verification/gi, 'Retry later for full AI chart-specific verification');
}

const ConfigHeaderIcon = () => (
  <div className="relative w-8 h-8 flex items-center justify-center group/icon shrink-0">
    <div className="absolute inset-0 bg-emerald-500/5 rounded-lg border border-white/5 rotate-45 group-hover/icon:rotate-90 group-hover/icon:bg-emerald-500/10 transition-all duration-700"></div>
    <div className="absolute inset-1 bg-emerald-500/10 rounded-md border border-emerald-500/20 rotate-[15deg] group-hover/icon:rotate-[105deg] transition-all duration-1000"></div>
    <i className="fa-solid fa-crosshairs text-emerald-500 text-[10px] relative z-10 group-hover/icon:scale-110 transition-transform"></i>
  </div>
);

const LegendItem: React.FC<{ color: string; label: string; desc: string }> = ({ color, label, desc }) => (
  <div className="flex items-start gap-3 group">
    <div className={`w-1.5 h-1.5 rounded-full ${color} mt-1 shrink-0 group-hover:scale-125 transition-transform shadow-[0_0_5px_currentColor]`}></div>
    <div>
      <p className="text-[8px] font-bold text-white leading-none mb-0.5 group-hover:text-emerald-400 transition-colors">{label}</p>
      <p className="text-[7px] text-white/20 leading-tight font-medium">{desc}</p>
    </div>
  </div>
);

const Visualizer: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [selectedLenses, setSelectedLenses] = useState<AnalysisLens[]>(['smc']);
  const [prompt, setPrompt] = useState('Identify institutional footprints and probabilistic entry zones.');
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastTimestamp = useRef(0);
  const isDraggingRef = useRef(false);
  const animationFrameRef = useRef<number>();
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
      setErrorMessage(null);
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
      setCoords({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
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
    setErrorMessage(null);
    try {
      const base64 = image.split(',')[1];
      const result = await geminiService.annotateChart(base64, prompt, selectedLenses);
      
      // Draw visual annotations on the chart image
      if (result.annotations && result.annotations.length > 0) {
        const annotatedImage = await drawAnnotationsOnCanvas(image, result.annotations);
        setResultImage(annotatedImage);
      } else if (result.image) {
        setResultImage(result.image);
      }
      
      setAnalysis(cleanAnalysisForDisplay(result.analysis));
      setShowOriginal(false);
    } catch (error) {
      console.error('[Annotation Engine]', error);
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit = msg.includes('429') || msg.includes('rate') || msg.includes('Rate');
      setErrorMessage(isRateLimit
        ? 'Rate limit reached. The Groq API allows 30 requests/min on the free tier. Please wait 30-60 seconds and try again.'
        : 'Annotation engine error: ' + msg.slice(0, 150) + '. Check console for details.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const lenses: { id: AnalysisLens; label: string; icon: string; color: string }[] = [
    { id: 'psych', label: 'Douglas/Schwager Axis', icon: 'fa-brain', color: 'text-rose-400' },
    { id: 'gs', label: 'Goldman Sachs Strategy', icon: 'fa-building-columns', color: 'text-sky-400' },
    { id: 'smc', label: 'SMC Mechanics', icon: 'fa-fingerprint', color: 'text-emerald-500' },
    { id: 'ppa', label: 'Pure Price Action', icon: 'fa-chart-simple', color: 'text-amber-400' },
    { id: 'isyn', label: 'Inst. Synthesis', icon: 'fa-layer-group', color: 'text-violet-400' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-4 min-h-0 flex-1 items-stretch overflow-hidden">
        {/* Main Viewport Area */}
        <div className="flex-1 flex flex-col min-h-0 relative z-10 overflow-hidden">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={() => setIsOver(false)}
            onDrop={onDrop}
            className={`flex-1 glass-panel rounded-[1.5rem] p-2 flex flex-col relative overflow-hidden shadow-2xl border transition-all duration-300 ${isOver ? 'border-emerald-500/50 bg-emerald-500/[0.05]' : 'border-white/10 bg-black/40'}`}
          >
            {!image ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-white/5 rounded-[1rem] flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500/30 hover:bg-emerald-500/[0.02] transition-all group"
              >
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <i className="fa-solid fa-cloud-arrow-up text-2xl text-emerald-500"></i>
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">Ingest Asset Data</h3>
                <p className="text-slate-500 text-[9px] mt-1 uppercase tracking-[0.4em]">DROP CHART OR BROWSE</p>
              </div>
            ) : (
              <>
                <div
                  ref={containerRef}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className="flex-1 relative rounded-lg overflow-hidden bg-[#0a0a0c] flex items-center justify-center shadow-inner group cursor-crosshair"
                >
                {/* Crosshair Overlay */}
                <div className="absolute inset-0 pointer-events-none z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute h-full w-px bg-white/10" style={{ left: coords.x }}></div>
                  <div className="absolute w-full h-px bg-white/10" style={{ top: coords.y }}></div>
                  <div className="absolute bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded text-[8px] font-mono text-emerald-400" style={{ left: coords.x + 10, top: coords.y + 10 }}>
                    X:{Math.round(coords.x)} Y:{Math.round(coords.y)}
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

                {/* Floating Navigation Controls */}
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

                {/* Image Overlay Controls */}
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 z-40 scale-95 group-hover:scale-100 -translate-y-2 group-hover:translate-y-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setImage(null); setResultImage(null); setAnalysis(null); }}
                    className="p-2 bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 rounded-lg backdrop-blur-md border border-rose-500/30 transition-all pointer-events-auto"
                    title="Flush Image"
                  >
                    <i className="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>

                {processing && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-3xl flex flex-col items-center justify-center z-50 overflow-hidden">
                    {/* Primary scan line */}
                    <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
                      <div className="absolute inset-x-0 h-[2px] bg-emerald-500 shadow-[0_0_20px_#10b981] animate-neural-scan"></div>
                    </div>
                    {/* Secondary reverse scan line */}
                    <div className="absolute inset-0 z-0 pointer-events-none opacity-10">
                      <div className="absolute inset-x-0 h-[1px] bg-sky-400 shadow-[0_0_15px_#38bdf8] animate-neural-scan-reverse"></div>
                    </div>
                    {/* Grid pulse effect */}
                    <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]" style={{
                      backgroundImage: 'linear-gradient(rgba(16,185,129,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.3) 1px, transparent 1px)',
                      backgroundSize: '40px 40px',
                      animation: 'pulse 3s ease-in-out infinite',
                    }}></div>
                    {/* Corner brackets */}
                    <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-emerald-500/40 z-10"></div>
                    <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-emerald-500/40 z-10"></div>
                    <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-emerald-500/40 z-10"></div>
                    <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-emerald-500/40 z-10"></div>
                    {/* Main spinner */}
                    <div className="relative mb-4 z-10">
                      <div className="w-20 h-20 border-[3px] border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin"></div>
                      <div className="absolute inset-2 w-16 h-16 border-[2px] border-sky-400/5 border-b-sky-400/30 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                      <i className="fa-solid fa-microchip absolute inset-0 flex items-center justify-center text-emerald-500 text-xl animate-pulse"></i>
                    </div>
                    <div className="text-center space-y-2 px-4 relative z-10">
                      <p className="text-emerald-400 font-mono text-[10px] uppercase tracking-[0.4em] animate-pulse">Neural Scan Active</p>
                      <p className="text-white/20 text-[8px] uppercase tracking-widest">Multi-Lens AI Pipeline Processing</p>
                      <div className="flex items-center justify-center gap-1 mt-2">
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-ping" style={{ animationDelay: '0s' }}></div>
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-ping" style={{ animationDelay: '0.3s' }}></div>
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-ping" style={{ animationDelay: '0.6s' }}></div>
                      </div>
                    </div>
                  </div>
                )}
                </div>

                {errorMessage && (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-3">
                    <i className="fa-solid fa-triangle-exclamation text-rose-400 text-sm mt-0.5"></i>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-rose-300 mb-1">Annotation Engine Notice</p>
                      <p className="text-[10px] leading-relaxed text-rose-100/80">{errorMessage}</p>
                    </div>
                    <button
                      onClick={() => setErrorMessage(null)}
                      className="text-rose-300/70 hover:text-white transition-colors"
                      aria-label="Dismiss annotation engine notice"
                    >
                      <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                  </div>
                )}
              </>
            )}
            <input type="file" ref={fileInputRef} onChange={(e) => e.target.files && handleFile(e.target.files[0])} className="hidden" accept="image/*" />
          </div>
        </div>

        {/* Intelligence & Control Column */}
        <div className="lg:w-[380px] flex-shrink-0 flex flex-col gap-4 overflow-hidden relative z-20">
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4">
            {/* Tactical Settings */}
            <div className="glass-panel rounded-[1.5rem] p-4 space-y-4 shrink-0 group border border-white/5 bg-slate-900/40">
              <div className="flex items-center gap-3">
                <ConfigHeaderIcon />
                <div>
                  <h3 className="text-[9px] font-bold text-white uppercase tracking-[0.3em]">Execution Hub</h3>
                  <p className="text-[8px] text-white/20 font-mono uppercase tracking-widest mt-0.5">Tactical Configurator</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {lenses.map((l) => {
                  const isActive = selectedLenses.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => toggleLens(l.id)}
                      className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all relative overflow-hidden group/btn ${
                        isActive
                          ? `bg-emerald-500/10 border-emerald-500/40 ${l.color} shadow-lg shadow-emerald-500/5`
                          : 'bg-slate-900/60 border-white/5 text-slate-500 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute top-1 right-1">
                          <i className="fa-solid fa-circle-check text-[8px] text-emerald-500"></i>
                        </div>
                      )}
                      <i className={`fa-solid ${l.icon} text-sm group-hover/btn:scale-110 transition-transform`}></i>
                      <span className="text-[8px] font-bold uppercase tracking-widest">{l.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3 pt-1">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Directives..."
                  className="w-full h-16 bg-black/40 border border-white/10 rounded-lg p-3 text-[10px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50 text-white resize-none shadow-inner font-mono"
                />
                <button
                  onClick={handleProcess}
                  disabled={!image || processing || selectedLenses.length === 0}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold py-3 rounded-lg shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-[9px] uppercase tracking-widest"
                >
                  {processing ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-layer-group"></i>}
                  {processing ? 'Processing...' : `Analyze (${selectedLenses.length})`}
                </button>
              </div>
            </div>

            {/* Analysis Output */}
            {analysis && (
              <div className="glass-panel rounded-[1.5rem] p-4 border border-emerald-500/20 bg-emerald-500/[0.05] backdrop-blur-2xl shrink-0">
                <div className="flex items-center gap-2 mb-3 border-b border-emerald-500/10 pb-3">
                  <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <i className="fa-solid fa-brain text-emerald-500 text-[10px]"></i>
                  </div>
                  <h3 className="text-[9px] font-bold text-white uppercase tracking-widest">Neural Insights</h3>
                </div>
                <div className="text-slate-300 text-[10px] leading-relaxed prose prose-invert max-w-none font-sans max-h-[400px] overflow-y-auto custom-scrollbar">
                  {analysis.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  // Handle ### headers (e.g. "### 1. Pure Price Action:")
                  if (trimmed.startsWith('### ')) {
                    const text = trimmed.slice(4).replace(/\*\*/g, '');
                    return <h4 key={i} className="text-white font-bold text-[11px] mt-4 mb-1 border-b border-white/10 pb-1">{text}</h4>;
                  }
                  // Handle ## headers
                  if (trimmed.startsWith('## ')) {
                    const text = trimmed.slice(3).replace(/\*\*/g, '');
                    return <h3 key={i} className="text-emerald-400 font-bold text-xs mt-4 mb-2 border-b border-emerald-500/20 pb-1">{text}</h3>;
                  }
                  // Handle **bold header lines** (full line bold)
                  if (trimmed.startsWith('**') && trimmed.endsWith('**') && !trimmed.includes(':**')) {
                    const text = trimmed.replace(/\*\*/g, '');
                    if (text.startsWith('Synthesized') || text.startsWith('Conclusion') || text.startsWith('Summary')) {
                      return <h3 key={i} className="text-emerald-400 font-bold text-xs mt-4 mb-2 border-b border-emerald-500/20 pb-1">{text}</h3>;
                    }
                    return <h4 key={i} className="text-white font-bold text-[11px] mt-3 mb-1">{text}</h4>;
                  }
                  // Handle **numbered section headers** like "**1. Pure Price Action:**"
                  if (trimmed.startsWith('**') && trimmed.endsWith(':**')) {
                    const text = trimmed.replace(/\*\*/g, '');
                    return <h4 key={i} className="text-white font-bold text-[11px] mt-4 mb-1 border-b border-white/10 pb-1">{text}</h4>;
                  }
                  // Handle bullet points with inline bold: "* **Sub-header:** content" or "- **Sub-header:** content"
                  if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
                    const bulletText = trimmed.slice(2);
                    // Parse inline **bold** segments
                    const parts = bulletText.split(/(\*\*[^*]+\*\*)/g);
                    return (
                      <p key={i} className="text-slate-400 text-[10px] pl-3 border-l border-white/10 my-1">
                        {parts.map((part, j) => {
                          if (part.startsWith('**') && part.endsWith('**')) {
                            return <span key={j} className="text-white font-semibold">{part.slice(2, -2)}</span>;
                          }
                          return <span key={j}>{part}</span>;
                        })}
                      </p>
                    );
                  }
                  // Handle --- separator between independent lens analyses
                  if (trimmed === '---') {
                    return <div key={i} className="my-4 border-t border-emerald-500/30 pt-2" />;
                  }
                  if (trimmed === '') return <div key={i} className="h-1" />;
                  // Regular text - also parse inline bold
                  const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
                  return (
                    <p key={i} className="text-slate-300 text-[10px] my-0.5">
                      {parts.map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return <span key={j} className="text-white font-semibold">{part.slice(2, -2)}</span>;
                        }
                        return <span key={j}>{part}</span>;
                      })}
                    </p>
                  );
                })}
                </div>
              </div>
            )}

            {/* Tactical Legend */}
            <div className="glass-panel rounded-[1.5rem] p-4 flex-1 border border-white/5 bg-slate-950/40 min-h-[150px]">
              <h4 className="text-[9px] font-bold text-white/40 uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
                <i className="fa-solid fa-list-check"></i>
                Legend
              </h4>
              <div className="space-y-4">
                {selectedLenses.map(lensId => {
                  const lens = lenses.find(l => l.id === lensId);
                  if (!lens) return null;
                  return (
                    <div key={lensId} className="space-y-2">
                      <h5 className={`text-[8px] font-bold ${lens.color} opacity-60 uppercase tracking-widest border-l border-current pl-2`}>{lens.label}</h5>
                      <div className="space-y-2 pl-2">
                        {lensId === 'psych' && (
                          <>
                            <LegendItem color="bg-rose-600" label="Accepting Randomness" desc="Probabilistic mindset" />
                            <LegendItem color="bg-red-500" label="Risk-First Mentality" desc="Define risk before entry" />
                            <LegendItem color="bg-rose-400" label="Outcome Detachment" desc="Process over results" />
                          </>
                        )}
                        {lensId === 'gs' && (
                          <>
                            <LegendItem color="bg-blue-500" label="Inter-market Flow" desc="Institutional capital flow" />
                            <LegendItem color="bg-purple-500" label="Liquidity Voids" desc="Vacuum areas to fill" />
                            <LegendItem color="bg-cyan-400" label="Macro Divergence" desc="Institutional vs retail" />
                          </>
                        )}
                        {lensId === 'smc' && (
                          <>
                            <LegendItem color="bg-emerald-500" label="Order Blocks" desc="Institutional resting orders" />
                            <LegendItem color="bg-sky-500" label="FVG Imbalances" desc="Inefficiency gaps" />
                            <LegendItem color="bg-green-400" label="Institutional Flow" desc="Smart money footprints" />
                          </>
                        )}
                        {lensId === 'ppa' && (
                          <>
                            <LegendItem color="bg-amber-400" label="LTF Confirmation" desc="Lower timeframe signals" />
                            <LegendItem color="bg-yellow-500" label="CHoCH/BOS" desc="Structure break triggers" />
                            <LegendItem color="bg-white" label="Candlestick Triggers" desc="Entry confirmation patterns" />
                          </>
                        )}
                        {lensId === 'isyn' && (
                          <>
                            <LegendItem color="bg-violet-500" label="Confluence Zone" desc="Multi-framework convergence" />
                            <LegendItem color="bg-green-400" label="Inst. Entry" desc="Probabilistic long entry" />
                            <LegendItem color="bg-red-400" label="Inst. Exit" desc="Probabilistic short/exit" />
                            <LegendItem color="bg-cyan-400" label="Execution Tier" desc="Bank-level priority ranking" />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {selectedLenses.length === 0 && (
                  <div className="py-10 text-center opacity-20">
                    <p className="text-[8px] uppercase tracking-widest">Select lenses</p>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-white/5">
                <div className="flex items-center gap-2 opacity-30">
                  <i className="fa-solid fa-shield-halved text-emerald-500 text-[10px]"></i>
                  <span className="text-[7px] font-mono text-white uppercase tracking-widest leading-tight">
                    Institutional Engine v3.2
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes neural-scan {
          0% { top: 0; }
          50% { top: 100%; }
          100% { top: 0; }
        }
        @keyframes neural-scan-reverse {
          0% { top: 100%; }
          50% { top: 0; }
          100% { top: 100%; }
        }
        .animate-neural-scan {
          animation: neural-scan 4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        .animate-neural-scan-reverse {
          animation: neural-scan-reverse 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
};

export default Visualizer;

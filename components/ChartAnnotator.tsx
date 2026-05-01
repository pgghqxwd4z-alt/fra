import React, { useRef, useState } from 'react';
import { ImageAnnotation, ManualDrawing } from '../types';
import { 
  Maximize2, Minimize2, Eye, EyeOff, List, Crosshair, ZoomIn, ZoomOut, RotateCcw,
  Square, Circle, Minus, Type, MousePointer2, Trash2, Eraser, Hash, Check, X as CloseIcon
} from 'lucide-react';

interface ChartAnnotatorProps {
  imageUrl: string;
  annotations: ImageAnnotation[];
}

type Tool = 'cursor' | 'line' | 'rect' | 'circle' | 'text' | 'price-level';

export const ChartAnnotator: React.FC<ChartAnnotatorProps> = ({ imageUrl, annotations }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  const [activeTool, setActiveTool] = useState<Tool>('cursor');
  const [drawings, setDrawings] = useState<ManualDrawing[]>([]);
  const [activeColor, setActiveColor] = useState('#6366f1');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<[number, number][]>([]);

  const [priceModal, setPriceModal] = useState<{ isOpen: boolean; coords: [number, number] | null }>({ isOpen: false, coords: null });
  const [priceInputValue, setPriceInputValue] = useState('');

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const colors: Record<string, string> = {
    'BOS': '#6366f1',
    'CHoCH': '#a855f7',
    'OrderBlock': '#ec4899',
    'Liquidity': '#f97316',
    'Support': '#10b981',
    'Resistance': '#ef4444',
    'PsychologyZone': '#94a3b8'
  };

  const tradingColors = [
    { name: 'Long', hex: '#10b981' },
    { name: 'Short', hex: '#ef4444' },
    { name: 'Institutional', hex: '#6366f1' },
    { name: 'Liquidity', hex: '#f97316' },
    { name: 'Neutral', hex: '#94a3b8' }
  ];

  const getAnnotationStyle = (box: [number, number, number, number], type: string, isHovered: boolean) => {
    const [ymin, xmin, ymax, xmax] = box;
    const baseColor = colors[type] || '#fff';
    return {
      top: `${ymin / 10}%`,
      left: `${xmin / 10}%`,
      height: `${(ymax - ymin) / 10}%`,
      width: `${(xmax - xmin) / 10}%`,
      backgroundColor: isHovered ? `${baseColor}33` : `${baseColor}11`,
      border: `2px ${isHovered ? 'solid' : 'dashed'} ${baseColor}`,
      boxShadow: isHovered ? `0 0 15px ${baseColor}44` : 'none',
      zIndex: isHovered ? 50 : 10,
    };
  };

  const handleZoom = (delta: number) => {
    setZoom(prev => Math.min(Math.max(prev + delta, 1), 4));
  };

  const getNormalizedCoords = (e: React.MouseEvent | React.TouchEvent): [number, number] => {
    if (!imageRef.current) return [0, 0];
    const rect = imageRef.current.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * 1000;
    const y = ((clientY - rect.top) / rect.height) * 1000;
    return [Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y))];
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'cursor') {
      if (zoom > 1 && viewportRef.current) {
        setIsPanning(true);
        setPanStart({
          x: e.clientX,
          y: e.clientY,
          scrollLeft: viewportRef.current.scrollLeft,
          scrollTop: viewportRef.current.scrollTop
        });
      }
      return;
    }
    
    const coords = getNormalizedCoords(e);
    
    if (activeTool === 'price-level') {
      setPriceModal({ isOpen: true, coords });
      setPriceInputValue('');
      return;
    }

    if (activeTool === 'text') {
      const text = prompt('Enter annotation text:');
      if (text) {
        const newDrawing: ManualDrawing = {
          id: `draw-${Date.now()}`,
          type: 'text',
          coords: [coords],
          label: text,
          color: activeColor
        };
        setDrawings([...drawings, newDrawing]);
      }
      return;
    }

    setIsDrawing(true);
    setCurrentPoints([coords]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && viewportRef.current) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      viewportRef.current.scrollLeft = panStart.scrollLeft - dx;
      viewportRef.current.scrollTop = panStart.scrollTop - dy;
      return;
    }

    if (!isDrawing || activeTool === 'cursor' || activeTool === 'text' || activeTool === 'price-level') return;
    const coords = getNormalizedCoords(e);
    setCurrentPoints(prev => [prev[0], coords]);
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (!isDrawing || activeTool === 'cursor' || activeTool === 'text' || activeTool === 'price-level') return;
    
    if (currentPoints.length >= 2) {
      const newDrawing: ManualDrawing = {
        id: `draw-${Date.now()}`,
        type: activeTool,
        coords: currentPoints,
        color: activeColor
      };
      setDrawings([...drawings, newDrawing]);
    }
    
    setIsDrawing(false);
    setCurrentPoints([]);
  };

  const submitPriceLevel = () => {
    if (priceModal.coords && priceInputValue) {
      const newDrawing: ManualDrawing = {
        id: `draw-${Date.now()}`,
        type: 'price-level',
        coords: [priceModal.coords],
        label: priceInputValue,
        color: activeColor
      };
      setDrawings([...drawings, newDrawing]);
      setPriceModal({ isOpen: false, coords: null });
      setPriceInputValue('');
    }
  };

  const deleteDrawing = (id: string) => {
    setDrawings(drawings.filter(d => d.id !== id));
  };

  const clearAllDrawings = () => {
    if (confirm("Clear all manual annotations?")) setDrawings([]);
  };

  return (
    <div className={`relative flex flex-col lg:flex-row gap-4 h-full ${isFullScreen ? 'fixed inset-0 z-[100] bg-slate-950 p-6' : ''}`}>
      
      {priceModal.isOpen && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white p-6 rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xs scale-in animate-in">
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Hash size={16} className="text-indigo-600" /> Set Price Level
            </h4>
            <div className="space-y-4">
              <div className="relative">
                <input 
                  autoFocus
                  type="text" 
                  value={priceInputValue}
                  onChange={(e) => setPriceInputValue(e.target.value)}
                  placeholder="e.g. 1.08450"
                  onKeyDown={(e) => e.key === 'Enter' && submitPriceLevel()}
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-lg font-black tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-center"
                />
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setPriceModal({ isOpen: false, coords: null })}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2"
                >
                  <CloseIcon size={14} /> Cancel
                </button>
                <button 
                  onClick={submitPriceLevel}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                >
                  <Check size={14} /> Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative flex-1 bg-slate-900 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl flex items-center justify-center group/view">
        
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex flex-row items-center gap-2 p-1.5 bg-slate-800/90 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl">
          
          {/* View Controls Group */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-slate-700">
             <button 
              onClick={() => setShowAnnotations(!showAnnotations)}
              className={`p-2 rounded-xl transition-all ${showAnnotations ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
              title="Toggle AI Annotations"
            >
              {showAnnotations ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button onClick={() => handleZoom(0.3)} className="p-2 hover:text-white text-slate-400" title="Zoom In"><ZoomIn size={18} /></button>
            <button onClick={() => handleZoom(-0.3)} className="p-2 hover:text-white text-slate-400" title="Zoom Out"><ZoomOut size={18} /></button>
            <button onClick={() => setZoom(1)} className="p-2 hover:text-white text-slate-400" title="Reset View"><RotateCcw size={18} /></button>
          </div>

          {/* Drawing Tools Group */}
          <div className="flex items-center gap-0.5 px-2 border-r border-slate-700">
            <button 
              onClick={() => setActiveTool('cursor')} 
              className={`p-2 rounded-xl transition-all ${activeTool === 'cursor' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              title="Select / Pan"
            >
              <MousePointer2 size={18} />
            </button>
            <button 
              onClick={() => setActiveTool('price-level')} 
              className={`p-2 rounded-xl transition-all ${activeTool === 'price-level' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              title="Price Level"
            >
              <Hash size={18} />
            </button>
            <button 
              onClick={() => setActiveTool('line')} 
              className={`p-2 rounded-xl transition-all ${activeTool === 'line' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              title="Draw Line"
            >
              <Minus size={18} className="rotate-45" />
            </button>
            <button 
              onClick={() => setActiveTool('rect')} 
              className={`p-2 rounded-xl transition-all ${activeTool === 'rect' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              title="Draw Rectangle"
            >
              <Square size={18} />
            </button>
            <button 
              onClick={() => setActiveTool('circle')} 
              className={`p-2 rounded-xl transition-all ${activeTool === 'circle' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              title="Draw Circle"
            >
              <Circle size={18} />
            </button>
            <button 
              onClick={() => setActiveTool('text')} 
              className={`p-2 rounded-xl transition-all ${activeTool === 'text' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              title="Add Label"
            >
              <Type size={18} />
            </button>
          </div>

          {/* Color Palette Group */}
          <div className="flex items-center gap-2 px-2 border-r border-slate-700">
            {tradingColors.map(c => (
              <button 
                key={c.hex} 
                onClick={() => setActiveColor(c.hex)}
                className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-125 ${activeColor === c.hex ? 'border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
          </div>

          {/* Action Tools Group */}
          <div className="flex items-center gap-0.5 pl-2">
            <button 
              onClick={clearAllDrawings} 
              className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all"
              title="Clear All Drawings"
            >
              <Eraser size={18} />
            </button>
            <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 text-slate-400 hover:text-white" title="Toggle Fullscreen">
              {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        </div>

        {/* Viewport Area */}
        <div 
          ref={viewportRef}
          className="w-full h-full overflow-auto flex items-center justify-center scrollbar-hide relative pt-16"
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div 
            className="relative transition-transform duration-200 ease-out origin-center select-none"
            style={{ 
              transform: `scale(${zoom})`,
              width: '100%',
              maxWidth: zoom > 1 ? 'none' : '1000px',
              cursor: activeTool === 'cursor' 
                ? (zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default') 
                : 'crosshair'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
          >
            <img 
              ref={imageRef}
              src={imageUrl} 
              alt="Trading Chart" 
              className="w-full h-auto block shadow-2xl pointer-events-none" 
              draggable={false}
            />
            
            {/* AI Annotations Overlay */}
            {showAnnotations && (
              <div className="absolute inset-0">
                {annotations.map((ann, idx) => (
                  <div
                    key={idx}
                    className="absolute cursor-pointer transition-all duration-200"
                    style={getAnnotationStyle(ann.box_2d, ann.type, hoveredIndex === idx)}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                ))}
              </div>
            )}

            {/* Manual Drawings Overlay */}
            <svg 
              className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" 
              viewBox="0 0 1000 1000" 
              preserveAspectRatio="none"
            >
              {drawings.map((d) => {
                if (d.type === 'line') return (
                  <line key={d.id} x1={d.coords[0][0]} y1={d.coords[0][1]} x2={d.coords[1][0]} y2={d.coords[1][1]} stroke={d.color} strokeWidth="4" />
                );
                
                if (d.type === 'price-level') return (
                  <g key={d.id} className="group/price-tag">
                    <line x1="0" y1={d.coords[0][1]} x2="1000" y2={d.coords[0][1]} stroke={d.color} strokeWidth="2.5" />
                    {/* Professional Price Tag at Right Side */}
                    <rect x="860" y={d.coords[0][1] - 18} width="140" height="36" rx="6" fill={d.color} />
                    <text 
                      x="930" 
                      y={d.coords[0][1] + 6} 
                      fill="white" 
                      fontSize="18" 
                      fontWeight="900" 
                      textAnchor="middle" 
                      style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.05em' }}
                    >
                      {d.label}
                    </text>
                  </g>
                );
                
                if (d.type === 'rect') return (
                  <rect key={d.id} 
                    x={Math.min(d.coords[0][0], d.coords[1][0])} 
                    y={Math.min(d.coords[0][1], d.coords[1][1])} 
                    width={Math.abs(d.coords[1][0] - d.coords[0][0])} 
                    height={Math.abs(d.coords[1][1] - d.coords[0][1])} 
                    stroke={d.color} fill={`${d.color}22`} strokeWidth="4" 
                  />
                );
                if (d.type === 'circle') {
                  const r = Math.sqrt(Math.pow(d.coords[1][0] - d.coords[0][0], 2) + Math.pow(d.coords[1][1] - d.coords[0][1], 2));
                  return (
                    <circle key={d.id} cx={d.coords[0][0]} cy={d.coords[0][1]} r={r} stroke={d.color} fill={`${d.color}22`} strokeWidth="4" />
                  );
                }
                if (d.type === 'text') return (
                  <text key={d.id} x={d.coords[0][0]} y={d.coords[0][1]} fill={d.color} fontSize="24" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                    {d.label}
                  </text>
                );
                return null;
              })}

              {isDrawing && currentPoints.length >= 2 && (
                <>
                  {activeTool === 'line' && <line x1={currentPoints[0][0]} y1={currentPoints[0][1]} x2={currentPoints[1][0]} y2={currentPoints[1][1]} stroke={activeColor} strokeWidth="4" strokeDasharray="8,8" />}
                  {activeTool === 'rect' && (
                    <rect 
                      x={Math.min(currentPoints[0][0], currentPoints[1][0])} 
                      y={Math.min(currentPoints[0][1], currentPoints[1][1])} 
                      width={Math.abs(currentPoints[1][0] - currentPoints[0][0])} 
                      height={Math.abs(currentPoints[1][1] - currentPoints[0][1])} 
                      stroke={activeColor} fill="transparent" strokeWidth="4" strokeDasharray="8,8" 
                    />
                  )}
                  {activeTool === 'circle' && (
                    <circle 
                      cx={currentPoints[0][0]} cy={currentPoints[0][1]} 
                      r={Math.sqrt(Math.pow(currentPoints[1][0] - currentPoints[0][0], 2) + Math.pow(currentPoints[1][1] - currentPoints[0][1], 2))} 
                      stroke={activeColor} fill="transparent" strokeWidth="4" strokeDasharray="8,8" 
                    />
                  )}
                </>
              )}
            </svg>
          </div>
        </div>

        {/* AI Insight Overlay */}
        {hoveredIndex !== null && (
          <div className="absolute bottom-6 left-6 right-6 bg-indigo-950/90 border border-indigo-400/30 p-5 rounded-3xl shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-300 z-50">
            <div className="flex items-start gap-4">
              <div className="bg-indigo-500 p-2 rounded-xl text-white shadow-lg"><Crosshair size={20} /></div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-indigo-400 text-[10px] font-black uppercase tracking-widest">{annotations[hoveredIndex].type}</span>
                  <h4 className="text-white font-bold">{annotations[hoveredIndex].label}</h4>
                </div>
                <p className="text-indigo-100/80 text-sm leading-relaxed max-w-2xl">{annotations[hoveredIndex].insight}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hidden lg:flex flex-col w-80 shrink-0 bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <List size={18} className="text-indigo-600" />
            Audit Objects
          </h3>
          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{annotations.length + drawings.length}</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          <div className="mb-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">AI Detection</p>
            {annotations.length === 0 ? (
              <div className="text-xs text-slate-400 italic py-4">Scanning structure...</div>
            ) : (
              annotations.map((ann, idx) => (
                <button
                  key={idx}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className={`w-full text-left p-3 rounded-xl transition-all border mb-2 ${
                    hoveredIndex === idx ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[ann.type] }} />
                    <span className="text-[9px] font-black uppercase text-slate-400">{ann.type}</span>
                  </div>
                  <h5 className="font-bold text-slate-800 text-xs">{ann.label}</h5>
                </button>
              ))
            )}
          </div>

          {drawings.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Manual Markups</p>
              {drawings.map((d) => (
                <div key={d.id} className="group relative flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl mb-2 hover:bg-white hover:border-slate-200 transition-all">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: d.color }}>
                    {d.type === 'line' && <Minus className="rotate-45" size={14} />}
                    {d.type === 'price-level' && <Hash size={14} />}
                    {d.type === 'rect' && <Square size={14} />}
                    {d.type === 'circle' && <Circle size={14} />}
                    {d.type === 'text' && <Type size={14} />}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className={`text-xs font-black text-slate-700 truncate ${d.type === 'price-level' ? 'font-mono tracking-wider' : ''}`}>
                      {d.label || `${d.type.charAt(0).toUpperCase() + d.type.slice(1)} Markup`}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{d.type}</p>
                  </div>
                  <button 
                    onClick={() => deleteDrawing(d.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-rose-500 hover:bg-rose-50 rounded-md transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

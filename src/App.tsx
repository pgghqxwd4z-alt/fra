import React, { Suspense, lazy, useState } from 'react';
import { AnalysisTab } from './types';
import Sidebar from './components/Sidebar';
import TradingSage from './components/TradingSage';
import Visualizer from './components/Visualizer';
import StrategyBoard from './components/StrategyBoard';
import KnowledgeBase from './components/KnowledgeBase';
import Framework from './components/Framework';
import MarketFeed from './components/MarketFeed';

const InventorySoftware = lazy(() => import('./components/InventorySoftware'));

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AnalysisTab>(AnalysisTab.INVENTORY);
  // Default closed so the header toggle button is reachable on mobile.
  // On lg+ screens the sidebar is forced visible via `lg:translate-x-0` in Sidebar.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderContent = () => {
    switch (activeTab) {
      case AnalysisTab.INVENTORY:
        return (
          <Suspense fallback={<div className="p-8 text-slate-400">Loading inventory suite...</div>}>
            <InventorySoftware />
          </Suspense>
        );
      case AnalysisTab.CHAT:
        return <TradingSage />;
      case AnalysisTab.VISUALIZER:
        return <Visualizer />;
      case AnalysisTab.STRATEGIES:
        return <StrategyBoard />;
      case AnalysisTab.WISDOM:
        return <KnowledgeBase />;
      case AnalysisTab.FRAMEWORK:
        return <Framework />;
      default:
        return <TradingSage />;
    }
  };

  return (
    <div className="flex h-screen bg-[#050507] text-gray-200 overflow-hidden font-sans selection:bg-emerald-500/30">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-white/5 flex items-center justify-between bg-[#050507]/80 backdrop-blur-xl z-40 shrink-0">
          <div className="flex items-center h-full px-8">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-xl transition-colors text-slate-500 hover:text-emerald-400 mr-6"
              title={sidebarOpen ? "Minimize Sidebar" : "Expand Sidebar"}
            >
              <i className={`fa-solid ${sidebarOpen ? 'fa-indent' : 'fa-outdent'} text-lg`}></i>
            </button>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></div>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60 whitespace-nowrap">
                {activeTab} <span className="text-white/20 mx-2">/</span> <span className="text-white">NODE_01</span>
              </h2>
            </div>
          </div>

          <MarketFeed />

          <div className="flex items-center gap-6 h-full px-8">
            <div className="hidden xl:flex items-center gap-3 px-4 py-1.5 bg-slate-900/50 rounded-full border border-white/5 text-[10px] font-mono text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              DATA_SYNC_OK
            </div>
            <div className="flex items-center gap-4 border-l border-white/5 pl-6">
              <button className="text-slate-500 hover:text-white transition-colors relative p-2 rounded-lg hover:bg-white/5">
                <i className="fa-solid fa-bell"></i>
                <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-rose-500 rounded-full border border-[#050507]"></span>
              </button>
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold text-emerald-400 font-mono cursor-default hover:bg-emerald-500/30 transition-colors">
                PRO
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 relative overflow-hidden p-4 bg-[radial-gradient(circle_at_50%_0%,_rgba(16,185,129,0.03)_0%,_transparent_50%)]">
          <div className="h-full w-full">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;

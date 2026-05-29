import React from 'react';
import { AnalysisTab } from '../types';

interface SidebarProps {
  activeTab: AnalysisTab;
  onTabChange: (tab: AnalysisTab) => void;
  isOpen: boolean;
  onClose?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, isOpen, onClose }) => {
  const menuItems = [
    { id: AnalysisTab.INVENTORY, icon: 'fa-warehouse', label: 'Inventory Suite' },
    { id: AnalysisTab.CHAT, icon: 'fa-robot', label: 'AI Advisor' },
    { id: AnalysisTab.VISUALIZER, icon: 'fa-chart-line', label: 'Deep Visualizer' },
    { id: AnalysisTab.FRAMEWORK, icon: 'fa-layer-group', label: 'Synthesis Workflow' },
    { id: AnalysisTab.STRATEGIES, icon: 'fa-chess', label: 'Strategy Hub' },
    { id: AnalysisTab.WISDOM, icon: 'fa-book-open', label: 'Wisdom Vault' },
  ];

  const handleTabChange = (id: AnalysisTab) => {
    onTabChange(id);
    // Auto-close on mobile only; on lg+ the sidebar is always visible.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onClose?.();
    }
  };

  return (
    <>
      {/* Mobile backdrop — click to close */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-300 w-64 bg-slate-950 border-r border-white/5 flex flex-col h-full`}>
        <div className="p-8">
          <div className="flex items-center justify-between gap-3 mb-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center border border-emerald-500/30">
                <i className="fa-solid fa-bolt text-emerald-500 text-xl"></i>
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white leading-tight">QuantSage</h1>
                <p className="text-[10px] text-white/40 font-mono tracking-widest uppercase">Institutional AI</p>
              </div>
            </div>
            {/* Close button — mobile only */}
            <button
              onClick={onClose}
              className="lg:hidden p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              aria-label="Close sidebar"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <nav className="space-y-2">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                  activeTab === item.id
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-500/5'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <i className={`fa-solid ${item.icon} w-5`}></i>
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-white/5">
          <div className="bg-emerald-500/5 rounded-2xl p-4 border border-emerald-500/10">
            <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 mb-1">Engine Status</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/60">Live Synced</span>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;

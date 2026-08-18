import React from 'react';
import { AnalysisTab } from '../types';

interface SidebarProps {
  activeTab: AnalysisTab;
  onTabChange: (tab: AnalysisTab) => void;
  isOpen: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, isOpen }) => {
  const menuItems = [
    { id: AnalysisTab.CHAT, icon: 'fa-robot', label: 'AI Advisor' },
    { id: AnalysisTab.VISUALIZER, icon: 'fa-chart-line', label: 'Deep Visualizer' },
    { id: AnalysisTab.FRAMEWORK, icon: 'fa-layer-group', label: 'Synthesis Workflow' },
    { id: AnalysisTab.STRATEGIES, icon: 'fa-chess', label: 'Strategy Hub' },
    { id: AnalysisTab.WISDOM, icon: 'fa-book-open', label: 'Wisdom Vault' },
  ];

  return (
    <aside className={`fixed lg:static inset-y-0 left-0 z-50 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 w-56 bg-slate-950 border-r border-white/5 flex flex-col h-full`}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center border border-emerald-500/30">
            <i className="fa-solid fa-bolt text-emerald-500 text-base"></i>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white leading-tight">QuantSage</h1>
            <p className="text-[9px] text-white/40 font-mono tracking-widest uppercase">Institutional AI</p>
          </div>
        </div>

        <nav className="space-y-1.5">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                activeTab === item.id
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-500/5'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <i className={`fa-solid ${item.icon} w-4`}></i>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-white/5">
        <div className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/10">
          <p className="text-[9px] uppercase font-bold tracking-widest text-emerald-500 mb-1">Engine Status</p>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/60">Live Synced</span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

import React from 'react';
import { BOOK_INSIGHTS } from '../constants';
import { KnowledgeItem } from '../types';

interface KnowledgeBaseProps {
  items?: KnowledgeItem[];
}

const KnowledgeItems: React.FC<{ items: KnowledgeItem[] }> = ({ items }) => {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={`${item.sourceId}-${item.principle}`} className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-white">{item.sourceTitle}</h3>
            {item.isLocal ? (
              <span className="text-[9px] uppercase tracking-widest text-amber-300/80 border border-amber-300/20 rounded px-1.5 py-0.5">
                local document
              </span>
            ) : item.sourceUrl ? (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[9px] uppercase tracking-widest text-sky-300/80 hover:text-sky-200"
              >
                source
              </a>
            ) : null}
          </div>
          <p className="text-sm text-slate-300">{item.principle}</p>
          <p className="text-xs text-slate-500 mt-2">{item.relevance}</p>
        </article>
      ))}
    </div>
  );
};

const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({ items = [] }) => {
  return (
    <div className="space-y-8 pb-10">
      <div className="mb-12">
        <h2 className="text-4xl font-bold text-white mb-3 tracking-tighter">Wisdom Vault</h2>
        <p className="text-slate-500 text-lg max-w-2xl">Foundational psychology and risk management from the world's most successful traders.</p>
      </div>

      <KnowledgeItems items={items} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {BOOK_INSIGHTS.map((book, i) => (
          <div key={i} className="glass-panel rounded-[2.5rem] p-10 flex flex-col md:flex-row gap-10 hover:border-emerald-500/30 transition-all group">
            <div className="w-full md:w-48 flex-shrink-0">
              <div className="aspect-[3/4] bg-emerald-500/10 rounded-[2rem] border border-emerald-500/20 flex flex-col items-center justify-center p-6 text-center shadow-inner group-hover:bg-emerald-500/20 transition-all">
                <i className={`fa-solid fa-${book.icon} text-4xl text-emerald-500 mb-6 opacity-40 group-hover:opacity-100 transition-opacity`}></i>
                <h4 className="text-xl font-bold text-white leading-tight mb-2">{book.title}</h4>
                <p className="text-[10px] text-emerald-500/60 font-mono uppercase tracking-widest">{book.author}</p>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-4">Strategic Intelligence</h3>
              <p className="text-slate-400 leading-relaxed mb-8">{book.summary}</p>
              <div>
                <h4 className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-4">Key Themes</h4>
                <div className="flex flex-wrap gap-2">
                  {book.keyThemes.map((theme, j) => (
                    <span key={j} className="text-[10px] bg-slate-900 border border-white/10 text-slate-300 px-3 py-1.5 rounded-full shadow-lg">
                      {theme}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KnowledgeBase;

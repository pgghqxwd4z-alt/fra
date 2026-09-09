import React, { FormEvent, useState } from 'react';
import { BOOK_INSIGHTS } from '../constants';
import { aiService } from '../services/aiService';
import { KnowledgeItem } from '../types';

type KnowledgeLens = 'smc' | 'gs' | 'psych' | 'ppa';

const LENSES: { id: KnowledgeLens; label: string }[] = [
  { id: 'smc', label: 'SMC' },
  { id: 'gs', label: 'Institutional' },
  { id: 'psych', label: 'Psychology' },
  { id: 'ppa', label: 'Price action' },
];

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

const KnowledgeBase: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [lenses, setLenses] = useState<KnowledgeLens[]>(['smc']);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleLens = (lens: KnowledgeLens) => {
    setLenses((current) =>
      current.includes(lens) ? current.filter((value) => value !== lens) : [...current, lens]
    );
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || !lenses.length || loading) return;
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const result = await aiService.searchKnowledge(prompt.trim(), lenses);
      setItems(result.items);
    } catch (searchError) {
      setItems([]);
      setError(searchError instanceof Error ? searchError.message : 'Knowledge search failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="mb-12">
        <h2 className="text-4xl font-bold text-white mb-3 tracking-tighter">Wisdom Vault</h2>
        <p className="text-slate-500 text-lg max-w-2xl">Foundational psychology and risk management from the world's most successful traders.</p>
      </div>

      <section className="glass-panel rounded-[2rem] p-6 border border-white/10 bg-slate-900/30">
        <div className="mb-5">
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Knowledge Search</h3>
          <p className="text-xs text-slate-500 mt-2">Search live research and local user-supplied principles.</p>
        </div>
        <form onSubmit={search} className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask what the library says about…"
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || !lenses.length || loading}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold px-5 py-3 rounded-xl text-xs uppercase tracking-widest transition-colors"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {LENSES.map((lens) => {
              const active = lenses.includes(lens.id);
              return (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => toggleLens(lens.id)}
                  className={`px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-widest transition-colors ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/10 bg-black/20 text-slate-500 hover:text-white'
                  }`}
                >
                  {lens.label}
                </button>
              );
            })}
          </div>
        </form>
        <div className="mt-5">
          {loading && <p className="text-xs text-slate-500">Searching knowledge sources…</p>}
          {!loading && error && <p className="text-xs text-rose-400">{error}</p>}
          {!loading && !error && !searched && (
            <p className="text-xs text-slate-500">No query yet. Search for a principle or setup.</p>
          )}
          {!loading && !error && searched && !items.length && (
            <p className="text-xs text-slate-500">No matching principles found.</p>
          )}
          {!loading && !error && <KnowledgeItems items={items} />}
        </div>
      </section>

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

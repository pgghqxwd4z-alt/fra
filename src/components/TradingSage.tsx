import React, { useState, useRef, useEffect } from 'react';
import { geminiService } from '../services/geminiService';
import { Message } from '../types';

const TradingSage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const welcome: Message = {
      role: 'model',
      content: "Welcome to the QuantSage Institutional Terminal. I can analyze market trends, news, setups, and robot-trader execution plans using live grounding, SMC, pure price action, institutional flow, risk discipline, and correction logic. How can I assist your edge today?",
      timestamp: Date.now()
    };
    const saved = localStorage.getItem('quantsage_chat_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          return;
        }
        localStorage.removeItem('quantsage_chat_history');
      } catch {
        localStorage.removeItem('quantsage_chat_history');
      }
    }
    setMessages([welcome]);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('quantsage_chat_history', JSON.stringify(messages));
    }
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const response = await geminiService.chatWithGrounding(input, history);

      setMessages(prev => [...prev, {
        role: 'model',
        content: response.text,
        groundingMetadata: response.grounding,
        timestamp: Date.now()
      }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        role: 'model',
        content: "Error: Terminal link failed. Please check connection and API key.",
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full glass-panel rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-5 ${
              msg.role === 'user'
                ? 'bg-emerald-600/90 text-white shadow-lg'
                : 'bg-slate-900 border border-white/5 text-slate-200 shadow-md'
            }`}>
              <div className="flex items-center gap-2 mb-2 opacity-40 text-[10px] uppercase font-mono tracking-widest">
                <span>{msg.role === 'user' ? 'Institutional_Trader' : 'QuantSage_Core'}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-sm lg:text-base">{msg.content}</p>

              {msg.groundingMetadata && (
                <div className="mt-4 pt-4 border-t border-white/5 flex flex-wrap gap-2">
                  {msg.groundingMetadata.map((chunk, cIdx) => (
                    <a key={cIdx} href={chunk.web?.uri} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/20 transition-all">
                      <i className="fa-solid fa-link mr-1"></i>
                      {chunk.web?.title || 'Source'}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-900 border border-white/5 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              <span className="text-[10px] text-emerald-400/60 font-mono uppercase tracking-widest">Searching live sources & processing...</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-6 bg-slate-950/50 border-t border-white/5">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask for market research, live verification, entries, exits, or corrections..."
            className="w-full bg-slate-900 border border-white/10 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 text-white placeholder:text-white/20 transition-all shadow-inner"
          />
          <button
            onClick={handleSend}
            disabled={loading}
            className="absolute right-3 p-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 rounded-xl transition-all shadow-lg active:scale-95"
          >
            <i className="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradingSage;

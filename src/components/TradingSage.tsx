import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { aiService } from '../services/aiService';
import { Message } from '../types';

const TradingSage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('quantsage_chat_history');
    if (saved) {
      setMessages(JSON.parse(saved));
    } else {
      setMessages([{
        role: 'model',
        content:
          "Welcome to the QuantSage Institutional Forecast Terminal. " +
          "I analyze current market structure, liquidity, displacement and " +
          "institutional reaction zones to determine the most likely NEXT price move.",
        timestamp: Date.now()
      }]);
    }
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

      const response = await aiService.chatWithGrounding(input, history);
      
      setMessages(prev => [...prev, {
        role: 'model',
        content: response.text,
        groundingMetadata: response.grounding,
        timestamp: Date.now()
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown terminal error";
      setMessages(prev => [...prev, {
        role: 'model',
        content: `Error: ${message}`,
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full glass-panel rounded-2xl overflow-hidden border border-white/5 shadow-xl">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-xl p-4 ${
              msg.role === 'user'
                ? 'bg-emerald-600/90 text-white shadow-lg'
                : 'bg-slate-900 border border-white/5 text-slate-200 shadow-md'
            }`}>
              <div className="flex items-center gap-2 mb-1.5 opacity-40 text-[9px] uppercase font-mono tracking-widest">
                <span>{msg.role === 'user' ? 'Trader' : 'SAGE'}</span>
              </div>
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap leading-relaxed text-xs lg:text-sm">{msg.content}</p>
              ) : (
                <div className="text-xs lg:text-sm leading-relaxed break-words [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:text-xs [&_h3]:font-bold [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_code]:text-emerald-300 [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/40 [&_pre]:p-2">
                  <ReactMarkdown
                    skipHtml
                    components={{
                      a: ({ children, ...props }) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 underline decoration-emerald-500/40 underline-offset-2 break-all hover:text-emerald-300"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
              
              {msg.groundingMetadata && (
                <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-1.5">
                  {msg.groundingMetadata.map((chunk, cIdx) => (
                    <a key={cIdx} href={chunk.web?.uri} target="_blank" rel="noreferrer" className="text-[9px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-md border border-emerald-500/20 hover:bg-emerald-500/20 transition-all">
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
            <div className="bg-slate-900 border border-white/5 rounded-xl p-3 flex items-center gap-2">
              <div className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce"></div>
              <div className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              <div className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
              <span className="text-[9px] text-emerald-400/60 font-mono uppercase tracking-widest">Processing...</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-950/50 border-t border-white/5">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask for next move, target, or forecast..."
            className="w-full bg-slate-900 border border-white/10 rounded-xl py-3 pl-5 pr-14 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 text-white text-sm placeholder:text-white/20 transition-all shadow-inner"
          />
          <button
            onClick={handleSend}
            disabled={loading}
            className="absolute right-2 p-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 rounded-lg transition-all shadow-lg active:scale-95"
          >
            <i className="fa-solid fa-paper-plane text-sm"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradingSage;

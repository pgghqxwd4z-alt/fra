import { GoogleGenAI, Type } from "@google/genai";
import { ChatMessage, AnalysisResult, NewsEvent } from "../types";

const STRICT_TRADING_KNOWLEDGE = `
  CRITICAL: DO NOT PROVIDE GENERIC AI SUGGESTIONS. ALL INSIGHTS MUST BE DERIVED EXCLUSIVELY FROM THESE 5 SOURCES:

  1. "Market Wizards" (Jack D. Schwager):
     - Principles of risk, independence, and the 'wizard' mindset of extreme discipline.

  2. Mark Douglas ("Trading in the Zone" & "The Disciplined Trader"):
     - The 5 Fundamental Truths of probabilistic thinking. Neutrality in outcome expectation.

  3. Smart Money Concepts (SMC):
     - Institutional Order Blocks, Liquidity Inducement, BOS, CHoCH, and FVG logic.

  4. Pure Price Action:
     - Horizontal levels, rejection logic, and trendline liquidity.

  5. Goldman Sachs Institutional Strategy:
     - Structural cycles, accumulation/distribution, and high-tier liquidity hunting.

  MACRO CONTEXT: Use Google Search to cross-reference Forex Factory economic calendar data. High impact news (Red Folders) must dictate a shift in Douglas-based risk expectations.
`;

const createAiClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export const fetchNewsCalendar = async (): Promise<NewsEvent[]> => {
  const ai = createAiClient();

  const searchResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "Fetch current high-impact economic news events for Forex markets today/this week from reliable sources like Forex Factory. Include time, currency, title, and impact.",
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  const newsText = searchResponse.text;
  const groundingChunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const urls = groundingChunks
    .filter(chunk => chunk.web?.uri)
    .map(chunk => chunk.web!.uri);
  const primarySourceUrl = urls[0] || '';

  const structResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Transform the following economic news raw text into a clean JSON array of news objects.
    Information:
    ${newsText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            currency: { type: Type.STRING },
            impact: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            time: { type: Type.STRING },
            actual: { type: Type.STRING },
            forecast: { type: Type.STRING },
            previous: { type: Type.STRING }
          },
          required: ["id", "title", "currency", "impact", "time"]
        }
      }
    }
  });

  try {
    const rawJson = structResponse.text || '[]';
    const parsedNews = JSON.parse(rawJson) as NewsEvent[];
    return parsedNews.map(item => ({
      ...item,
      sourceUrl: primarySourceUrl
    }));
  } catch (error) {
    console.error("Failed to parse structured news", error);
    return [];
  }
};

export const analyzeChatData = async (messages: ChatMessage[], news: NewsEvent[] = []): Promise<AnalysisResult> => {
  const ai = createAiClient();
  const snippet = messages.slice(-150).map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
  const newsContext = news.map(n => `${n.time} - ${n.currency} ${n.title} (Impact: ${n.impact})`).join('\n');

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `CONDUCT DEEP AUDIT: Analyze this trader conversation considering the current MACRO NEWS environment.

    Macro Calendar Data:
    ${newsContext}

    Transcript:
    ${snippet}`,
    config: {
      systemInstruction: `You are an Institutional Audit Engine. ${STRICT_TRADING_KNOWLEDGE}. Use deep reasoning to identify if traders are ignoring high-impact news or violating Douglas's principles during volatility.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          keyTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          psychologyInsights: { type: Type.STRING },
          strategyCritique: { type: Type.STRING },
          marketWizardsPrinciples: { type: Type.ARRAY, items: { type: Type.STRING } },
          frameworks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                framework: { type: Type.STRING },
                status: { type: Type.STRING, enum: ['Aligned', 'Violation', 'Neutral'] },
                insight: { type: Type.STRING }
              },
              required: ["framework", "status", "insight"]
            }
          },
          newsImpacts: {
             type: Type.ARRAY,
             items: {
               type: Type.OBJECT,
               properties: {
                 event: { type: Type.STRING },
                 impactOnTechnicals: { type: Type.STRING },
                 alignmentWithDouglas: { type: Type.STRING },
                 recommendation: { type: Type.STRING }
               },
               required: ["event", "impactOnTechnicals", "alignmentWithDouglas", "recommendation"]
             }
          },
          disciplineScore: { type: Type.NUMBER },
          unresolvedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["summary", "keyTopics", "psychologyInsights", "strategyCritique", "marketWizardsPrinciples", "frameworks", "disciplineScore", "unresolvedQuestions", "suggestedActions"]
      },
      thinkingConfig: { thinkingBudget: 16000 }
    }
  });

  return JSON.parse(response.text || '{}') as AnalysisResult;
};

export const analyzeTradingImage = async (base64Data: string, mimeType: string, news: NewsEvent[] = []): Promise<AnalysisResult> => {
  const ai = createAiClient();
  const newsContext = news.map(n => `${n.time} - ${n.currency} ${n.title} (Impact: ${n.impact})`).join('\n');

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        },
        {
          text: `DEEP VISUAL AUDIT: Identify structure strictly via SMC/PA/Goldman. Cross-reference this chart setup with the following economic events:
          ${newsContext}`
        }
      ]
    },
    config: {
      systemInstruction: `You are a Visual Institutional Auditor. ${STRICT_TRADING_KNOWLEDGE}. No generic advice. Identify if technical setups (SMC/PA) are at risk due to impending high-impact macro news.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          keyTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          psychologyInsights: { type: Type.STRING },
          strategyCritique: { type: Type.STRING },
          marketWizardsPrinciples: { type: Type.ARRAY, items: { type: Type.STRING } },
          frameworks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                framework: { type: Type.STRING },
                status: { type: Type.STRING, enum: ['Aligned', 'Violation', 'Neutral'] },
                insight: { type: Type.STRING }
              },
              required: ["framework", "status", "insight"]
            }
          },
          newsImpacts: {
             type: Type.ARRAY,
             items: {
               type: Type.OBJECT,
               properties: {
                 event: { type: Type.STRING },
                 impactOnTechnicals: { type: Type.STRING },
                 alignmentWithDouglas: { type: Type.STRING },
                 recommendation: { type: Type.STRING }
               },
               required: ["event", "impactOnTechnicals", "alignmentWithDouglas", "recommendation"]
             }
          },
          disciplineScore: { type: Type.NUMBER },
          unresolvedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          annotations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['BOS', 'CHoCH', 'OrderBlock', 'Liquidity', 'Support', 'Resistance', 'PsychologyZone'] },
                label: { type: Type.STRING },
                box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                insight: { type: Type.STRING }
              },
              required: ["type", "label", "box_2d", "insight"]
            }
          }
        },
        required: ["summary", "keyTopics", "psychologyInsights", "strategyCritique", "marketWizardsPrinciples", "frameworks", "disciplineScore", "unresolvedQuestions", "suggestedActions", "annotations"]
      },
      thinkingConfig: { thinkingBudget: 12000 }
    }
  });

  return JSON.parse(response.text || '{}') as AnalysisResult;
};

export const synthesizeGlobalAudit = async (results: AnalysisResult[]): Promise<AnalysisResult> => {
  const ai = createAiClient();
  const summaries = results.map((r, i) => `Audit ${i+1} Summary: ${r.summary}\nPsychology: ${r.psychologyInsights}\nTechnical: ${r.strategyCritique}`).join('\n---\n');

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `DEEP REASONING SYNTHESIS: Cross-analyze all uploaded charts, logs, and macro news impacts.
    Produce a final consolidated institutional conclusion.

    Audits to Synthesize:
    ${summaries}`,
    config: {
      systemInstruction: `You are the Master Performance Auditor. ${STRICT_TRADING_KNOWLEDGE}. Synthesize all technical, psychological, and macro context data into a single master report.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          keyTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          psychologyInsights: { type: Type.STRING },
          strategyCritique: { type: Type.STRING },
          marketWizardsPrinciples: { type: Type.ARRAY, items: { type: Type.STRING } },
          frameworks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                framework: { type: Type.STRING },
                status: { type: Type.STRING, enum: ['Aligned', 'Violation', 'Neutral'] },
                insight: { type: Type.STRING }
              },
              required: ["framework", "status", "insight"]
            }
          },
          disciplineScore: { type: Type.NUMBER },
          unresolvedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["summary", "keyTopics", "psychologyInsights", "strategyCritique", "marketWizardsPrinciples", "frameworks", "disciplineScore", "unresolvedQuestions", "suggestedActions"]
      },
      thinkingConfig: { thinkingBudget: 32768 }
    }
  });

  return JSON.parse(response.text || '{}') as AnalysisResult;
};

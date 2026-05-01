import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 8787);
const serveStatic = process.env.SERVE_STATIC !== 'false';

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

const FLASH_MODEL = 'gemini-1.5-flash';
const PRO_MODEL = 'gemini-1.5-pro';

const createAiClient = () => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing API_KEY or GEMINI_API_KEY environment variable');
  }

  return new GoogleGenAI({ apiKey });
};

const safeParseJson = (text, fallback) => {
  try {
    const cleaned = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned || JSON.stringify(fallback));
  } catch (error) {
    console.error('Failed to parse model JSON response', error);
    return fallback;
  }
};

const readRequestBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
};

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

const newsSchema = {
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
    required: ['id', 'title', 'currency', 'impact', 'time']
  }
};

const analysisSchema = (includeAnnotations = false) => ({
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
        required: ['framework', 'status', 'insight']
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
        required: ['event', 'impactOnTechnicals', 'alignmentWithDouglas', 'recommendation']
      }
    },
    disciplineScore: { type: Type.NUMBER },
    unresolvedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
    ...(includeAnnotations ? {
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
          required: ['type', 'label', 'box_2d', 'insight']
        }
      }
    } : {})
  },
  required: [
    'summary',
    'keyTopics',
    'psychologyInsights',
    'strategyCritique',
    'marketWizardsPrinciples',
    'frameworks',
    'disciplineScore',
    'unresolvedQuestions',
    'suggestedActions',
    ...(includeAnnotations ? ['annotations'] : [])
  ]
});

const emptyAnalysis = {
  summary: '',
  keyTopics: [],
  psychologyInsights: '',
  strategyCritique: '',
  marketWizardsPrinciples: [],
  frameworks: [],
  disciplineScore: 0,
  unresolvedQuestions: [],
  suggestedActions: []
};

const fetchNewsCalendar = async () => {
  const ai = createAiClient();
  const searchResponse = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: 'Fetch current high-impact economic news events for Forex markets today/this week from reliable sources like Forex Factory. Include time, currency, title, and impact.',
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  const newsText = searchResponse.text;
  const groundingChunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const urls = groundingChunks
    .filter(chunk => chunk.web?.uri)
    .map(chunk => chunk.web.uri);
  const primarySourceUrl = urls[0] || '';

  const structResponse = await ai.models.generateContent({
    model: FLASH_MODEL,
    contents: `Transform the following economic news raw text into a clean JSON array of news objects.
    Information:
    ${newsText}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: newsSchema
    }
  });

  const parsedNews = safeParseJson(structResponse.text, []);
  return parsedNews.map(item => ({
    ...item,
    sourceUrl: primarySourceUrl
  }));
};

const analyzeChatData = async ({ messages = [], news = [] }) => {
  const ai = createAiClient();
  const snippet = messages.slice(-150).map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
  const newsContext = news.map(n => `${n.time} - ${n.currency} ${n.title} (Impact: ${n.impact})`).join('\n');

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: `CONDUCT DEEP AUDIT: Analyze this trader conversation considering the current MACRO NEWS environment.

    Macro Calendar Data:
    ${newsContext}

    Transcript:
    ${snippet}`,
    config: {
      systemInstruction: `You are an Institutional Audit Engine. ${STRICT_TRADING_KNOWLEDGE}. Use deep reasoning to identify if traders are ignoring high-impact news or violating Douglas's principles during volatility.`,
      responseMimeType: 'application/json',
      responseSchema: analysisSchema(false)
    }
  });

  return safeParseJson(response.text, emptyAnalysis);
};

const analyzeTradingImage = async ({ base64Data, mimeType, news = [] }) => {
  const ai = createAiClient();
  const newsContext = news.map(n => `${n.time} - ${n.currency} ${n.title} (Impact: ${n.impact})`).join('\n');

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Data,
            mimeType
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
      responseMimeType: 'application/json',
      responseSchema: analysisSchema(true)
    }
  });

  return safeParseJson(response.text, { ...emptyAnalysis, annotations: [] });
};

const synthesizeGlobalAudit = async ({ results = [] }) => {
  const ai = createAiClient();
  const summaries = results.map((r, i) => `Audit ${i + 1} Summary: ${r.summary}\nPsychology: ${r.psychologyInsights}\nTechnical: ${r.strategyCritique}`).join('\n---\n');

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: `DEEP REASONING SYNTHESIS: Cross-analyze all uploaded charts, logs, and macro news impacts.
    Produce a final consolidated institutional conclusion.

    Audits to Synthesize:
    ${summaries}`,
    config: {
      systemInstruction: `You are the Master Performance Auditor. ${STRICT_TRADING_KNOWLEDGE}. Synthesize all technical, psychological, and macro context data into a single master report.`,
      responseMimeType: 'application/json',
      responseSchema: analysisSchema(false)
    }
  });

  return safeParseJson(response.text, emptyAnalysis);
};

const apiRoutes = {
  '/api/news-calendar': fetchNewsCalendar,
  '/api/analyze-chat': analyzeChatData,
  '/api/analyze-image': analyzeTradingImage,
  '/api/synthesize-audit': synthesizeGlobalAudit
};

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

const serveStaticFile = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const normalizedPath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.normalize(path.join(distDir, normalizedPath));

  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    const indexPath = path.join(distDir, 'index.html');
    const content = await readFile(indexPath);
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(content);
    return;
  }

  const content = await readFile(filePath);
  response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
  response.end(content);
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const route = apiRoutes[url.pathname];

    if (route) {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }

      const body = await readRequestBody(request);
      const result = await route(body);
      sendJson(response, 200, result);
      return;
    }

    if (serveStatic) {
      await serveStaticFile(request, response);
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Server error' });
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`TradeQuant Pro server listening on http://0.0.0.0:${port}`);
});

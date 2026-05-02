import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 8787);
const serveStatic = process.env.SERVE_STATIC !== 'false';
const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
const fastModel = process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant';
const reasoningModel = process.env.GROQ_REASONING_MODEL || 'llama-3.3-70b-versatile';
const visionModel = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

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

  MACRO CONTEXT: Consider high-impact economic calendar risk. High impact news (Red Folders) must dictate a shift in Douglas-based risk expectations.
`;

const getGroqApiKey = () => {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing GROQ_API_KEY environment variable');
  }

  return apiKey;
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

const groqJson = async ({ model, system, user, fallback, maxTokens = 2048, temperature = 0.2 }) => {
  const response = await fetch(groqUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getGroqApiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `${system}\nReturn only valid JSON. Do not wrap the JSON in markdown.` },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' },
      temperature,
      max_tokens: maxTokens
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Groq request failed with ${response.status}`);
  }

  const data = safeParseJson(text, {});
  const content = data.choices?.[0]?.message?.content;
  return safeParseJson(content, fallback);
};

const analysisShape = (includeAnnotations = false) => `{
  "summary": "string",
  "keyTopics": ["string"],
  "psychologyInsights": "string",
  "strategyCritique": "string",
  "marketWizardsPrinciples": ["string"],
  "frameworks": [{"framework": "string", "status": "Aligned|Violation|Neutral", "insight": "string"}],
  "newsImpacts": [{"event": "string", "impactOnTechnicals": "string", "alignmentWithDouglas": "string", "recommendation": "string"}],
  "disciplineScore": 0,
  "unresolvedQuestions": ["string"],
  "suggestedActions": ["string"]${includeAnnotations ? ',\n  "annotations": [{"type": "BOS|CHoCH|OrderBlock|Liquidity|Support|Resistance|PsychologyZone", "label": "string", "box_2d": [0, 0, 0, 0], "insight": "string"}]' : ''}
}`;

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
  const result = await groqJson({
    model: fastModel,
    system: 'You structure macroeconomic calendar data for forex traders.',
    user: `Return JSON with a single "events" array of likely high-impact forex macro events for this week.
Each event must have id, title, currency, impact ("High", "Medium", or "Low"), time, actual, forecast, previous, and sourceUrl.
If current live calendar data is unavailable, return an empty events array.
Schema: {"events":[{"id":"string","title":"string","currency":"string","impact":"High|Medium|Low","time":"string","actual":"string","forecast":"string","previous":"string","sourceUrl":"string"}]}`,
    fallback: { events: [] },
    maxTokens: 2048
  });

  return Array.isArray(result.events) ? result.events : [];
};

const analyzeChatData = async ({ messages = [], news = [] }) => {
  const snippet = messages.slice(-150).map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
  const newsContext = news.map(n => `${n.time} - ${n.currency} ${n.title} (Impact: ${n.impact})`).join('\n');

  return groqJson({
    model: reasoningModel,
    system: `You are an Institutional Audit Engine. ${STRICT_TRADING_KNOWLEDGE}. Use deep reasoning to identify if traders are ignoring high-impact news or violating Douglas's principles during volatility.`,
    user: `CONDUCT DEEP AUDIT: Analyze this trader conversation considering the current MACRO NEWS environment.

    Macro Calendar Data:
    ${newsContext}

    Transcript:
    ${snippet}

Return this JSON shape:
${analysisShape(false)}`,
    fallback: emptyAnalysis,
    maxTokens: 4096
  });
};

const analyzeTradingImage = async ({ base64Data, mimeType, news = [] }) => {
  const newsContext = news.map(n => `${n.time} - ${n.currency} ${n.title} (Impact: ${n.impact})`).join('\n');
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  const response = await fetch(groqUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getGroqApiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: visionModel,
      messages: [
        {
          role: 'system',
          content: `You are a Visual Institutional Auditor. ${STRICT_TRADING_KNOWLEDGE}. Return only valid JSON. Do not wrap the JSON in markdown.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `DEEP VISUAL AUDIT: Identify structure strictly via SMC/PA/Goldman. Cross-reference this chart setup with the following economic events:
              ${newsContext}

Return this JSON shape:
${analysisShape(true)}`
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 4096
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Groq request failed with ${response.status}`);
  }

  const data = safeParseJson(text, {});
  return safeParseJson(data.choices?.[0]?.message?.content, { ...emptyAnalysis, annotations: [] });
};

const synthesizeGlobalAudit = async ({ results = [] }) => {
  const summaries = results.map((r, i) => `Audit ${i + 1} Summary: ${r.summary}\nPsychology: ${r.psychologyInsights}\nTechnical: ${r.strategyCritique}`).join('\n---\n');

  return groqJson({
    model: reasoningModel,
    system: `You are the Master Performance Auditor. ${STRICT_TRADING_KNOWLEDGE}. Synthesize all technical, psychological, and macro context data into a single master report.`,
    user: `DEEP REASONING SYNTHESIS: Cross-analyze all uploaded charts, logs, and macro news impacts.
    Produce a final consolidated institutional conclusion.

    Audits to Synthesize:
    ${summaries}

Return this JSON shape:
${analysisShape(false)}`,
    fallback: emptyAnalysis,
    maxTokens: 4096
  });
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

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const dataDir = process.env.TRADEQUANT_DATA_DIR || path.join(__dirname, '.tradequant-data');
const authDbPath = path.join(dataDir, 'auth.json');
const port = Number(process.env.PORT || 8787);
const serveStatic = process.env.SERVE_STATIC !== 'false';
const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
const forexFactoryCalendarUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
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
    throw new Error(getClientErrorMessage(text, `Groq request failed with ${response.status}`));
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

const getClientErrorMessage = (text, fallback) => {
  const parsed = safeParseJson(text, null);
  return parsed?.error?.message || parsed?.error || fallback;
};

const normalizeImpact = (impact) => {
  const value = String(impact || '').toLowerCase();
  if (value.includes('high')) return 'High';
  if (value.includes('medium')) return 'Medium';
  return 'Low';
};

const normalizeNewsEvent = (event, index) => ({
  id: `${String(event.country || 'FX')}-${String(event.date || index)}-${String(event.title || 'event')}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80),
  title: String(event.title || 'Economic event'),
  currency: String(event.country || 'FX'),
  impact: normalizeImpact(event.impact),
  time: String(event.date || event.time || 'TBA'),
  actual: event.actual ? String(event.actual) : '',
  forecast: event.forecast ? String(event.forecast) : '',
  previous: event.previous ? String(event.previous) : '',
  sourceUrl: event.url ? String(event.url) : 'https://www.forexfactory.com/calendar'
});

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

const parseCookies = (header = '') => Object.fromEntries(
  header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
);

const setSessionCookie = (response, token) => {
  response.setHeader('Set-Cookie', `tq_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
};

const clearSessionCookie = (response) => {
  response.setHeader('Set-Cookie', 'tq_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
};

const permissions = ['demoData', 'newsTerminal', 'transcriptAudit', 'chartUpload', 'masterAudit'];
const defaultPermissions = Object.fromEntries(permissions.map(permission => [permission, true]));

const getPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  permissions: user.permissions,
  createdAt: user.createdAt,
  approvedAt: user.approvedAt,
  lastLoginAt: user.lastLoginAt,
  suspensionReason: user.suspensionReason
});

const loadAuthDb = async () => {
  if (!existsSync(authDbPath)) {
    return { users: [], sessions: {}, activities: [] };
  }

  return safeParseJson(await readFile(authDbPath, 'utf8'), { users: [], sessions: {}, activities: [] });
};

const saveAuthDb = async (db) => {
  await mkdir(dataDir, { recursive: true });
  await writeFile(authDbPath, JSON.stringify(db, null, 2));
};

const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, storedHash) => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
};

const addActivity = (db, user, type, details) => {
  db.activities.unshift({
    id: `act-${Date.now()}-${randomBytes(4).toString('hex')}`,
    userId: user?.id,
    userEmail: user?.email,
    type,
    details,
    createdAt: new Date().toISOString()
  });
  db.activities = db.activities.slice(0, 200);
};

const getAuthContext = async (request) => {
  const db = await loadAuthDb();
  const token = parseCookies(request.headers.cookie).tq_session;
  const session = token ? db.sessions[token] : null;
  const user = session ? db.users.find(item => item.id === session.userId) : null;
  return { db, token, user };
};

const requireApprovedUser = async (request, permission) => {
  const context = await getAuthContext(request);
  if (!context.user) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }

  if (context.user.status !== 'approved') {
    const error = new Error(context.user.status === 'suspended' ? 'Account suspended' : 'Account pending admin approval');
    error.status = 403;
    throw error;
  }

  if (permission && !context.user.permissions?.[permission]) {
    const error = new Error('Feature permission denied');
    error.status = 403;
    throw error;
  }

  return context;
};

const requireAdmin = async (request) => {
  const context = await requireApprovedUser(request);
  if (context.user.role !== 'admin') {
    const error = new Error('Admin access required');
    error.status = 403;
    throw error;
  }

  return context;
};

const authState = (db) => ({
  users: db.users.map(getPublicUser),
  activities: db.activities
});

const getSession = async (_, request) => {
  const { user } = await requireApprovedUser(request);
  return { user: getPublicUser(user) };
};

const registerUser = async ({ name = '', email = '', password = '' }) => {
  const db = await loadAuthDb();
  const normalizedEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();

  if (!cleanName || !normalizedEmail || String(password).length < 8) {
    const error = new Error('Name, email, and password with at least 8 characters are required');
    error.status = 400;
    throw error;
  }

  if (db.users.some(user => user.email === normalizedEmail)) {
    const error = new Error('A user with this email already exists');
    error.status = 409;
    throw error;
  }

  const isFirstUser = db.users.length === 0;
  const user = {
    id: `usr-${Date.now()}-${randomBytes(4).toString('hex')}`,
    name: cleanName,
    email: normalizedEmail,
    passwordHash: hashPassword(String(password)),
    role: isFirstUser ? 'admin' : 'user',
    status: isFirstUser ? 'approved' : 'pending',
    permissions: { ...defaultPermissions },
    createdAt: new Date().toISOString(),
    approvedAt: isFirstUser ? new Date().toISOString() : undefined
  };

  db.users.push(user);
  addActivity(db, user, isFirstUser ? 'admin.bootstrap' : 'registration.requested', isFirstUser ? 'First user registered as admin' : 'User requested account approval');
  await saveAuthDb(db);

  return {
    user: getPublicUser(user),
    message: isFirstUser ? 'Admin account created. You can sign in now.' : 'Registration submitted for admin approval.'
  };
};

const loginUser = async ({ email = '', password = '' }, request, response) => {
  const db = await loadAuthDb();
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.users.find(item => item.email === normalizedEmail);

  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  if (user.status !== 'approved') {
    const error = new Error(user.status === 'suspended' ? 'Account suspended' : 'Account pending admin approval');
    error.status = 403;
    throw error;
  }

  const token = randomBytes(32).toString('hex');
  db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
  user.lastLoginAt = new Date().toISOString();
  addActivity(db, user, 'auth.login', 'User signed in');
  await saveAuthDb(db);
  setSessionCookie(response, token);

  return { user: getPublicUser(user) };
};

const logoutUser = async (_, request, response) => {
  const db = await loadAuthDb();
  const token = parseCookies(request.headers.cookie).tq_session;
  const session = token ? db.sessions[token] : null;
  const user = session ? db.users.find(item => item.id === session.userId) : null;
  if (token) delete db.sessions[token];
  addActivity(db, user, 'auth.logout', 'User signed out');
  await saveAuthDb(db);
  clearSessionCookie(response);
  return { ok: true };
};

const getAdminState = async (_, request) => {
  const { db } = await requireAdmin(request);
  return authState(db);
};

const updateUserStatus = async ({ userId = '', status = '', reason = '' }, request) => {
  const { db, user: admin } = await requireAdmin(request);
  const target = db.users.find(user => user.id === userId);
  if (!target || !['pending', 'approved', 'denied', 'suspended'].includes(status)) {
    const error = new Error('Invalid user status update');
    error.status = 400;
    throw error;
  }

  target.status = status;
  target.approvedAt = status === 'approved' ? new Date().toISOString() : target.approvedAt;
  target.suspensionReason = status === 'suspended' ? String(reason).trim() : undefined;
  if (status !== 'approved') {
    for (const [token, session] of Object.entries(db.sessions)) {
      if (session.userId === target.id) delete db.sessions[token];
    }
  }

  addActivity(db, admin, 'admin.user_status', `${admin.email} set ${target.email} to ${status}`);
  await saveAuthDb(db);
  return authState(db);
};

const updateUserPermission = async ({ userId = '', permission = '', enabled = false }, request) => {
  const { db, user: admin } = await requireAdmin(request);
  const target = db.users.find(user => user.id === userId);
  if (!target || !permissions.includes(permission)) {
    const error = new Error('Invalid permission update');
    error.status = 400;
    throw error;
  }

  target.permissions = { ...defaultPermissions, ...target.permissions, [permission]: Boolean(enabled) };
  addActivity(db, admin, 'admin.permission', `${admin.email} ${enabled ? 'enabled' : 'disabled'} ${permission} for ${target.email}`);
  await saveAuthDb(db);
  return authState(db);
};

const recordAppActivity = async (request, permission, type, details) => {
  const context = await requireApprovedUser(request, permission);
  addActivity(context.db, context.user, type, details);
  await saveAuthDb(context.db);
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
  const response = await fetch(forexFactoryCalendarUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TradeQuantPro/1.0'
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Forex Factory calendar unavailable (${response.status})`);
  }

  const events = safeParseJson(text, []);
  if (!Array.isArray(events)) return [];

  return events
    .filter(event => ['High', 'Medium', 'Low'].includes(normalizeImpact(event.impact)))
    .map(normalizeNewsEvent);
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
    throw new Error(getClientErrorMessage(text, `Groq vision request failed with ${response.status}`));
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
  '/api/auth/session': { handler: getSession },
  '/api/auth/register': { handler: registerUser, public: true },
  '/api/auth/login': { handler: loginUser, public: true },
  '/api/auth/logout': { handler: logoutUser, public: true },
  '/api/admin/state': { handler: getAdminState },
  '/api/admin/users/status': { handler: updateUserStatus },
  '/api/admin/users/permissions': { handler: updateUserPermission },
  '/api/news-calendar': { handler: fetchNewsCalendar, permission: 'newsTerminal', activity: 'app.news' },
  '/api/analyze-chat': { handler: analyzeChatData, permission: 'transcriptAudit', activity: 'app.transcript_audit' },
  '/api/analyze-image': { handler: analyzeTradingImage, permission: 'chartUpload', activity: 'app.chart_audit' },
  '/api/synthesize-audit': { handler: synthesizeGlobalAudit, permission: 'masterAudit', activity: 'app.master_audit' }
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
      if (!route.public && route.permission) {
        await recordAppActivity(request, route.permission, route.activity, `Used ${route.permission}`);
      }
      const result = await route.handler(body, request, response);
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
    sendJson(response, error.status || 500, { error: error instanceof Error ? error.message : 'Server error' });
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`TradeQuant Pro server listening on http://0.0.0.0:${port}`);
});

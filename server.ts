import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { resolveGeminiModel, DEFAULT_GEMINI_MODEL } from "./geminiModelResolver";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  }) : null;

  /* =========================================================
     GEMINI MODEL RESOLVER
     ========================================================= */
  const GEMINI_MODEL = resolveGeminiModel(process.env.GEMINI_MODEL);

  console.log(`[Gemini] model=${GEMINI_MODEL}`);

  // All generateContent calls go through this wrapper.
  // We use ai.models.generateContent and ensure the model string has the "models/" prefix.
  const generateGeminiContent = async (request: any) => {
    const modelId = resolveGeminiModel(request.model || GEMINI_MODEL);
    const fullRequest = { ...request, model: modelId };
    
    try {
      return await ai!.models.generateContent(fullRequest);
    } catch (error: any) {
      const message = String(error?.message || error);
      // Fallback if the requested model failed
      if (modelId !== DEFAULT_GEMINI_MODEL) {
        console.warn(
          `[Gemini] Model "${modelId}" failed; retrying with "${DEFAULT_GEMINI_MODEL}". Error: ${message}`
        );
        return await ai!.models.generateContent({ ...request, model: DEFAULT_GEMINI_MODEL });
      }
      throw error;
    }
  };

  /* =========================================================
     KNOWLEDGE RETRIEVAL LAYER
     ========================================================= */
  type KnowledgeSource = {
    id: string;
    title: string;
    author?: string;
    kind: "BOOK" | "FRAMEWORK";
    allowedDomains?: string[];
  };

  const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
    {
      id: "trading-in-the-zone",
      title: "Trading in the Zone",
      author: "Mark Douglas",
      kind: "BOOK",
      allowedDomains: ["penguinrandomhouse.com", "books.google.com", "markdouglas.com"],
    },
    {
      id: "disciplined-trader",
      title: "The Disciplined Trader",
      author: "Mark Douglas",
      kind: "BOOK",
      allowedDomains: ["penguinrandomhouse.com", "books.google.com", "markdouglas.com"],
    },
    {
      id: "market-wizards",
      title: "Market Wizards",
      author: "Jack D. Schwager",
      kind: "BOOK",
      allowedDomains: ["wiley.com", "wiley-vch.de", "books.google.com"],
    },
    { id: "smc", title: "Smart Money Concepts", kind: "FRAMEWORK" },
    { id: "pure-price-action", title: "Pure Price Action", kind: "FRAMEWORK" },
    { id: "institutional-overlay", title: "Institutional / Macro Overlay", kind: "FRAMEWORK" },
  ];

  const knowledgeSchema = {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            sourceId: { type: Type.STRING },
            principle: { type: Type.STRING },
            relevance: { type: Type.STRING },
            sourceUrl: { type: Type.STRING },
            sourceTitleFromWeb: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
          required: ["sourceId", "principle", "relevance", "sourceUrl", "sourceTitleFromWeb", "confidence"],
        },
      },
      warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["items", "warnings"],
  };

  const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

  const sourceFor = (id: string) => KNOWLEDGE_SOURCES.find((s) => s.id === id);

  const safeSourceUrl = (raw: string | undefined, domains: string[] = []) => {
    if (!raw) return undefined;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      return domains.some((d) => host === d || host.endsWith(`.${d}`)) ? u.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  const routeKnowledge = (lenses: string[] = []) => {
    const ids = new Set<string>();
    for (const lens of lenses) {
      if (lens === "smc") ids.add("smc");
      if (lens === "ppa") ids.add("pure-price-action");
      if (lens === "psych") {
        ids.add("trading-in-the-zone");
        ids.add("disciplined-trader");
      }
      if (lens === "gs") {
        ids.add("institutional-overlay");
        ids.add("market-wizards");
      }
    }
    if (!ids.size) {
      ids.add("smc");
      ids.add("pure-price-action");
      ids.add("trading-in-the-zone");
      ids.add("disciplined-trader");
    }
    return [...ids];
  };

  const retrieveKnowledge = async (prompt: string, lenses: string[] = [], marketContext = "") => {
    const sourceIds = routeKnowledge(lenses);
    const sourceText = sourceIds.map((id) => `- ${id}`).join("\n");

    const retrievalPrompt = `
You are the QuantSage Knowledge Retrieval Agent.
Retrieve concise, decision-relevant principles for a later market-analysis agent.
Do NOT predict the market. Do NOT invent quotations. Do NOT reproduce copyrighted book passages.
Use short paraphrases only.

USER REQUEST:
${prompt || "Find principles relevant to the current trading analysis."}

MARKET CONTEXT:
${marketContext || "Not supplied."}

REQUESTED SOURCES:
${sourceText}

SOURCE POLICY:
- Prefer official publisher/author pages, legitimate previews, interviews and public material.
- Do not use pirate PDF sites, file-sharing sites, scraped book copies or unauthorized reproductions.
- If a book cannot be supported by a legitimate source, return a warning rather than inventing content.
- Never attribute a principle to a book without supporting evidence.

Return JSON only using the supplied schema.
`;

    const result = await generateGeminiContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: retrievalPrompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: knowledgeSchema,
        tools: [{ googleSearch: {} }],
      },
    });

    if (!result.text) return { items: [], warnings: ["Knowledge retrieval returned no text."] };

    const parsed = JSON.parse(result.text);
    const items = (parsed.items || []).flatMap((item: any) => {
      const source = sourceFor(item.sourceId);
      if (!source) return [];
      return [{
        sourceId: source.id,
        sourceTitle: source.title,
        author: source.author,
        kind: source.kind,
        principle: String(item.principle || ""),
        relevance: String(item.relevance || ""),
        sourceUrl: safeSourceUrl(item.sourceUrl, source.allowedDomains || []),
        sourceTitleFromWeb: String(item.sourceTitleFromWeb || ""),
        confidence: clamp01(Number(item.confidence)),
      }];
    });

    const context = items.length
      ? items.map((item: any, i: number) =>
          `${i + 1}. ${item.sourceTitle}${item.author ? ` — ${item.author}` : ""}\n` +
          `Principle: ${item.principle}\nRelevance: ${item.relevance}\n` +
          `Source: ${item.sourceUrl || "not provided"}\nConfidence: ${item.confidence}`
        ).join("\n\n")
      : "NO EXTERNAL KNOWLEDGE RETRIEVED.";

    return { items, context, warnings: parsed.warnings || [] };
  };

  // Helper to check for AI client
  const checkAiClient = (res: express.Response) => {
    if (!ai) {
      res.status(500).json({ error: "GEMINI_API_KEY environment variable is not set." });
      return false;
    }
    return true;
  };

  /* =========================================================
     FORECAST SCHEMA
     ========================================================= */

  const forecastSchema = {
    type: Type.OBJECT,
    properties: {
      currentState: { type: Type.STRING },
      bias: { type: Type.STRING, enum: ["BULLISH", "BEARISH", "NEUTRAL"] },
      confidence: { type: Type.NUMBER },
      nextMove: { type: Type.STRING },
      expectedPath: { type: Type.ARRAY, items: { type: Type.STRING } },
      liquidityTarget: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ["BUY_SIDE", "SELL_SIDE", "UNKNOWN"] },
          level: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["type", "level", "reason"]
      },
      retracement: {
        type: Type.OBJECT,
        properties: {
          expected: { type: Type.BOOLEAN },
          zone: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["expected", "zone", "reason"]
      },
      entry: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING, enum: ["BUY", "SELL", "WAIT"] },
          zone: { type: Type.STRING },
          confirmation: { type: Type.STRING }
        },
        required: ["direction", "zone", "confirmation"]
      },
      targets: {
        type: Type.OBJECT,
        properties: {
          tp1: { type: Type.STRING },
          tp2: { type: Type.STRING },
          final: { type: Type.STRING }
        },
        required: ["tp1", "tp2", "final"]
      },
      invalidation: { type: Type.STRING },
      primaryScenario: { type: Type.STRING },
      alternativeScenario: { type: Type.STRING },
      nextEvent: { type: Type.STRING },
      structuralEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      warnings: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: [
      "currentState", "bias", "confidence", "nextMove", "expectedPath",
      "liquidityTarget", "retracement", "entry", "targets", "invalidation",
      "primaryScenario", "alternativeScenario", "nextEvent", "structuralEvidence", "warnings"
    ]
  };

  const FORECAST_SYSTEM_PROMPT = `
You are QuantSage Pro, a forward-looking institutional market analysis engine.

Your primary objective is NOT to explain what has already happened.

Your primary objective is to determine:

"WHAT IS THE MOST LIKELY NEXT PRICE MOVE FROM THE CURRENT MARKET STATE?"

You must distinguish between:

PAST:
What has already happened.

PRESENT:
What price is doing now.

FUTURE:
What price is most likely to do next.

Historical price action is evidence only.
Do not spend most of the response describing historical candles.

==================================================
ANALYSIS PIPELINE
==================================================

STEP 1 — CURRENT STATE

Determine:

- Current market structure
- Current price location
- Higher-timeframe directional bias if visible
- Swing highs
- Swing lows
- Buy-side liquidity
- Sell-side liquidity
- Order Blocks
- Fair Value Gaps
- Displacement
- BOS
- CHoCH
- Premium / Discount
- Support / Resistance

STEP 2 — LIQUIDITY MAP

Determine:

- Which liquidity has already been taken
- Which liquidity remains
- Which liquidity pool is the most attractive next target
- Whether price is likely to seek buy-side or sell-side liquidity

Do NOT automatically assume the nearest liquidity is the target.

STEP 3 — INSTITUTIONAL INTERPRETATION

Infer probable market intent from observable price structure.

Possible behaviors:

- Liquidity sweep
- Accumulation
- Distribution
- Continuation
- Reversal
- FVG mitigation
- Order Block mitigation
- Stop hunt
- Displacement
- Expansion

Never claim access to private institutional orders.

Use observable market structure only.

STEP 4 — FORECAST

This is the MOST IMPORTANT step.

Predict the most likely NEXT price sequence.

Think:

CURRENT PRICE
↓
NEXT EVENT
↓
RETRACEMENT
↓
ENTRY ZONE
↓
DISPLACEMENT
↓
LIQUIDITY TARGET

Choose ONE primary scenario.

Do not give three equally weighted possibilities.

STEP 5 — ENTRY

Determine whether an actionable entry currently exists.

Possible outputs:

BUY
SELL
WAIT

If confirmation has not occurred:

WAIT.

Never manufacture an entry.

STEP 6 — INVALIDATION

Determine exactly what price behavior would invalidate the primary thesis.

The invalidation must be structural.

STEP 7 — ALTERNATIVE

Provide only ONE alternative scenario.

==================================================
FORECAST RULES
==================================================

Use forward-looking reasoning.

Prefer:

"Price is most likely to..."
"The next event is likely to..."
"The expected path is..."
"If price reaches..."
"The forecast becomes invalid if..."

Avoid making the response primarily:

"Price did..."
"Price formed..."
"This candle caused..."
"The market already..."

Do not pretend the future is known.

This is a probabilistic forecast.

==================================================
CONFIDENCE
==================================================

Confidence must represent the strength of visible evidence.

Do not give artificially high confidence.

If the chart is ambiguous, lower confidence.

If there is no valid setup:

entry.direction = WAIT

and include:

"NO HIGH-PROBABILITY ENTRY — WAIT."

==================================================
FINAL PRIORITY
==================================================

The most important output is:

NEXT MOVE

The analysis should answer:
1. Where is price now?
2. What is most likely to happen next?
3. What liquidity is likely to be targeted?
4. Where could the retracement occur?
5. Where is the potential entry?
6. What is the target?
7. What invalidates the forecast?
`;

  // API Routes
  app.post("/api/knowledge/search", async (req, res) => {
    if (!checkAiClient(res)) return;
    try {
      const { prompt, lenses = ["smc"], marketContext = "" } = req.body;
      const knowledge = await retrieveKnowledge(prompt, lenses, marketContext);
      res.json(knowledge);
    } catch (error: any) {
      console.error("Knowledge Retrieval Error:", error);
      res.status(500).json({ error: error?.message || "Knowledge retrieval failed" });
    }
  });

  app.post("/api/annotate", async (req, res) => {
    if (!checkAiClient(res)) return;
    const { base64Image, prompt, lenses = ["smc"], marketContext = "" } = req.body;

    try {
      const knowledge = await retrieveKnowledge(prompt, lenses, marketContext);
      const instructions: string[] = [];

      lenses.forEach((lens: string) => {
        switch (lens) {
          case 'smc': instructions.push("SMC: Use observable structure. Do not invent BOS, CHoCH, FVG, OB or liquidity levels."); break;
          case 'gs': instructions.push("INSTITUTIONAL / MACRO: Use macro/intermarket claims only when supplied or retrieved from legitimate evidence."); break;
          case 'psych': instructions.push("PSYCHOLOGY: Apply retrieved probability/discipline principles. Do not claim private positioning as fact."); break;
          case 'ppa': instructions.push("PURE PRICE ACTION: Analyze observable swing structure, momentum, rejection, expansion and support/resistance."); break;
        }
      });

      const augmentedPrompt = `${FORECAST_SYSTEM_PROMPT}

LENSES:
${instructions.join("\n")}

RETRIEVED KNOWLEDGE:
${knowledge.context}

KNOWLEDGE WARNINGS:
${knowledge.warnings.join("\n") || "None"}

MARKET CONTEXT:
${marketContext || "Not supplied."}

USER DIRECTIVE:
${prompt || "Analyze the supplied chart."}

KNOWLEDGE RULES:
- Retrieved knowledge is framework guidance, not market data.
- Never fabricate book quotations.
- Do not attribute unsupported claims to an author.
- Knowledge cannot override observable market evidence.
- If required confirmation is absent, return WAIT.

Return ONLY valid JSON matching the requested forecast schema.`;

      const result = await generateGeminiContent({
        model: GEMINI_MODEL,
        contents: [{
          role: "user",
          parts: [
            { inlineData: { data: base64Image, mimeType: "image/png" } },
            { text: augmentedPrompt }
          ]
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: forecastSchema,
        }
      });

      const text = result.text;
      if (!text) throw new Error("No response text from model");
      res.json({
        analysis: text,
        forecast: JSON.parse(text),
        knowledge: { items: knowledge.items, warnings: knowledge.warnings },
      });
    } catch (error: any) {
      console.error("Annotate error:", error);
      res.status(500).json({ error: error?.message || "Forecast failed" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    if (!checkAiClient(res)) return;
    const { prompt, history } = req.body;

    try {
      const chat = ai!.chats.create({ 
        model: GEMINI_MODEL,
        config: {
          systemInstruction: FORECAST_SYSTEM_PROMPT,
          tools: [{ googleSearch: {} }]
        },
        history: history.map((h: any) => ({
          role: h.role,
          parts: [{ text: h.parts[0].text }]
        }))
      });

      const result = await chat.sendMessage({ message: prompt });
      
      res.json({
        text: result.text,
        grounding: result.candidates?.[0]?.groundingMetadata?.groundingChunks
      });
    } catch (error: any) {
      console.error("Chat error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "false" ? true : false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

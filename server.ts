import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
type AIProvider = "openai" | "groq";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const AI_PROVIDER: AIProvider = process.env.AI_PROVIDER === "groq" ? "groq" : "openai";
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const ai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;
  const groqAi = groqApiKey
    ? new OpenAI({ apiKey: groqApiKey, baseURL: "https://api.groq.com/openai/v1" })
    : null;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
  const GROQ_MODEL = process.env.GROQ_MODEL || "groq/compound";
  const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";

  console.log(
    AI_PROVIDER === "groq"
      ? `[Groq] model=${GROQ_MODEL} visionModel=${GROQ_VISION_MODEL}`
      : `[OpenAI] model=${OPENAI_MODEL}`
  );

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
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sourceId: { type: "string" },
            principle: { type: "string" },
            relevance: { type: "string" },
            sourceUrl: { type: "string" },
            sourceTitleFromWeb: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["sourceId", "principle", "relevance", "sourceUrl", "sourceTitleFromWeb", "confidence"],
          additionalProperties: false,
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["items", "warnings"],
    additionalProperties: false,
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

  const mapKnowledgeResult = (parsed: any) => {
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

    if (AI_PROVIDER === "groq") {
      const result = await groqAi!.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: retrievalPrompt }],
        response_format: { type: "json_object" },
      });
      const text = result.choices[0]?.message?.content;
      if (!text || typeof text !== "string") {
        return { items: [], context: "NO EXTERNAL KNOWLEDGE RETRIEVED.", warnings: ["Knowledge retrieval returned no text."] };
      }
      return mapKnowledgeResult(JSON.parse(text));
    }

    const searchResult = await ai!.responses.create({
      model: OPENAI_MODEL,
      tools: [{ type: "web_search" }],
      input: retrievalPrompt,
    });
    const sourceMaterial = searchResult.output_text || "No web search material was returned.";
    const result = await ai!.responses.create({
      model: OPENAI_MODEL,
      input: `${retrievalPrompt}

WEB SEARCH MATERIAL:
${sourceMaterial}

Convert the material above into the requested JSON schema. Return JSON only.`,
      text: {
        format: {
          type: "json_schema",
          name: "knowledge_retrieval",
          strict: true,
          schema: knowledgeSchema,
        },
      },
    });

    if (!result.output_text) return { items: [], context: "NO EXTERNAL KNOWLEDGE RETRIEVED.", warnings: ["Knowledge retrieval returned no text."] };
    return mapKnowledgeResult(JSON.parse(result.output_text));
  };

  // Helper to check for AI client
  const checkAiClient = (res: express.Response) => {
    const missingKey = AI_PROVIDER === "groq"
      ? "GROQ_API_KEY environment variable is not set."
      : "OPENAI_API_KEY environment variable is not set.";
    if (AI_PROVIDER === "groq" ? !groqAi : !ai) {
      res.status(500).json({ error: missingKey });
      return false;
    }
    return true;
  };

  /* =========================================================
     FORECAST SCHEMA
     ========================================================= */

  const forecastSchema = {
    type: "object",
    properties: {
      currentState: { type: "string" },
      bias: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL"] },
      confidence: {
        type: "number",
        description: "An integer confidence percentage from 0 to 100.",
      },
      nextMove: { type: "string" },
      expectedPath: { type: "array", items: { type: "string" } },
      liquidityTarget: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["BUY_SIDE", "SELL_SIDE", "UNKNOWN"] },
          level: { type: "string" },
          reason: { type: "string" }
        },
        required: ["type", "level", "reason"],
        additionalProperties: false,
      },
      retracement: {
        type: "object",
        properties: {
          expected: { type: "boolean" },
          zone: { type: "string" },
          reason: { type: "string" }
        },
        required: ["expected", "zone", "reason"],
        additionalProperties: false,
      },
      entry: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["BUY", "SELL", "WAIT"] },
          zone: { type: "string" },
          confirmation: { type: "string" }
        },
        required: ["direction", "zone", "confirmation"],
        additionalProperties: false,
      },
      targets: {
        type: "object",
        properties: {
          tp1: { type: "string" },
          tp2: { type: "string" },
          final: { type: "string" }
        },
        required: ["tp1", "tp2", "final"],
        additionalProperties: false,
      },
      invalidation: { type: "string" },
      primaryScenario: { type: "string" },
      alternativeScenario: { type: "string" },
      nextEvent: { type: "string" },
      structuralEvidence: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } }
    },
    required: [
      "currentState", "bias", "confidence", "nextMove", "expectedPath",
      "liquidityTarget", "retracement", "entry", "targets", "invalidation",
      "primaryScenario", "alternativeScenario", "nextEvent", "structuralEvidence", "warnings"
    ],
    additionalProperties: false,
  };

  const groqForecastSchemaPrompt = `
Return a JSON object matching this forecast schema exactly. Include every property shown, use the enum values exactly, and do not add properties:
${JSON.stringify(forecastSchema, null, 2)}
`;

  const asText = (value: any) => typeof value === "string" ? value : value == null ? "" : String(value);
  const asTextArray = (value: any) => Array.isArray(value) ? value.map(asText) : [];
  const normalizeForecast = (value: any) => {
    const source = value && typeof value === "object" ? value : {};
    const liquidityTarget = source.liquidityTarget && typeof source.liquidityTarget === "object"
      ? source.liquidityTarget
      : {};
    const retracement = source.retracement && typeof source.retracement === "object"
      ? source.retracement
      : {};
    const entry = source.entry && typeof source.entry === "object" ? source.entry : {};
    const targets = source.targets && typeof source.targets === "object" ? source.targets : {};
    const rawBias = asText(source.bias);
    const rawDirection = asText(entry.direction);
    const rawLiquidityType = asText(liquidityTarget.type);
    const rawConfidence = Number(source.confidence);

    return {
      currentState: asText(source.currentState),
      bias: ["BULLISH", "BEARISH", "NEUTRAL"].includes(rawBias) ? rawBias : "NEUTRAL",
      confidence: Number.isFinite(rawConfidence)
        ? Math.round(Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)))
        : 0,
      nextMove: asText(source.nextMove),
      expectedPath: asTextArray(source.expectedPath),
      liquidityTarget: {
        type: ["BUY_SIDE", "SELL_SIDE", "UNKNOWN"].includes(rawLiquidityType) ? rawLiquidityType : "UNKNOWN",
        level: asText(liquidityTarget.level),
        reason: asText(liquidityTarget.reason),
      },
      retracement: {
        expected: Boolean(retracement.expected),
        zone: asText(retracement.zone),
        reason: asText(retracement.reason),
      },
      entry: {
        direction: ["BUY", "SELL", "WAIT"].includes(rawDirection) ? rawDirection : "WAIT",
        zone: asText(entry.zone),
        confirmation: asText(entry.confirmation),
      },
      targets: {
        tp1: asText(targets.tp1),
        tp2: asText(targets.tp2),
        final: asText(targets.final),
      },
      invalidation: asText(source.invalidation),
      primaryScenario: asText(source.primaryScenario),
      alternativeScenario: asText(source.alternativeScenario),
      nextEvent: asText(source.nextEvent),
      structuralEvidence: asTextArray(source.structuralEvidence),
      warnings: asTextArray(source.warnings),
    };
  };

  const parseJsonObject = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Model returned invalid JSON.");
      return JSON.parse(match[0]);
    }
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

  const stripCitationMarkers = (text: string) =>
    text.replace(
      /[\uE000-\uF8FF]*cite[\uE000-\uF8FF]*[A-Za-z0-9_-]+[\uE000-\uF8FF]*/gi,
      (match) => (/[\uE000-\uF8FF]/.test(match) ? "" : match)
    );

  const mapGroqGrounding = (result: any) => {
    const chunks: { web: { uri: string; title: string } }[] = [];
    const seen = new Set<string>();
    const add = (candidate: any) => {
      if (!candidate || typeof candidate !== "object") return;
      const uri = candidate.url || candidate.uri || candidate.source_url || candidate.link;
      if (typeof uri !== "string" || !/^https?:\/\//i.test(uri) || seen.has(uri)) return;
      seen.add(uri);
      chunks.push({
        web: {
          uri,
          title: String(candidate.title || candidate.name || candidate.source?.title || uri),
        },
      });
    };
    const visit = (value: any): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        add(value);
        Object.entries(value).forEach(([key, child]) => {
          if (/citation|source|result|tool/i.test(key)) visit(child);
        });
      }
    };

    visit(result?.choices?.[0]?.message?.annotations);
    visit(result?.choices?.[0]?.message?.citations);
    visit(result?.choices?.[0]?.message?.executed_tools);
    visit(result?.citations);
    return chunks;
  };

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

Return ONLY valid JSON matching the requested forecast schema.${AI_PROVIDER === "groq" ? groqForecastSchemaPrompt : ""}`;

      let forecast: any;
      if (AI_PROVIDER === "groq") {
        const result = await groqAi!.chat.completions.create({
          model: GROQ_VISION_MODEL,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } },
              { type: "text", text: augmentedPrompt },
            ],
          }],
          response_format: { type: "json_object" },
        });
        const text = result.choices[0]?.message?.content;
        if (!text || typeof text !== "string") throw new Error("No response text from model");
        forecast = normalizeForecast(parseJsonObject(text));
      } else {
        const result = await ai!.responses.create({
          model: OPENAI_MODEL,
          input: [{
            role: "user",
            content: [
              { type: "input_image", image_url: `data:image/png;base64,${base64Image}`, detail: "auto" },
              { type: "input_text", text: augmentedPrompt },
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "forecast",
              strict: true,
              schema: forecastSchema,
            },
          },
        });

        const text = result.output_text;
        if (!text) throw new Error("No response text from model");
        forecast = JSON.parse(text);
        const rawConfidence = Number(forecast.confidence);
        forecast.confidence = Number.isFinite(rawConfidence)
          ? Math.round(Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)))
          : 0;
      }

      res.json({
        analysis: JSON.stringify(forecast),
        forecast,
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
      if (AI_PROVIDER === "groq") {
        const result = await groqAi!.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: FORECAST_SYSTEM_PROMPT },
            ...((history || []).map((h: any) => ({
              role: h.role === "model" || h.role === "assistant" ? "assistant" : "user",
              content: h.parts?.[0]?.text || h.text || "",
            }))),
            { role: "user", content: prompt },
          ],
        });
        const text = result.choices[0]?.message?.content;
        if (!text || typeof text !== "string") throw new Error("No response text from model");
        res.json({
          text: stripCitationMarkers(text),
          grounding: mapGroqGrounding(result),
        });
        return;
      }

      const result = await ai!.responses.create({
        model: OPENAI_MODEL,
        instructions: FORECAST_SYSTEM_PROMPT,
        tools: [{ type: "web_search" }],
        input: [
          ...((history || []).map((h: any) => {
            const isAssistant = h.role === "model" || h.role === "assistant";
            return {
              role: isAssistant ? "assistant" : "user",
              content: [{
                type: isAssistant ? "output_text" : "input_text",
                text: h.parts?.[0]?.text || h.text || "",
              }],
            };
          })),
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
      });

      const grounding = result.output.flatMap((item: any) =>
        item.type === "message"
          ? item.content.flatMap((content: any) =>
              (content.annotations || [])
                .filter((annotation: any) => annotation.type === "url_citation")
                .map((annotation: any) => ({
                  web: { uri: annotation.url, title: annotation.title || annotation.url },
                }))
            )
          : []
      );
      res.json({
        text: stripCitationMarkers(result.output_text),
        grounding,
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
    const clientDistPath = path.join(process.cwd(), 'dist', 'client');
    app.use(express.static(clientDistPath));
    app.get('*', (req, res) => {
      if (path.extname(req.path)) {
        res.status(404).end();
        return;
      }
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

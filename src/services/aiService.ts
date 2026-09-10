import {
  ForecastResult,
  GroundingChunk,
  MarketResearch,
  MarketVerification,
  ForecastRecord,
  ForecastStats,
  Consensus,
  Risk,
  FastScan,
  KnowledgeResult,
  ValidationResult,
  ChartTimeframe,
  DataGrounding,
  GroundingReport
} from "../types";

interface ChatResponse {
  text: string;
  grounding?: GroundingChunk[];
  forecast?: ForecastResult;
}

interface AnnotateResponse {
  image: string | null;
  analysis: string;
  forecast: ForecastResult | null;
  marketVerification?: MarketVerification;
  marketResearch?: MarketResearch;
  consensus?: Consensus;
  risk?: Risk;
  scan?: FastScan;
  validation?: ValidationResult;
  validationUnavailable?: string;
  dataGrounding?: DataGrounding;
  grounding?: GroundingReport;
}

interface TrackRecordResponse {
  forecasts: ForecastRecord[];
  stats: ForecastStats;
}

interface ScoreResponse {
  scored: number;
  pending: number;
  skipped: number;
}

interface HistoryEntry {
  role: string;
  parts: {
    text: string;
  }[];
}

const throwResponseError = async (response: Response, fallback: string): Promise<never> => {
  let message = response.statusText || fallback;
  try {
    const body = await response.json();
    if (typeof body?.error === "string" && body.error.trim()) {
      message = body.error;
    }
  } catch {
    // Keep the status text when the server did not return JSON.
  }
  throw new Error(message);
};

export const aiService = {

  async annotateChart(
    base64Image: string,
    prompt: string,
    lenses: string[] = ['smc'],
    timeframe?: ChartTimeframe
  ): Promise<AnnotateResponse> {
    try {
      const response = await fetch("/api/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image, prompt, lenses, timeframe })
      });

      if (!response.ok) {
        await throwResponseError(response, "Failed to annotate chart");
      }

      const data = await response.json();
      return {
        image: null,
        analysis: data.analysis,
        forecast: data.forecast,
        marketVerification: data.marketVerification,
        marketResearch: data.marketResearch,
        consensus: data.consensus,
        risk: data.risk,
        scan: data.scan,
        validation: data.validation,
        validationUnavailable: data.validationUnavailable,
        dataGrounding: data.dataGrounding,
        grounding: data.grounding
      };
    } catch (error) {
      console.error("Forecast Error:", error);
      throw error;
    }
  },

  async searchKnowledge(
    prompt: string,
    lenses: string[] = ['smc'],
    marketContext = ''
  ): Promise<KnowledgeResult> {
    const response = await fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, lenses, marketContext })
    });
    if (!response.ok) {
      await throwResponseError(response, "Failed to search knowledge");
    }
    return response.json();
  },

  async chatWithGrounding(
    prompt: string,
    history: HistoryEntry[] = []
  ): Promise<ChatResponse> {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history })
      });

      if (!response.ok) {
        await throwResponseError(response, "Failed to get chat response");
      }

      const data = await response.json();
      return {
        text: data.text,
        grounding: data.grounding
      };
    } catch (error) {
      console.error("Chat Error:", error);
      throw error;
    }
  },

  async getTrackRecord(): Promise<TrackRecordResponse> {
    const response = await fetch("/api/forecasts");
    if (!response.ok) {
      await throwResponseError(response, "Failed to load track record");
    }
    return response.json();
  },

  async rescoreForecasts(): Promise<ScoreResponse> {
    const response = await fetch("/api/forecasts/score", { method: "POST" });
    if (!response.ok) {
      await throwResponseError(response, "Failed to score forecasts");
    }
    return response.json();
  }

};

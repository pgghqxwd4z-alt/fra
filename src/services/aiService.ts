import {
  ForecastResult,
  GroundingChunk,
  MarketResearch,
  MarketVerification
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
    lenses: string[] = ['smc']
  ): Promise<AnnotateResponse> {
    try {
      const response = await fetch("/api/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image, prompt, lenses })
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
        marketResearch: data.marketResearch
      };
    } catch (error) {
      console.error("Forecast Error:", error);
      throw error;
    }
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
  }

};

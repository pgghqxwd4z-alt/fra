import {
  ForecastResult,
  GroundingChunk
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
}

interface HistoryEntry {
  role: string;
  parts: {
    text: string;
  }[];
}

export const geminiService = {

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
        const error = await response.json();
        throw new Error(error.error || "Failed to annotate chart");
      }

      const data = await response.json();
      return {
        image: null,
        analysis: data.analysis,
        forecast: data.forecast
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
        const error = await response.json();
        throw new Error(error.error || "Failed to get chat response");
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

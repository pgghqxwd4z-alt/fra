import { ChatMessage, AnalysisResult, NewsEvent } from "../types";

const getErrorMessage = (message: string): string => {
  try {
    const parsed = JSON.parse(message) as { error?: string };
    return parsed.error || message;
  } catch {
    return message;
  }
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(getErrorMessage(message) || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const fetchNewsCalendar = async (): Promise<NewsEvent[]> => {
  return postJson<NewsEvent[]>('/api/news-calendar', {});
};

export const analyzeChatData = async (messages: ChatMessage[], news: NewsEvent[] = []): Promise<AnalysisResult> => {
  return postJson<AnalysisResult>('/api/analyze-chat', { messages, news });
};

export const analyzeTradingImage = async (base64Data: string, mimeType: string, news: NewsEvent[] = []): Promise<AnalysisResult> => {
  return postJson<AnalysisResult>('/api/analyze-image', { base64Data, mimeType, news });
};

export const synthesizeGlobalAudit = async (results: AnalysisResult[]): Promise<AnalysisResult> => {
  return postJson<AnalysisResult>('/api/synthesize-audit', { results });
};

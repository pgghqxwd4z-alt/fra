/**
 * Canonical Gemini model-name handling.
 *
 * @google/genai expects a model ID such as "gemini-2.0-flash" for
 * models.get().generateContent()/chats.create(). Resource-style names such as
 * "models/gemini-2.0-flash" must not be passed through to those specific methods,
 * though the underlying API requires them. The SDK handles the prefixing.
 */

export const DEFAULT_GEMINI_MODEL = "models/gemini-3-flash-preview";

const GEMINI_MODEL_ID = /^(?:gemini|gemma)-[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function resolveGeminiModel(value?: string | null): string {
  let raw = String(value ?? "").trim();

  if (!raw) return DEFAULT_GEMINI_MODEL;

  // Accept full resource names or just IDs, but normalize to full resource name "models/{id}"
  if (raw.startsWith("models/")) {
    return raw;
  }

  // Common configuration mistakes should fail before a network request.
  if (
    !raw ||
    raw.includes("/") ||
    raw.includes("\\") ||
    /\s/.test(raw) ||
    !GEMINI_MODEL_ID.test(raw)
  ) {
    console.warn(
      `[Gemini] Invalid GEMINI_MODEL="${String(value)}"; falling back to "${DEFAULT_GEMINI_MODEL}".`
    );
    return DEFAULT_GEMINI_MODEL;
  }

  return `models/${raw}`;
}

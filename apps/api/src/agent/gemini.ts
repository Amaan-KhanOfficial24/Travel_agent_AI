// Minimal Gemini REST client (generateContent with function calling).
// Docs: https://ai.google.dev/api/generate-content
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export type Part = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  thoughtSignature?: string; // must be sent back unchanged with the part it came with
  thought?: boolean;
};
export type Content = { role: 'user' | 'model'; parts: Part[] };
export type FunctionDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

export async function generate(input: { system: string; contents: Content[]; tools: FunctionDeclaration[] }): Promise<Content> {
  if (!config.GEMINI_API_KEY) {
    throw new AppError(503, 'FEATURE_NOT_CONFIGURED', 'The AI assistant is not set up yet (GEMINI_API_KEY is missing).');
  }
  const url = new URL(`/v1beta/models/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent`, config.GEMINI_BASE_URL);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.contents,
        tools: [{ functionDeclarations: input.tools }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(503, 'ASSISTANT_UNAVAILABLE', 'The AI assistant is not reachable right now. Please try again.');
  }
  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: Content; finishReason?: string }[];
    error?: { code?: number; message?: string; status?: string };
    usageMetadata?: Record<string, number>;
  };
  logger.info({ model: config.GEMINI_MODEL, status: res.status, ms: Date.now() - started, usage: body.usageMetadata }, 'Gemini call');

  if (res.status === 429) throw new AppError(503, 'ASSISTANT_BUSY', 'The AI assistant has reached its free usage limit for now. Please try again in a minute.');
  if (res.status === 400 && /API key/i.test(body.error?.message ?? '')) {
    throw new AppError(502, 'ASSISTANT_AUTH_FAILED', 'The AI provider rejected the API key. Check GEMINI_API_KEY.');
  }
  if (res.status === 401 || res.status === 403) throw new AppError(502, 'ASSISTANT_AUTH_FAILED', 'The AI provider rejected the API key. Check GEMINI_API_KEY.');
  if (res.status === 404) throw new AppError(502, 'ASSISTANT_MODEL_NOT_FOUND', `Model "${config.GEMINI_MODEL}" was not found. Set GEMINI_MODEL to an available model.`);
  if (!res.ok) throw new AppError(503, 'ASSISTANT_UNAVAILABLE', 'The AI assistant had a problem. Please try again.');

  const content = body.candidates?.[0]?.content;
  if (!content?.parts?.length) {
    return { role: 'model', parts: [{ text: 'Sorry, I could not produce an answer to that. Could you rephrase it?' }] };
  }
  return { role: 'model', parts: content.parts };
}

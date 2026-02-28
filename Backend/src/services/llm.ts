/**
 * services/llm.ts
 *
 * Local Ollama LLM service layer.
 * Provides: generateCompletion, generateStream, chatWithMemory
 *
 * Model   : llama3:8b
 * Endpoint: POST http://localhost:11434/api/generate
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMError {
  error: string;
  message: string;
  model?: string;
  retriesExhausted?: boolean;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  options?: Record<string, unknown>;
}

interface OllamaStreamChunk {
  response?: string;
  done?: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const GENERATE_URL = `${OLLAMA_BASE_URL}/api/generate`;

const MODEL = process.env.OLLAMA_MODEL || "llama3:8b";

const REQUEST_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const MAX_MEMORY_MESSAGES = 10;

// Ollama generation options
// num_ctx  : context window (llama3:8b supports 8192 natively; default is only 2048!)
// num_predict: max tokens to generate (-1 = unlimited until EOS/context full)
const DEFAULT_OPTIONS: Record<string, unknown> = {
  num_ctx: 8192,
  num_predict: 8192,
  temperature: 0.7,
};

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Creates a normalised LLMError from an unknown error value.
 */
function normaliseLLMError(err: unknown, model: string): LLMError {
  if (err instanceof Error) {
    return { error: "LLM request failed", message: err.message, model };
  }
  return {
    error: "LLM request failed",
    message: String(err),
    model,
  };
}

/**
 * Retry wrapper with exponential backoff and per-attempt AbortController timeout.
 */
async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  retries: number = MAX_RETRIES,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await fn(controller.signal);
      return result;
    } catch (err: unknown) {
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";
      const isRetryable =
        isTimeout ||
        (err instanceof Error &&
          /ECONNREFUSED|ECONNRESET|5\d\d/.test(err.message));

      if (isRetryable && attempt < retries) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        console.warn(
          `[retry] Retry ${attempt}/${retries} for Ollama request (waiting ${delay}ms)...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Formats an array of ChatMessage into a single prompt string
 * that Ollama's /api/generate endpoint understands.
 */
function formatMessagesAsPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      switch (m.role) {
        case "system":
          return `[SYSTEM]\n${m.content}`;
        case "user":
          return `[USER]\n${m.content}`;
        case "assistant":
          return `[ASSISTANT]\n${m.content}`;
        default:
          return m.content;
      }
    })
    .join("\n\n");
}

/**
 * Truncates message history to the most recent N messages,
 * always preserving the system message if it is the first entry.
 */
function truncateMemory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MEMORY_MESSAGES) return messages;

  const hasSystemFirst = messages[0]?.role === "system";
  if (hasSystemFirst) {
    return [messages[0], ...messages.slice(-(MAX_MEMORY_MESSAGES - 1))];
  }
  return messages.slice(-MAX_MEMORY_MESSAGES);
}

/**
 * Safely parses a JSON string, returning null on failure.
 */
function safeParse<T = OllamaStreamChunk>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// Core: single-model request helpers
// ────────────────────────────────────────────────────────────────

/**
 * Non-streaming completion against a specific model.
 */
async function requestCompletion(
  prompt: string,
  model: string,
  options?: Record<string, unknown>,
): Promise<string> {
  return withRetry(async (signal) => {
    const body: OllamaGenerateRequest = {
      model,
      prompt,
      stream: false,
      options: { ...DEFAULT_OPTIONS, ...options },
    };

    const res = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Ollama returned ${res.status}: ${text || res.statusText}`,
      );
    }

    const json = (await res.json()) as { response?: string; error?: string };
    if (json.error) throw new Error(json.error);
    return json.response ?? "";
  });
}

/**
 * Streaming request against a specific model.
 * Uses a longer timeout since streams can take a while.
 * Returns the raw Response so the caller can read the body as a stream.
 */
async function requestStream(
  prompt: string,
  model: string,
  options?: Record<string, unknown>,
): Promise<Response> {
  // Use a longer timeout for stream initiation
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
    try {
      const body: OllamaGenerateRequest = {
        model,
        prompt,
        stream: true,
        options: { ...DEFAULT_OPTIONS, ...options },
      };

      const res = await fetch(GENERATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Ollama returned ${res.status}: ${text || res.statusText}`,
        );
      }
      clearTimeout(timer);
      return res;
    } catch (err: unknown) {
      clearTimeout(timer);
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";
      const isRetryable =
        isTimeout ||
        (err instanceof Error &&
          /ECONNREFUSED|ECONNRESET|5\d\d/.test(err.message));

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        console.warn(
          `[retry] Stream retry ${attempt}/${MAX_RETRIES} (waiting ${delay}ms)...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded for stream");
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Generate a non-streaming completion.
 * Retries up to MAX_RETRIES on transient failures.
 */
export async function generateCompletion(
  prompt: string,
  options?: Record<string, unknown>,
): Promise<string> {
  try {
    return await requestCompletion(prompt, MODEL, options);
  } catch (err) {
    const llmErr = normaliseLLMError(err, MODEL);
    llmErr.retriesExhausted = true;
    throw llmErr;
  }
}

/**
 * Generate a streaming completion.
 * Retries up to MAX_RETRIES on transient failures.
 *
 * Returns an async generator that yields text tokens.
 */
export async function* generateStream(
  prompt: string,
  options?: Record<string, unknown>,
): AsyncGenerator<string, void, undefined> {
  let res: Response;

  try {
    res = await requestStream(prompt, MODEL, options);
  } catch (err) {
    const llmErr = normaliseLLMError(err, MODEL);
    llmErr.retriesExhausted = true;
    throw llmErr;
  }

  if (!res.body) {
    throw new Error("Response body is null — streaming not supported");
  }

  // Node 18+ fetch returns a ReadableStream<Uint8Array>.
  // We read it as text manually using a reader.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = leftover + decoder.decode(value, { stream: true });
      const lines = text.split("\n");

      // Last element may be incomplete — carry it over
      leftover = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const chunk = safeParse<OllamaStreamChunk>(trimmed);
        if (!chunk) continue;

        if (chunk.error) throw new Error(chunk.error);
        if (chunk.response) yield chunk.response;
        if (chunk.done) return;
      }
    }

    // Process any remaining leftover
    if (leftover.trim()) {
      const chunk = safeParse<OllamaStreamChunk>(leftover.trim());
      if (chunk?.response) yield chunk.response;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Chat with conversation memory.
 *
 * Accepts a full message history, truncates to safe size,
 * concatenates into a prompt, and runs a non-streaming completion.
 */
export async function chatWithMemory(messages: ChatMessage[]): Promise<string> {
  const truncated = truncateMemory(messages);
  const prompt = formatMessagesAsPrompt(truncated);
  return generateCompletion(prompt);
}

/**
 * Chat with conversation memory — streaming variant.
 *
 * Works identically to chatWithMemory but returns an async generator
 * of incremental tokens.
 */
export async function* chatWithMemoryStream(
  messages: ChatMessage[],
): AsyncGenerator<string, void, undefined> {
  const truncated = truncateMemory(messages);
  const prompt = formatMessagesAsPrompt(truncated);
  yield* generateStream(prompt);
}

/**
 * Centralised LLM error handler for Express routes.
 * Writes a consistent JSON error shape to the response.
 */
export function handleLLMError(
  err: unknown,
  res: { status: (code: number) => { json: (body: any) => void } },
): void {
  console.error("[error] LLM Error:", err);

  if (isLLMError(err)) {
    res.status(502).json(err);
    return;
  }

  const normalised = normaliseLLMError(err, "unknown");
  res.status(500).json(normalised);
}

function isLLMError(value: unknown): value is LLMError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    "message" in value
  );
}

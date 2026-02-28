require("dotenv").config();
import crypto from "crypto";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { BASE_PROMPT, getSystemPrompt, CONTINUE_PROMPT } from "./Prompts";
import {
  generateCompletion,
  generateStream,
  chatWithMemoryStream,
  handleLLMError,
  ChatMessage as LLMChatMessage,
} from "./services/llm";

// ────────────────────────────────────────────────────────────────
// Express app
// ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "100kb" }));

// ────────────────────────────────────────────────────────────────
// API key authentication middleware
// ────────────────────────────────────────────────────────────────

const API_KEY = process.env.Secret_Api_Key;

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no API key is configured (development mode)
  if (!API_KEY) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  // Also accept ?apiKey= query param (needed for EventSource which can't set headers)
  const queryKey = req.query.apiKey as string | undefined;

  const providedKey = token || queryKey;

  if (!providedKey || providedKey !== API_KEY) {
    res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
    return;
  }

  next();
}

// ────────────────────────────────────────────────────────────────
// Input validation constants
// ────────────────────────────────────────────────────────────────

const MAX_PROMPT_LENGTH = 4000;
const MAX_MESSAGE_PARTS_LENGTH = 50000; // generous for follow-ups with file context
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ────────────────────────────────────────────────────────────────
// Request / response types (unchanged shapes)
// ────────────────────────────────────────────────────────────────

interface TemplateRequest {
  prompt: string;
}

interface TemplateResponse {
  prompts: string[];
  uiPrompts: string[];
}

interface ChatMessage {
  parts: string;
}

interface ChatRequest {
  message: ChatMessage[];
}

// ────────────────────────────────────────────────────────────────
// CORS
// ────────────────────────────────────────────────────────────────

const allowedOrigins = ["http://localhost:5174", "https://renzai.vercel.app"];

const corsOptions: cors.CorsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ────────────────────────────────────────────────────────────────
// Rate limiting — 30 requests / minute / IP
// ────────────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(limiter);

// ────────────────────────────────────────────────────────────────
// Per-session conversation store (prevents cross-user data leaks)
// ────────────────────────────────────────────────────────────────

interface Session {
  messages: ChatMessage[];
  createdAt: number;
}

const sessions = new Map<string, Session>();

/** Generate a cryptographically random session ID */
function createSessionId(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Get or validate a session */
function getSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  // Expire stale sessions
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

/** Periodic cleanup of expired sessions (every 5 minutes) */
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ────────────────────────────────────────────────────────────────
// Full-response XML parser (fallback for when streaming parser
// misses artifacts due to character-by-character delivery)
// ────────────────────────────────────────────────────────────────

function parseFullResponse(
  text: string,
): Array<{ title: string; path: string; type: string; code: string }> {
  const results: Array<{
    title: string;
    path: string;
    type: string;
    code: string;
  }> = [];

  const actionRegex =
    /<boltAction\s+[^>]*?type="file"[^>]*?filePath="([^"]*)"[^>]*>([\s\S]*?)<\/boltAction>/g;
  let match;

  while ((match = actionRegex.exec(text)) !== null) {
    const filePath = match[1];
    const code = match[2].trim();
    if (filePath && code) {
      results.push({
        title: filePath.split("/").pop() || filePath,
        path: filePath,
        type: "file",
        code,
      });
    }
  }

  return results;
}

// ────────────────────────────────────────────────────────────────
// Enhanced XML parser for streaming
// ────────────────────────────────────────────────────────────────

class StreamingXMLParser {
  private buffer = "";
  private currentArtifact: Record<string, string> | null = null;
  private insideArtifact = false;
  private currentContent = "";

  private artifactStartRegex = /<bolt(?:Artifact|Action)\b([^>]*)>/;
  private artifactEndRegex = /<\/bolt(?:Artifact|Action)>/;

  addChunk(chunk: string) {
    this.buffer += chunk;
    const results: Array<{
      type: "chunk" | "complete";
      data: Record<string, unknown>;
    }> = [];

    if (!this.insideArtifact) {
      const startMatch = this.buffer.match(this.artifactStartRegex);
      if (startMatch) {
        this.insideArtifact = true;
        const attrString = startMatch[1];
        this.currentArtifact = this.parseArtifactAttributes(attrString);
        this.buffer = this.buffer.slice(
          startMatch.index! + startMatch[0].length,
        );
        this.currentContent = "";

        results.push({
          type: "chunk",
          data: {
            event: "artifact_start",
            artifact: this.currentArtifact,
          },
        });
      }
    }

    if (this.insideArtifact) {
      const endMatch = this.buffer.match(this.artifactEndRegex);
      if (endMatch) {
        const contentUpToEnd = this.buffer.slice(0, endMatch.index);
        if (contentUpToEnd.trim()) {
          results.push({
            type: "chunk",
            data: {
              event: "content_chunk",
              content: contentUpToEnd,
              artifact: this.currentArtifact!,
            },
          });
        }

        results.push({
          type: "complete",
          data: {
            ...this.currentArtifact!,
            code: this.currentContent + contentUpToEnd,
          },
        });

        this.buffer = this.buffer.slice(endMatch.index! + endMatch[0].length);
        this.insideArtifact = false;
        this.currentArtifact = null;
        this.currentContent = "";
      } else {
        if (this.buffer.trim()) {
          results.push({
            type: "chunk",
            data: {
              event: "content_chunk",
              content: this.buffer,
              artifact: this.currentArtifact!,
            },
          });
          this.currentContent += this.buffer;
          this.buffer = "";
        }
      }
    }

    return results;
  }

  private parseArtifactAttributes(attrString: string) {
    const titleMatch = attrString.match(/title="([^"]*)"/);
    const pathMatch = attrString.match(/path="([^"]*)"/);
    const filePathMatch = attrString.match(/filePath="([^"]*)"/);

    return {
      title: titleMatch ? titleMatch[1] : "Untitled",
      path: pathMatch ? pathMatch[1] : filePathMatch ? filePathMatch[1] : "",
      type: attrString.match(/type="([^"]*)"/)?.[1] ?? "file",
    };
  }
}

// ────────────────────────────────────────────────────────────────
// POST /template
// Lightweight route: detects app type and returns the prompt that
// the frontend should send to GET /chat for streaming generation.
// No heavy LLM generation happens here.
// ────────────────────────────────────────────────────────────────

app.post(
  "/template",
  authMiddleware,
  async (
    req: Request<{}, TemplateResponse, TemplateRequest>,
    res: Response<TemplateResponse | { error: string; message?: string; sessionId?: string }>,
  ): Promise<void> => {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Invalid prompt, expected a string" });
      return;
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      res.status(400).json({ error: `Prompt too long. Maximum ${MAX_PROMPT_LENGTH} characters.` });
      return;
    }

    try {
      // Detect app type via a short Ollama completion
      const typeDetectionPrompt = `You must respond with EXACTLY one word: either "react" or "node". No explanation, no punctuation, just one word. User's request: ${prompt}`;
      const rawType = await generateCompletion(typeDetectionPrompt, {
        num_predict: 10, // only need a single word back
        num_ctx: 2048, // small context is fine for this
        temperature: 0.1, // deterministic
      });

      // Extract just a-z chars and check for react/node anywhere in response
      const cleaned = rawType
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "");
      let appType: "react" | "node" = "react"; // default to react

      if (cleaned.includes("node") && !cleaned.includes("react")) {
        appType = "node";
      }
      // else default to react (safer default for web apps)

      console.log(
        `App type detected: "${appType}" (raw LLM: "${rawType.trim()}")`,
      );

      const appPrompt =
        appType === "react"
          ? `${BASE_PROMPT}\nCreate a React application for: ${prompt}`
          : `Create a Node.js application for: ${prompt}`;

      // Create a new session for this conversation
      const sessionId = createSessionId();
      sessions.set(sessionId, { messages: [], createdAt: Date.now() });

      // Return immediately — no heavy generation here.
      // The frontend will POST these prompts to /chat and stream via GET /chat.
      res.json({
        prompts: [appPrompt],
        uiPrompts: [],
        sessionId,
      });
      return;
    } catch (err) {
      console.error("Error in /template:", err);
      handleLLMError(err, res);
      return;
    }
  },
);

// ────────────────────────────────────────────────────────────────
// POST /chat
// Accepts user messages and stores them for GET /chat streaming.
// Route name & request/response shape unchanged.
// ────────────────────────────────────────────────────────────────

app.post(
  "/chat",
  authMiddleware,
  async (
    req: Request<{}, { success: boolean } | { error: string }, ChatRequest & { sessionId?: string }>,
    res: Response,
  ): Promise<void> => {
    const { message, sessionId } = req.body as ChatRequest & { sessionId?: string };

    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found or expired. Please start a new conversation." });
      return;
    }

    if (!Array.isArray(message)) {
      res
        .status(400)
        .json({ error: "Invalid format: expected array of message objects" });
      return;
    }

    // Validate message structure
    const isValidMessage = message.every(
      (msg): msg is ChatMessage =>
        typeof msg === "object" &&
        msg !== null &&
        "parts" in msg &&
        typeof msg.parts === "string",
    );

    if (!isValidMessage) {
      res.status(400).json({
        error:
          "Invalid message format: each message must have 'parts' string property",
      });
      return;
    }

    // Validate total message size
    const totalLength = message.reduce((sum, msg) => sum + msg.parts.length, 0);
    if (totalLength > MAX_MESSAGE_PARTS_LENGTH) {
      res.status(400).json({ error: `Message content too large. Maximum ${MAX_MESSAGE_PARTS_LENGTH} characters total.` });
      return;
    }

    session.messages = message;
    res.status(200).json({ success: true });
    return;
  },
);

// ────────────────────────────────────────────────────────────────
// GET /chat
// Streaming endpoint — reads lastMessage, streams Ollama tokens
// as SSE events through the XML parser. Uses conversation memory.
// ────────────────────────────────────────────────────────────────

app.get("/chat", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter" });
    return;
  }

  const session = getSession(sessionId);
  if (!session || !session.messages.length) {
    res.status(400).json({ error: "No message to process or session expired." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  try {
    // Build conversation messages for memory-based streaming
    const messages: LLMChatMessage[] = [
      { role: "system", content: getSystemPrompt() },
      ...session.messages.map(
        (msg): LLMChatMessage => ({
          role: "user",
          content: msg.parts,
        }),
      ),
    ];

    const xmlParser = new StreamingXMLParser();

    console.log("🚀 Starting streaming request to Ollama…");

    let chunkCount = 0;
    let fullResponse = "";
    const emittedPaths = new Set<string>(); // track paths the streaming parser completed

    // Maximum continuation attempts to prevent infinite loops
    const MAX_CONTINUATIONS = 3;
    let continuationCount = 0;

    /**
     * Checks whether the response looks incomplete
     * (opened a <boltArtifact> but never closed it).
     */
    function isResponseIncomplete(text: string): boolean {
      const openTags = (text.match(/<boltArtifact\b/g) || []).length;
      const closeTags = (text.match(/<\/boltArtifact>/g) || []).length;
      return openTags > closeTags;
    }

    /**
     * Stream tokens from the given async generator, accumulating into fullResponse
     * and routing through the XML parser + SSE writer.
     */
    async function streamTokens(
      tokenSource: AsyncGenerator<string, void, undefined>,
    ) {
      for await (const token of tokenSource) {
        try {
          chunkCount++;
          fullResponse += token;

          // Parse streaming content through XML parser
          const results = xmlParser.addChunk(token);

          if (results.length > 0) {
            for (const result of results) {
              if (result.type === "chunk") {
                res.write(
                  `data: ${JSON.stringify({
                    type: "chunk",
                    ...result.data,
                  })}\n\n`,
                );
              } else if (result.type === "complete") {
                const path =
                  (result.data as any).path ||
                  (result.data as any).filePath ||
                  "";
                if (path) emittedPaths.add(path);
                res.write(
                  `data: ${JSON.stringify({
                    type: "complete",
                    artifact: result.data,
                  })}\n\n`,
                );
              }
            }
          } else {
            // Send raw text token so frontend sees progress
            res.write(
              `data: ${JSON.stringify({
                type: "text",
                content: token,
              })}\n\n`,
            );
          }
        } catch (chunkError) {
          console.error("❌ Error processing chunk:", chunkError);
          continue;
        }
      }
    }

    // Initial streaming pass
    await streamTokens(chatWithMemoryStream(messages));

    // Auto-continuation: if the response is incomplete, send CONTINUE_PROMPT
    while (
      isResponseIncomplete(fullResponse) &&
      continuationCount < MAX_CONTINUATIONS
    ) {
      continuationCount++;
      console.log(
        `🔄 Response incomplete — sending continuation ${continuationCount}/${MAX_CONTINUATIONS}…`,
      );

      // Build continuation messages: original context + what was generated so far + continue instruction
      const continuationMessages: LLMChatMessage[] = [
        { role: "system", content: getSystemPrompt() },
        ...session.messages.map(
          (msg): LLMChatMessage => ({
            role: "user",
            content: msg.parts,
          }),
        ),
        { role: "assistant", content: fullResponse },
        { role: "user", content: CONTINUE_PROMPT },
      ];

      await streamTokens(chatWithMemoryStream(continuationMessages));
    }

    if (continuationCount > 0) {
      console.log(
        `✅ Completed after ${continuationCount} continuation(s). Total tokens: ${chunkCount}`,
      );
    }

    // After streaming is done, parse the full response for any
    // artifacts the streaming XML parser missed (deduplicate by path)
    const fullArtifacts = parseFullResponse(fullResponse);
    for (const artifact of fullArtifacts) {
      if (!emittedPaths.has(artifact.path)) {
        emittedPaths.add(artifact.path);
        res.write(
          `data: ${JSON.stringify({
            type: "complete",
            artifact,
          })}\n\n`,
        );
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("❌ Streaming error:", error);

    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: "Generation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      })}\n\n`,
    );

    res.write("data: [DONE]\n\n");
    res.end();
  } finally {
    clearInterval(keepAlive);
    console.log("🧹 Cleaned up streaming connection");
  }
});

// ────────────────────────────────────────────────────────────────
// Health check
// ────────────────────────────────────────────────────────────────

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// ────────────────────────────────────────────────────────────────
// Start server
// ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🦙 Ollama endpoint: ${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}`);
  if (!API_KEY) {
    console.warn("⚠️  No Secret_Api_Key set — API key auth is DISABLED. Set it in .env for production!");
  }
});

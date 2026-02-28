require("dotenv").config();
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { BASE_PROMPT, getSystemPrompt } from "./Prompts";
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
app.use(express.json());

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
// In-memory conversation store (short-term memory)
// ────────────────────────────────────────────────────────────────

let lastMessage: ChatMessage[] = [];

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
// Analyzes user prompt and returns initial XML build instructions.
// Route name & response shape unchanged.
// ────────────────────────────────────────────────────────────────

app.post(
  "/template",
  async (
    req: Request<{}, TemplateResponse, TemplateRequest>,
    res: Response<TemplateResponse | { error: string; message?: string }>,
  ): Promise<void> => {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Invalid prompt, expected a string" });
      return;
    }

    try {
      // Step 1: Detect app type via Ollama
      const typeDetectionPrompt = `You must respond with only "react" or "node". Do not explain. User's request: ${prompt}`;
      const rawType = await generateCompletion(typeDetectionPrompt);
      const appType = rawType
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "");

      if (appType !== "react" && appType !== "node") {
        res.status(403).json({
          message: "Only React or Node apps are supported.",
          error: "Unsupported app type",
        });
        return;
      }

      const appPrompt =
        appType === "react"
          ? `${BASE_PROMPT}\nCreate a React application for: ${prompt}`
          : `Create a Node.js application for: ${prompt}`;

      const systemPrompt = getSystemPrompt();

      // Step 2: Generate build instructions via Ollama
      const fullPrompt = `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${appPrompt}`;
      const responseText = await generateCompletion(fullPrompt);

      const xmlMatch = responseText.match(
        /<boltArtifact[^>]*>([\s\S]*?)<\/boltArtifact>/,
      );
      console.log("LLM Response:\n", responseText);

      if (!xmlMatch) {
        res.status(500).json({ error: "Invalid response format from LLM" });
        return;
      }

      res.json({
        prompts: [appPrompt],
        uiPrompts: [responseText],
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
  async (
    req: Request<{}, { success: boolean } | { error: string }, ChatRequest>,
    res: Response,
  ): Promise<void> => {
    const { message } = req.body;

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

    lastMessage = message;
    res.status(200).json({ success: true });
    return;
  },
);

// ────────────────────────────────────────────────────────────────
// GET /chat
// Streaming endpoint — reads lastMessage, streams Ollama tokens
// as SSE events through the XML parser. Uses conversation memory.
// ────────────────────────────────────────────────────────────────

app.get("/chat", async (req: Request, res: Response): Promise<void> => {
  if (!lastMessage.length) {
    res.status(400).json({ error: "No message to process." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  try {
    // Build conversation messages for memory-based streaming
    const messages: LLMChatMessage[] = [
      { role: "system", content: getSystemPrompt() },
      ...lastMessage.map(
        (msg): LLMChatMessage => ({
          role: "user",
          content: msg.parts,
        }),
      ),
    ];

    const xmlParser = new StreamingXMLParser();

    console.log("🚀 Starting streaming request to Ollama…");

    let chunkCount = 0;

    for await (const token of chatWithMemoryStream(messages)) {
      try {
        chunkCount++;
        console.log(
          `📦 Processing chunk ${chunkCount}: ${token.length} characters`,
        );

        // Parse streaming content through XML parser
        const results = xmlParser.addChunk(token);

        // Send each result to the client
        for (const result of results) {
          if (result.type === "chunk") {
            res.write(
              `data: ${JSON.stringify({
                type: "chunk",
                ...result.data,
              })}\n\n`,
            );
          } else if (result.type === "complete") {
            res.write(
              `data: ${JSON.stringify({
                type: "complete",
                artifact: result.data,
              })}\n\n`,
            );
          }
        }
      } catch (chunkError) {
        console.error("❌ Error processing chunk:", chunkError);
        continue;
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
  console.log(`🦙 Ollama endpoint: http://localhost:11434`);
});

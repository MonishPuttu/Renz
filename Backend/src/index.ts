require("dotenv").config();
import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import { BASE_PROMPT, getSystemPrompt } from "./Prompts";

const app = express();
app.use(express.json());

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

const allowedOrigins = ["http://localhost:5174", "https://renzai.vercel.app"];

// CORS setup
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

// Validate OpenRouter API key
if (!process.env.OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY in environment.");
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "mistralai/mistral-7b-instruct";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

/**
 * Retry wrapper for 429 (rate-limit) errors with exponential backoff.
 * Also enforces a per-request timeout via AbortController.
 */
async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await fn(controller.signal);
      return result;
    } catch (err: any) {
      if (err?.status === 429 && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        console.warn(
          `⏳ Rate-limited (429). Retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})...`,
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

let lastMessage: { parts: string }[] = [];

// Enhanced XML parser for streaming
class StreamingXMLParser {
  private buffer = "";
  private currentArtifact: any = null;
  private insideArtifact = false;
  private currentContent = "";

  private artifactStartRegex = /<bolt(?:Artifact|Action)\b([^>]*)>/;
  private artifactEndRegex = /<\/bolt(?:Artifact|Action)>/;

  addChunk(chunk: string) {
    this.buffer += chunk;
    const results: Array<{ type: "chunk" | "complete"; data: any }> = [];

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
              artifact: this.currentArtifact,
            },
          });
        }

        results.push({
          type: "complete",
          data: {
            ...this.currentArtifact,
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
              artifact: this.currentArtifact,
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

/**
 * POST /template
 * Analyzes user prompt and returns initial XML build instructions
 */
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
      // Step 1: Detect app type
      const detectTypeResponse = await withRetry((signal) =>
        openai.chat.completions.create(
          {
            model: MODEL,
            messages: [
              {
                role: "user",
                content: `You must respond with only "react" or "node". Do not explain. User's request: ${prompt}`,
              },
            ],
            max_tokens: 10,
            temperature: 0,
          },
          { signal },
        ),
      );

      const appType =
        detectTypeResponse.choices[0]?.message?.content?.trim().toLowerCase() ??
        "";

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

      // Step 2: Generate build instructions
      const appResponse = await withRetry((signal) =>
        openai.chat.completions.create(
          {
            model: MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: appPrompt },
            ],
            max_tokens: 8192,
            temperature: 0.7,
          },
          { signal },
        ),
      );

      const responseText = appResponse.choices[0]?.message?.content ?? "";
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
      res.status(500).json({ error: "LLM generation failed." });
      return;
    }
  },
);

/**
 * POST /chat
 * Stores incoming user message to use in GET /chat
 */
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

// Enhanced streaming endpoint
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
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: getSystemPrompt() },
      ...lastMessage.map(
        (msg): OpenAI.ChatCompletionMessageParam => ({
          role: "user" as const,
          content: msg.parts,
        }),
      ),
    ];

    const xmlParser = new StreamingXMLParser();

    console.log("🚀 Starting enhanced streaming request to OpenRouter...");

    const stream = await withRetry((signal) =>
      openai.chat.completions.create(
        {
          model: MODEL,
          messages,
          max_tokens: 8192,
          temperature: 0.7,
          stream: true,
        },
        { signal },
      ),
    );

    let chunkCount = 0;

    for await (const chunk of stream) {
      try {
        const text = chunk.choices[0]?.delta?.content;
        if (!text) continue;

        chunkCount++;
        console.log(
          `📦 Processing chunk ${chunkCount}: ${text.length} characters`,
        );

        // Parse streaming content
        const results = xmlParser.addChunk(text);

        // Send each result to the client
        for (const result of results) {
          if (result.type === "chunk") {
            // Send incremental updates
            res.write(
              `data: ${JSON.stringify({
                type: "chunk",
                ...result.data,
              })}\n\n`,
            );
          } else if (result.type === "complete") {
            // Send complete artifact
            res.write(
              `data: ${JSON.stringify({
                type: "complete",
                artifact: result.data,
              })}\n\n`,
            );
          }
        }

        // Add small delay to make streaming more visible
        await new Promise((resolve) => setTimeout(resolve, 50));
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

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});

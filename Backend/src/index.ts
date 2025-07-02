require("dotenv").config();
import { GoogleGenerativeAI } from "@google/generative-ai";
import express , { Request, Response } from "express";
import cors from "cors";
import { BASE_PROMPT, getSystemPrompt } from "./Prompts";

const app = express();

// Configure CORS with specific origin and credentials
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.Gemini_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Store the last message for streaming
let lastMessage: { parts: string }[] = [];

app.post("/template", async (req, res) => {
  const prompt = req.body.prompt;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Invalid prompt, expected a string" });
    return;
  }

  // First determine if it's a React or Node.js app
  const result = await model.generateContent({
    contents: [
      { 
        role: "user", 
        parts: [{ text: `You must respond with only "react" or "node". Do not explain. User's request: ${prompt}` }]
      }
    ],
  });

  const ans = result.response.text()?.trim().toLowerCase();

  if (ans !== "react" && ans !== "node") {
    res.status(403).json({message: "You can only create react or node applications"});
    return;
  }

  // Get the actual LLM response for the specific app
  const systemPrompt = getSystemPrompt();
  const appPrompt = ans === "react" 
    ? `${BASE_PROMPT}\nCreate a React application for: ${prompt}`
    : `Create a Node.js application for: ${prompt}`;

  const llmResponse = await model.generateContent({
    contents: [
      { role: "user", parts: [{ text: appPrompt }] }
    ],
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
  });

  const responseText = llmResponse.response.text();

  // Extract the XML content from the response
  const xmlMatch = responseText.match(/<boltArtifact[^>]*>([\s\S]*?)<\/boltArtifact>/);
  if (!xmlMatch) {
    res.status(500).json({ error: "Invalid response format from LLM" });
    return;
  }

  res.json({
    prompts: [appPrompt],
    uiPrompts: [responseText]
  });
});

app.post("/chat", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!Array.isArray(message)) {
      res.status(400).json({ error: "Invalid message format, expected an array" });
      return;
    }

    // Store the message for streaming
    lastMessage = message;
    res.json({ success: true });
  } catch (e) {
    console.error("Error processing chat request:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/chat", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!lastMessage.length) {
      res.status(400).json({ error: "No message to process" });
      return;
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const msgFormat = lastMessage.map((msg: { parts: string }) => ({
      role: "user",
      parts: [{ text: msg.parts }]
    }));

    const result = await model.generateContentStream({
      contents: msgFormat,
      systemInstruction: { role: "system", parts: [{ text: getSystemPrompt() }] }
    });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      // Send the chunk as an SSE event
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    // Send end event
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (e) {
    console.error("Error processing chat request:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
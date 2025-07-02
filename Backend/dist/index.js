"use strict";
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv").config();
const generative_ai_1 = require("@google/generative-ai");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const Prompts_1 = require("./Prompts");
const app = (0, express_1.default)();
// Configure CORS with specific origin and credentials
app.use((0, cors_1.default)({
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express_1.default.json());
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.Gemini_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
// Store the last message for streaming
let lastMessage = [];
app.post("/template", async (req, res) => {
    var _a;
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
    const ans = (_a = result.response.text()) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
    if (ans !== "react" && ans !== "node") {
        res.status(403).json({ message: "You can only create react or node applications" });
        return;
    }
    // Get the actual LLM response for the specific app
    const systemPrompt = (0, Prompts_1.getSystemPrompt)();
    const appPrompt = ans === "react"
        ? `${Prompts_1.BASE_PROMPT}\nCreate a React application for: ${prompt}`
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
app.post("/chat", async (req, res) => {
    try {
        const { message } = req.body;
        if (!Array.isArray(message)) {
            res.status(400).json({ error: "Invalid message format, expected an array" });
            return;
        }
        // Store the message for streaming
        lastMessage = message;
        res.json({ success: true });
    }
    catch (e) {
        console.error("Error processing chat request:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
app.get("/chat", async (req, res) => {
    var _a, e_1, _b, _c;
    try {
        if (!lastMessage.length) {
            res.status(400).json({ error: "No message to process" });
            return;
        }
        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const msgFormat = lastMessage.map((msg) => ({
            role: "user",
            parts: [{ text: msg.parts }]
        }));
        const result = await model.generateContentStream({
            contents: msgFormat,
            systemInstruction: { role: "system", parts: [{ text: (0, Prompts_1.getSystemPrompt)() }] }
        });
        try {
            for (var _d = true, _e = __asyncValues(result.stream), _f; _f = await _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                const chunk = _c;
                const text = chunk.text();
                // Send the chunk as an SSE event
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) await _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
        // Send end event
        res.write('data: [DONE]\n\n');
        res.end();
    }
    catch (e) {
        console.error("Error processing chat request:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

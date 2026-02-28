import { useEffect, useRef, useState, useCallback } from "react";
import {
  Code2,
  Eye,
  Zap,
  Loader2,
  Send,
  MessageSquare,
  Bot,
  User,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import {
  TemplateResponse,
  ChatMessage as ChatMsg,
  FileStructure,
} from "../Types";
import { useSelector } from "react-redux";
import { RootState } from "../Redux/Store";
import FileExplorer from "../components/FileExplorer";
import PreviewFrame from "../components/PreviewFrame";
import { useNavigate } from "react-router-dom";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

if (!BACKEND_URL) {
  console.error("Missing VITE_BACKEND_URL, check your environment variables.");
}

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface StreamingFile {
  path: string;
  title: string;
  content: string;
  isComplete: boolean;
  isActive: boolean;
}

interface StreamingState {
  files: Record<string, StreamingFile>;
  currentFile: string | null;
  isStreaming: boolean;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Strip XML / bolt tags from assistant text for clean display */
function stripXmlTags(text: string): string {
  return text
    .replace(/<boltArtifact[^>]*>/g, "")
    .replace(/<\/boltArtifact>/g, "")
    .replace(/<boltAction[^>]*>/g, "")
    .replace(/<\/boltAction>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────

function BuildView() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [fileStructure, setFileStructure] = useState<FileStructure>({});
  const [selectedFileCode, setSelectedFileCode] = useState<string>("");
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [streamingState, setStreamingState] = useState<StreamingState>({
    files: {},
    currentFile: null,
    isStreaming: false,
  });

  // Chat state
  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [assistantStreamText, setAssistantStreamText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const prompt = useSelector((state: RootState) => state.prompt.prompt);
  const [editorInstance, setEditorInstance] = useState<any>(null);

  // Keep initial prompts for follow-up context
  const initialPromptsRef = useRef<string[]>([]);
  // Track active EventSource so we can close it on cleanup
  const eventSourceRef = useRef<EventSource | null>(null);
  // Stable refs for streaming handlers — avoids re-creating startStreaming
  const selectedFilePathRef = useRef(selectedFilePath);
  selectedFilePathRef.current = selectedFilePath;

  // ── Auto-scroll editor during streaming ──

  useEffect(() => {
    if (
      editorInstance &&
      streamingState.isStreaming &&
      streamingState.currentFile
    ) {
      const model = editorInstance.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        editorInstance.setPosition({ lineNumber: lineCount, column: 1 });
        editorInstance.revealLine(lineCount);
      }
    }
  }, [selectedFileCode, streamingState.isStreaming, editorInstance]);

  // ── Auto-scroll chat ──

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, assistantStreamText]);

  // ────────────────────────────────────────────────────────────────
  // File structure builder
  // ────────────────────────────────────────────────────────────────

  const buildFileStructure = useCallback(
    (artifacts: { path: string; code: string }[]): FileStructure => {
      const structure: FileStructure = {};

      artifacts.forEach(({ path, code }) => {
        if (!path || !code) return;

        const cleanPath = path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
        if (!cleanPath) return;

        const pathParts = cleanPath.split("/");
        let current = structure;

        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part]) {
            current[part] = {};
          } else if (typeof current[part] === "string") {
            current[part] = {};
          }
          current = current[part] as FileStructure;
        }

        const fileName = pathParts[pathParts.length - 1];
        current[fileName] = code;
      });

      return structure;
    },
    [],
  );

  // Rebuild file structure whenever streaming files change
  useEffect(() => {
    const artifacts = Object.values(streamingState.files)
      .filter((f) => f.content)
      .map((f) => ({ path: f.path, code: f.content }));

    if (artifacts.length > 0) {
      const newStructure = buildFileStructure(artifacts);
      setFileStructure(newStructure);
    }
  }, [streamingState.files, buildFileStructure]);

  // ────────────────────────────────────────────────────────────────
  // Streaming chunk handlers
  // ────────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(
    (code: string, path?: string) => {
      let filePath = path;
      if (!filePath) {
        const streamingFile = Object.values(streamingState.files).find(
          (f) => f.content === code,
        );
        if (streamingFile) {
          filePath = streamingFile.path;
        }
      }
      setSelectedFileCode(code);
      setSelectedFilePath(filePath || "");
      setActiveTab("code");
    },
    [streamingState.files],
  );

  const handleStreamingChunk = useCallback((data: any) => {
    const { event, content, artifact } = data;

    if (event === "artifact_start") {
      const filePath = artifact.path;
      setStreamingState((prev) => ({
        ...prev,
        files: {
          ...prev.files,
          [filePath]: {
            path: filePath,
            title: artifact.title,
            content: "",
            isComplete: false,
            isActive: true,
          },
        },
        currentFile: filePath,
      }));

      setSelectedFilePath((prev) => prev || filePath);
      if (!selectedFilePathRef.current) setSelectedFileCode("");
    } else if (event === "content_chunk" && artifact) {
      const filePath = artifact.path;

      setStreamingState((prev) => ({
        ...prev,
        files: {
          ...prev.files,
          [filePath]: {
            ...prev.files[filePath],
            content: (prev.files[filePath]?.content || "") + content,
          },
        },
      }));

      if (selectedFilePathRef.current === filePath) {
        setSelectedFileCode((prev) => prev + content);
      }
    }
  }, []); // stable — reads selectedFilePath via ref

  const handleCompleteArtifact = useCallback((artifact: any) => {
    const { title, code, path } = artifact;
    if (!code || !path || !code.trim() || !path.trim()) return;

    const cleanPath = path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");

    setStreamingState((prev) => ({
      ...prev,
      files: {
        ...prev.files,
        [cleanPath]: {
          path: cleanPath,
          title: title || cleanPath.split("/").pop() || "Untitled",
          content: code,
          isComplete: true,
          isActive: false,
        },
      },
    }));

    if (!selectedFilePathRef.current) {
      setSelectedFilePath(cleanPath);
      setSelectedFileCode(code);
    } else if (selectedFilePathRef.current === cleanPath) {
      setSelectedFileCode(code);
    }
  }, []); // stable — reads selectedFilePath via ref

  // ────────────────────────────────────────────────────────────────
  // SSE streaming — used for both initial & follow-up chats
  // ────────────────────────────────────────────────────────────────

  const startStreaming = useCallback(() => {
    // Close any previous connection
    eventSourceRef.current?.close();

    const es = new EventSource(`${BACKEND_URL}/chat`);
    eventSourceRef.current = es;

    setStreamingState((prev) => ({ ...prev, isStreaming: true }));
    setAssistantStreamText("");

    let accumulatedText = "";

    es.onmessage = (event) => {
      if (event.data === "[DONE]") {
        es.close();
        eventSourceRef.current = null;
        setIsLoading(false);
        setIsSendingChat(false);
        setStreamingState((prev) => ({ ...prev, isStreaming: false }));

        // Save accumulated assistant text as a chat message
        if (accumulatedText.trim()) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: accumulatedText.trim(),
              timestamp: Date.now(),
            },
          ]);
        }
        setAssistantStreamText("");
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.type === "error") {
          accumulatedText += `\n[Error: ${data.error}]`;
          setAssistantStreamText(accumulatedText);
          return;
        }

        if (data.type === "text") {
          accumulatedText += data.content;
          setAssistantStreamText(accumulatedText);
        } else if (data.type === "chunk") {
          handleStreamingChunk(data);
        } else if (data.type === "complete") {
          handleCompleteArtifact(data.artifact);
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setIsLoading(false);
      setIsSendingChat(false);
      setStreamingState((prev) => ({ ...prev, isStreaming: false }));

      if (accumulatedText.trim()) {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: accumulatedText.trim(),
            timestamp: Date.now(),
          },
        ]);
      }
      setAssistantStreamText("");
    };
  }, []); // stable — handlers are stable via refs

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // ────────────────────────────────────────────────────────────────
  // Initial load — POST /template then POST /chat then GET /chat
  // ────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      if (!prompt) return;
      setIsLoading(true);

      // Reset
      setFileStructure({});
      setSelectedFileCode("");
      setSelectedFilePath("");
      setChatMessages([]);
      setAssistantStreamText("");
      setStreamingState({ files: {}, currentFile: null, isStreaming: false });

      // Add initial user message to chat
      setChatMessages([
        { role: "user", content: prompt, timestamp: Date.now() },
      ]);

      try {
        const response = await axios.post<TemplateResponse>(
          `${BACKEND_URL}/template`,
          { prompt: prompt.trim() },
        );

        const { prompts } = response.data;
        initialPromptsRef.current = prompts;

        await axios.post(`${BACKEND_URL}/chat`, {
          message: [...prompts, prompt].map(
            (content: string): ChatMsg => ({ parts: content }),
          ),
        });

        startStreaming();
      } catch (err) {
        console.error("Error initializing build view:", err);
        setIsLoading(false);
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Sorry, there was an error generating the project. Please try again.",
            timestamp: Date.now(),
          },
        ]);
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]); // startStreaming is stable via refs, no need in deps

  // ────────────────────────────────────────────────────────────────
  // Follow-up chat handler
  // ────────────────────────────────────────────────────────────────

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || isSendingChat || streamingState.isStreaming) return;

    setChatInput("");
    setIsSendingChat(true);

    // Add user message
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: text, timestamp: Date.now() },
    ]);

    try {
      // Build full conversation context
      const allParts: string[] = [...initialPromptsRef.current];
      chatMessages.forEach((msg) => {
        allParts.push(
          msg.role === "user"
            ? msg.content
            : "[Previous assistant response]",
        );
      });
      allParts.push(text);

      await axios.post(`${BACKEND_URL}/chat`, {
        message: allParts.map(
          (content: string): ChatMsg => ({ parts: content }),
        ),
      });

      startStreaming();
    } catch (err) {
      console.error("Error sending chat:", err);
      setIsSendingChat(false);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Failed to send message. Please try again.",
          timestamp: Date.now(),
        },
      ]);
    }
  };

  // ────────────────────────────────────────────────────────────────
  // Render helpers
  // ────────────────────────────────────────────────────────────────

  const FileExplorerSkeleton = () => (
    <div className="p-4 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 bg-gray-700 rounded w-1/2 animate-pulse" />
          <div className="ml-4 space-y-2">
            {[1, 2].map((j) => (
              <div
                key={j}
                className="h-4 bg-gray-700 rounded w-3/4 animate-pulse"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // ────────────────────────────────────────────────────────────────
  // JSX
  // ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      {/* ──── Chat Sidebar ──── */}
      <div className="w-80 bg-[#111111] border-r border-gray-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 hover:text-gray-300 transition-colors duration-200"
          >
            <Zap className="w-6 h-6 text-yellow-500" />
            <span className="font-bold text-xl">Renz</span>
          </button>
          <MessageSquare className="w-4 h-4 text-gray-500" />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-yellow-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-yellow-600 text-white"
                    : "bg-[#1A1A1A] text-gray-300 border border-gray-800"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {msg.role === "assistant"
                    ? stripXmlTags(msg.content)
                    : msg.content}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming assistant text */}
          {assistantStreamText && (
            <div className="flex gap-2 justify-start">
              <div className="w-6 h-6 rounded-full bg-yellow-600 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed bg-[#1A1A1A] text-gray-300 border border-gray-800">
                <p className="whitespace-pre-wrap break-words">
                  {stripXmlTags(assistantStreamText)}
                </p>
                <Loader2 className="w-3 h-3 animate-spin text-yellow-500 mt-1 inline-block" />
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {(isLoading || isSendingChat) && !assistantStreamText && (
            <div className="flex gap-2 justify-start">
              <div className="w-6 h-6 rounded-full bg-yellow-600 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="rounded-lg px-3 py-2 bg-[#1A1A1A] border border-gray-800">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500" />
                  Generating...
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <form
          onSubmit={handleChatSubmit}
          className="p-3 border-t border-gray-800"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask for changes..."
              disabled={isSendingChat || streamingState.isStreaming}
              className="flex-1 bg-[#1A1A1A] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500 text-white placeholder-gray-500 border border-gray-800 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={
                !chatInput.trim() ||
                isSendingChat ||
                streamingState.isStreaming
              }
              className="p-2 bg-yellow-600 rounded-lg hover:bg-yellow-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* ──── Main Content ──── */}
      <div className="flex-1 flex">
        {/* File Explorer */}
        <div className="w-64 bg-[#111111] border-r border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400">
              File Structure
            </h2>
            <div className="text-xs text-gray-600 mt-1">
              {Object.keys(streamingState.files).length} files
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && Object.keys(fileStructure).length === 0 ? (
              <FileExplorerSkeleton />
            ) : (
              <FileExplorer
                fileStructure={fileStructure}
                onFileSelect={handleFileSelect}
                selectedFilePath={selectedFilePath}
              />
            )}
          </div>
        </div>

        {/* Code / Preview */}
        <div className="flex-1 flex flex-col">
          {/* Tab bar */}
          <div className="border-b border-gray-800 p-2 flex items-center justify-between bg-[#111111]">
            <div className="flex">
              <button
                onClick={() => setActiveTab("code")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors duration-200 ${
                  activeTab === "code"
                    ? "bg-[#1A1A1A] text-white border border-gray-800"
                    : "text-gray-400 hover:text-white hover:bg-[#1A1A1A]"
                }`}
              >
                <Code2 className="w-4 h-4" />
                Code
              </button>
              <button
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors duration-200 ml-2 ${
                  activeTab === "preview"
                    ? "bg-[#1A1A1A] text-white border border-gray-800"
                    : "text-gray-400 hover:text-white hover:bg-[#1A1A1A]"
                }`}
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
            </div>

            {selectedFilePath && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>{selectedFilePath}</span>
                {streamingState.files[selectedFilePath] &&
                  !streamingState.files[selectedFilePath].isComplete && (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                  )}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1">
            {activeTab === "code" ? (
              <Editor
                height="100%"
                defaultLanguage="typescript"
                value={selectedFileCode}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "on",
                  readOnly: true,
                  wordWrap: "on",
                  padding: { top: 20, bottom: 20 },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorSmoothCaretAnimation: "on",
                }}
                onMount={(editor) => setEditorInstance(editor)}
              />
            ) : (
              <PreviewFrame
                fileStructure={fileStructure}
                isStreaming={streamingState.isStreaming}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BuildView;

import { useEffect, useState } from "react";
import { Code2, Eye, Zap, FileText, Loader2 } from "lucide-react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import {
  BuildStep,
  TemplateResponse,
  ChatMessage,
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

function BuildView() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);
  const [fileStructure, setFileStructure] = useState<FileStructure>({});
  const [selectedFileCode, setSelectedFileCode] = useState<string>("");
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [streamingState, setStreamingState] = useState<StreamingState>({
    files: {},
    currentFile: null,
    isStreaming: false,
  });
  const prompt = useSelector((state: RootState) => state.prompt.prompt);

  const [editorInstance, setEditorInstance] = useState<any>(null);

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

  useEffect(() => {
    async function init() {
      if (!prompt) return;
      setIsLoading(true);

      // Reset all states
      setBuildSteps([]);
      setFileStructure({});
      setSelectedFileCode("");
      setSelectedFilePath("");
      setStreamingState({
        files: {},
        currentFile: null,
        isStreaming: false,
      });

      try {
        const response = await axios.post<TemplateResponse>(
          `${BACKEND_URL}/template`,
          {
            prompt: prompt.trim(),
          },
        );

        const { prompts } = response.data;

        await axios.post(`${BACKEND_URL}/chat`, {
          message: [...prompts, prompt].map(
            (content: string): ChatMessage => ({ parts: content }),
          ),
        });

        const eventSource = new EventSource(`${BACKEND_URL}/chat`);
        let stepCounter = 0;

        setStreamingState((prev) => ({ ...prev, isStreaming: true }));

        eventSource.onmessage = (event) => {
          if (event.data === "[DONE]") {
            eventSource.close();
            setIsLoading(false);
            setStreamingState((prev) => ({ ...prev, isStreaming: false }));
            return;
          }

          try {
            const data = JSON.parse(event.data);

            if (data.type === "error") {
              console.error("❌ Streaming error:", data.error);
              return;
            }

            if (data.type === "chunk") {
              handleStreamingChunk(data);
            } else if (data.type === "complete") {
              handleCompleteArtifact(data.artifact, ++stepCounter);
            }
          } catch (err) {
            console.error("🔥 SSE parse error:", err);
          }
        };

        eventSource.onerror = (err) => {
          console.error("❌ EventSource failure:", err);
          eventSource.close();
          setIsLoading(false);
          setStreamingState((prev) => ({ ...prev, isStreaming: false }));
        };
      } catch (err) {
        console.error("🚨 Error initializing build view:", err);
        setIsLoading(false);
        setStreamingState((prev) => ({ ...prev, isStreaming: false }));
      }
    }

    init();
  }, [prompt]);

  const handleFileSelect = (code: string, path?: string) => {
    console.log("🔍 File selected:", path, "Code length:", code.length);

    let filePath = path;
    if (!filePath) {
      const streamingFile = Object.values(streamingState.files).find(
        (f) => f.content === code,
      );
      if (streamingFile) {
        filePath = streamingFile.path;
      } else {
        const buildStep = buildSteps.find((step) => step.code === code);
        if (buildStep) {
          filePath = buildStep.path;
        }
      }
    }

    setSelectedFileCode(code);
    setSelectedFilePath(filePath || "");
    setActiveTab("code");

    console.log("✅ Selected file path set to:", filePath);
  };

  const handleStreamingChunk = (data: any) => {
    console.log("📤 Streaming chunk received:", data);
    const { event, content, artifact } = data;

    if (event === "artifact_start") {
      console.log("🚀 Artifact start:", artifact);
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

      if (!selectedFilePath) {
        setSelectedFilePath(filePath);
        setSelectedFileCode("");
      }
    } else if (event === "content_chunk" && artifact) {
      const filePath = artifact.path;
      console.log(
        "📝 Content chunk for:",
        filePath,
        "Content length:",
        content?.length,
      );

      setStreamingState((prev) => ({
        ...prev,
        files: {
          ...prev.files,
          [filePath]: {
            ...prev.files[filePath],
            content: prev.files[filePath].content + content,
          },
        },
      }));

      if (selectedFilePath === filePath) {
        setSelectedFileCode((prev) => prev + content);
      }
    }
  };

  // Fixed file structure building function
  const buildFileStructure = (
    artifacts: { path: string; code: string }[],
  ): FileStructure => {
    const structure: FileStructure = {};

    artifacts.forEach(({ path, code }) => {
      if (!path || !code) return;

      // Clean and normalize the path
      const cleanPath = path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
      if (!cleanPath) return;

      const pathParts = cleanPath.split("/");
      let current = structure;

      // Navigate/create the directory structure
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (!current[part]) {
          current[part] = {};
        } else if (typeof current[part] === "string") {
          // If there's a collision (file with same name as directory), convert to directory
          console.warn(`⚠️ Converting file to directory: ${part}`);
          current[part] = {};
        }
        current = current[part] as FileStructure;
      }

      // Set the file content
      const fileName = pathParts[pathParts.length - 1];
      current[fileName] = code;
    });

    return structure;
  };

  useEffect(() => {
    const artifacts = Object.values(streamingState.files)
      // only include files that have some content
      .filter((f) => f.content)
      .map((f) => ({ path: f.path, code: f.content }));

    const newStructure = buildFileStructure(artifacts);
    setFileStructure(newStructure);
  }, [streamingState.files]);

  const handleCompleteArtifact = (artifact: any, stepNumber: number) => {
    console.log("✅ Complete artifact received:", artifact);
    const { title, code, path } = artifact;

    if (!code || !path || code.trim() === "" || path.trim() === "") {
      console.warn("⛔ Invalid artifact skipped:", artifact);
      return;
    }

    // Clean the path by removing leading/trailing slashes and normalizing
    const cleanPath = path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");

    console.log("🧹 Cleaned path:", cleanPath);

    // Update streaming state
    setStreamingState((prev) => ({
      ...prev,
      files: {
        ...prev.files,
        [cleanPath]: {
          path: cleanPath,
          title: title || `Step ${stepNumber}`,
          content: code,
          isComplete: true,
          isActive: false,
        },
      },
    }));

    // Add to build steps
    setBuildSteps((prev) => {
      const newSteps = [
        ...prev,
        {
          title: title || `Step ${stepNumber}`,
          status: "completed" as const,
          code,
          path: cleanPath,
        },
      ];

      // Rebuild file structure from all completed artifacts
      const allArtifacts = newSteps.map((step) => ({
        path: step.path,
        code: step.code,
      }));
      const newFileStructure = buildFileStructure(allArtifacts);

      console.log("🌳 Updated file structure:", newFileStructure);
      setFileStructure(newFileStructure);

      return newSteps;
    });

    // Update selected file if it's the current one
    if (selectedFilePath === cleanPath) {
      setSelectedFileCode(code);
    }

    // Set first completed file as selected if none is selected
    if (!selectedFilePath) {
      setSelectedFilePath(cleanPath);
      setSelectedFileCode(code);
    }
  };

  const BuildStepSkeleton = () => (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="p-3 rounded-lg bg-[#1A1A1A] animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
        </div>
      ))}
    </div>
  );

  const FileExplorerSkeleton = () => (
    <div className="p-4 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 bg-gray-700 rounded w-1/2 animate-pulse"></div>
          <div className="ml-4 space-y-2">
            {[1, 2].map((j) => (
              <div
                key={j}
                className="h-4 bg-gray-700 rounded w-3/4 animate-pulse"
              ></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const StreamingIndicator = ({ filePath }: { filePath: string }) => {
    const file = streamingState.files[filePath];
    if (!file || file.isComplete) return null;

    return (
      <div className="flex items-center gap-2 text-xs text-blue-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        Streaming...
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      {/* Build Steps Sidebar */}
      <div className="w-72 bg-[#111111] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 hover:text-gray-300 transition-colors duration-200"
          >
            <Zap className="w-6 h-6 text-yellow-500" />
            <span className="font-bold text-xl">Renz</span>
          </button>
        </div>
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">
            Build Steps
          </h2>
          {isLoading ? (
            <BuildStepSkeleton />
          ) : (
            <>
              {buildSteps.map((step, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg transition-all duration-200 cursor-pointer ${
                    selectedFilePath === step.path
                      ? "bg-blue-900/30 border border-blue-500"
                      : "bg-[#1A1A1A] text-gray-300 border border-gray-700 hover:bg-[#222222]"
                  }`}
                  onClick={() => handleFileSelect(step.code, step.path)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <h3 className="font-medium text-sm">{step.title}</h3>
                    </div>
                    <StreamingIndicator filePath={step.path} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{step.path}</p>
                </div>
              ))}

              {/* Show currently streaming files */}
              {Object.values(streamingState.files)
                .filter((file) => !file.isComplete && file.content)
                .map((file, index) => (
                  <div
                    key={`streaming-${index}`}
                    className={`p-3 rounded-lg transition-all duration-200 cursor-pointer ${
                      selectedFilePath === file.path
                        ? "bg-blue-900/30 border border-blue-500"
                        : "bg-[#1A1A1A] text-gray-300 border border-gray-700 hover:bg-[#222222]"
                    }`}
                    onClick={() => handleFileSelect(file.content, file.path)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        <h3 className="font-medium text-sm">{file.title}</h3>
                      </div>
                      <StreamingIndicator filePath={file.path} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{file.path}</p>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* File Explorer */}
        <div className="w-72 bg-[#111111] border-r border-gray-800">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">
              File Structure
            </h2>

            {/* Debug info */}
            <div className="text-xs text-gray-500 mb-2">
              Files: {Object.keys(fileStructure).length}
            </div>

            {/* Debug button */}
            <button
              onClick={() => {
                console.log("🐛 File structure:", fileStructure);
                console.log("🐛 Build steps:", buildSteps);
                console.log("🐛 Streaming state:", streamingState);
              }}
              className="mb-2 px-2 py-1 bg-gray-700 text-xs rounded hover:bg-gray-600"
            >
              Debug
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
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

        {/* Code/Preview Area */}
        <div className="flex-1 flex flex-col">
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

            {/* File info */}
            {selectedFilePath && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>{selectedFilePath}</span>
                <StreamingIndicator filePath={selectedFilePath} />
              </div>
            )}
          </div>

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

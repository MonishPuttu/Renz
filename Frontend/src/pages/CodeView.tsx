import { useEffect, useState } from 'react';
import { Code2, Eye, Zap } from 'lucide-react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { BuildStep, Step } from '../Types';
import { parseXml } from '../XmlPraser/Praser';
//import { BACKEND_URL } from '../Types/config';
import { useSelector } from 'react-redux';
import { RootState } from '../Redux/Store';
import FileExplorer from '../components/FileExplorer';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.BACKEND_URL || 'http://localhost:3000';

function BuildView() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);
  const [fileStructure, setFileStructure] = useState<any>({});
  const [selectedFileCode, setSelectedFileCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const prompt = useSelector((state: RootState) => state.prompt.prompt);

  async function init() {
    if (!prompt) return;

    try {
      setIsLoading(true);
      const response = await axios.post(`${BACKEND_URL}/template`, {
        prompt: prompt.trim()
      });

      //@ts-ignore
      const { prompts, uiPrompts } = response.data;

      const parsedSteps: BuildStep[] = parseXml(uiPrompts[0]).map((x: Step) => ({
        title: x.title || 'Unnamed Step',
        status: 'pending' as 'pending' | 'in-progress' | 'completed',
        code: x.code || '',
        path: x.path || ''
      }));

      setBuildSteps(parsedSteps);

      // Organize files from the parsed steps
      const newFileStructure: any = {};
      let firstFileCode = '';
      parsedSteps.forEach(step => {
        if (step.path) {
          const pathParts = step.path.split('/').filter(Boolean);
          let current = newFileStructure;
          
          for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            if (i === pathParts.length - 1) {
              // It's a file
              current[part] = step.code || '';
              // Store the first file's code
              if (!firstFileCode && step.code) {
                firstFileCode = step.code;
              }
            } else {
              // It's a folder
              if (!current[part]) {
                current[part] = {};
              }
              current = current[part];
            }
          }
        }
      });

      setFileStructure(newFileStructure);
      
      // Set the first file's code if available
      if (firstFileCode) {
        setSelectedFileCode(firstFileCode);
      }

      // Send the initial message first
      await axios.post(`${BACKEND_URL}/chat`, {
        message: [...prompts, prompt].map(content => ({
          parts: content
        }))
      });

      // Then set up the EventSource to receive the streamed response
      const eventSource = new EventSource(`${BACKEND_URL}/chat`);

      eventSource.onmessage = (event) => {
        if (event.data === '[DONE]') {
          eventSource.close();
          setIsLoading(false);
          return;
        }

        try {
          const data = JSON.parse(event.data);
          if (data.text) {
            // Update build steps status as they are completed
            setBuildSteps(prevSteps => {
              return prevSteps.map((step, index) => {
                if (index === prevSteps.findIndex(s => s.status === 'pending')) {
                  return { ...step, status: 'completed' };
                }
                return step;
              });
            });
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource failed:', error);
        eventSource.close();
        setIsLoading(false);
      };

    } catch (error) {
      console.error("Error initializing build view:", error);
      setIsLoading(false);
    }
  }

  useEffect(() => {
    init();
  }, []);

  const handleFileSelect = (code: string) => {
    setSelectedFileCode(code);
    setActiveTab('code');
  };

  // Skeleton loader component for build steps
  const BuildStepSkeleton = () => (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="p-3 rounded-lg bg-[#1A1A1A] animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
        </div>
      ))}
    </div>
  );

  // Skeleton loader component for file explorer
  const FileExplorerSkeleton = () => (
    <div className="p-4 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 bg-gray-700 rounded w-1/2 animate-pulse"></div>
          <div className="ml-4 space-y-2">
            {[1, 2].map((j) => (
              <div key={j} className="h-4 bg-gray-700 rounded w-3/4 animate-pulse"></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      {/* Build Steps Sidebar */}
      <div className="w-72 bg-[#111111] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:text-gray-300 transition-colors duration-200"
          >
            <Zap className="w-6 h-6 text-yellow-500" />
            <span className="font-bold text-xl">Bolt</span>
          </button>
        </div>
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">Build Steps</h2>
          {isLoading ? (
            <BuildStepSkeleton />
          ) : (
            buildSteps.map((step, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg transition-all duration-200 ${
                  step.status === 'completed'
                    ? 'bg-[#1A1A1A] text-gray-300 border border-gray-700'
                    : step.status === 'in-progress'
                    ? 'bg-[#1A1A1A] text-gray-300 border border-gray-700'
                    : 'bg-[#1A1A1A] text-gray-400 hover:bg-[#222222]'
                }`}
              >
                <h3 className="font-medium truncate">{step.title}</h3>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* File Explorer */}
        <div className="w-72 bg-[#111111] border-r border-gray-800">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">File Structure</h2>
            {isLoading ? (
              <FileExplorerSkeleton />
            ) : (
              <FileExplorer fileStructure={fileStructure} onFileSelect={handleFileSelect} />
            )}
          </div>
        </div>

        {/* Code/Preview Area */}
        <div className="flex-1 flex flex-col">
          <div className="border-b border-gray-800 p-2 flex bg-[#111111]">
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors duration-200 ${
                activeTab === 'code' 
                  ? 'bg-[#1A1A1A] text-white border border-gray-800' 
                  : 'text-gray-400 hover:text-white hover:bg-[#1A1A1A]'
              }`}
            >
              <Code2 className="w-4 h-4" />
              Code
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors duration-200 ml-2 ${
                activeTab === 'preview' 
                  ? 'bg-[#1A1A1A] text-white border border-gray-800' 
                  : 'text-gray-400 hover:text-white hover:bg-[#1A1A1A]'
              }`}
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>

          <div className="flex-1">
            {activeTab === 'code' ? (
              <Editor
                height="100%"
                defaultLanguage="typescript"
                value={selectedFileCode}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  readOnly: true,
                  wordWrap: 'on',
                  padding: { top: 20, bottom: 20 }
                }}
              />
            ) : (
              <div className="bg-[#1A1A1A] h-full w-full flex items-center justify-center">
                <p className="text-gray-400">Preview content will be available soon</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BuildView;

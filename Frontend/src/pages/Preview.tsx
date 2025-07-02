import { useState } from 'react';
import { Code2, Eye } from 'lucide-react';

function CodeView() {
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('preview');

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b border-gray-800 p-2 flex">
        <button
          onClick={() => setActiveTab('code')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded ${
            activeTab === 'code' ? 'bg-[#1A1A1A] text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Code2 className="w-4 h-4" />
          Code
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded ml-2 ${
            activeTab === 'preview' ? 'bg-[#1A1A1A] text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Eye className="w-4 h-4" />
          Preview
        </button>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {activeTab === 'code' ? (
          <pre className="text-sm font-mono bg-[#1A1A1A] p-4 rounded-lg overflow-x-auto">
            <code className="text-gray-300">
{`import React from 'react';
import { Bot } from 'lucide-react';

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <h1>Hello World</h1>
    </div>
  );
}`}
            </code>
          </pre>
        ) : (
          <div className="bg-white rounded-lg h-full w-full" />
        )}
      </div>
    </div>
  );
}

export default CodeView;
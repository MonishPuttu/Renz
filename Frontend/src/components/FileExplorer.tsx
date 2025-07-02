import { FileCode, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface FileExplorerProps {
  fileStructure: any;
  onFileSelect: (code: string) => void;
}

export default function FileExplorer({ fileStructure, onFileSelect }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/src']));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  const handleFileClick = (path: string, code: string) => {
    setSelectedFile(path);
    onFileSelect(code);
  };

  const renderFileTree = (structure: any, path = '') => {
    return Object.entries(structure).map(([key, value]) => {
      const fullPath = `${path}/${key}`;
      const isFolder = typeof value === 'object';
      const isExpanded = expandedFolders.has(fullPath);
      const isSelected = !isFolder && selectedFile === fullPath;

      return (
        <div key={fullPath} className="ml-4">
          <div
            className={`flex items-center gap-2 py-1 px-2 hover:bg-[#1A1A1A] rounded cursor-pointer ${
              isSelected ? 'bg-blue-500/20 text-blue-500' : ''
            }`}
            onClick={() => {
              if (isFolder) {
                toggleFolder(fullPath);
              } else {
                handleFileClick(fullPath, value as string);
              }
            }}
          >
            {isFolder ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
                <Folder className="w-4 h-4 text-blue-500" />
              </>
            ) : (
              <>
                <span className="w-4" />
                <FileCode className="w-4 h-4 text-gray-400" />
              </>
            )}
            <span className="text-sm">{key}</span>
          </div>
          {isFolder && isExpanded && renderFileTree(value, fullPath)}
        </div>
      );
    });
  };

  return (
    <div className="w-64">
      <div className="p-2">{renderFileTree(fileStructure)}</div>
    </div>
  );
} 
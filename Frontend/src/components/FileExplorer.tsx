import React, { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";

export interface FileStructure {
  [key: string]: string | FileStructure;
}

interface FileExplorerProps {
  fileStructure: FileStructure;
  onFileSelect: (code: string, path?: string) => void;
  selectedFilePath?: string;
}

interface FileNode {
  name: string;
  path: string;
  isFile: boolean;
  content?: string;
  children?: FileNode[];
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  fileStructure,
  onFileSelect,
  selectedFilePath,
}) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set([""]),
  );

  // Auto-expand parent directories when a file is selected
  useEffect(() => {
    if (selectedFilePath) {
      const pathParts = selectedFilePath.split("/").filter(Boolean);
      const newExpanded = new Set(expandedPaths);

      let currentPath = "";
      for (const part of pathParts.slice(0, -1)) {
        // Exclude the file itself
        currentPath += (currentPath ? "/" : "") + part;
        newExpanded.add(currentPath);
      }

      setExpandedPaths(newExpanded);
    }
  }, [selectedFilePath]);

  const toggleExpand = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const buildFileTree = (
    structure: FileStructure,
    parentPath = "",
  ): FileNode[] => {
    if (!structure || typeof structure !== "object") return [];

    return Object.entries(structure).map(([name, value]) => {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;

      if (typeof value === "string") {
        // It's a file
        return {
          name,
          path: fullPath,
          isFile: true,
          content: value,
        };
      } else {
        // It's a directory
        return {
          name,
          path: fullPath,
          isFile: false,
          children: buildFileTree(value, fullPath),
        };
      }
    });
  };

  const renderFileTree = (nodes: FileNode[], depth = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const isExpanded = expandedPaths.has(node.path);
      const isSelected = selectedFilePath === node.path;
      const indent = depth * 16; // 16px per level

      return (
        <div key={node.path}>
          <div
            className={`
              flex items-center py-1 px-2 rounded cursor-pointer transition-colors duration-150
              ${
                isSelected
                  ? "bg-amber-500/10 text-amber-400 border-l-2 border-amber-500"
                  : "text-zinc-300 hover:bg-zinc-800/50 hover:text-white"
              }
            `}
            style={{ paddingLeft: `${indent + 8}px` }}
            onClick={() => {
              if (node.isFile) {
                onFileSelect(node.content || "", node.path);
              } else {
                toggleExpand(node.path);
              }
            }}
          >
            {!node.isFile && (
              <div className="w-4 h-4 mr-1 flex items-center justify-center">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </div>
            )}

            <div className="w-4 h-4 mr-2 flex items-center justify-center">
              {node.isFile ? (
                <File className="w-3 h-3 text-zinc-500" />
              ) : isExpanded ? (
                <FolderOpen className="w-3 h-3 text-amber-500" />
              ) : (
                <Folder className="w-3 h-3 text-amber-500" />
              )}
            </div>

            <span className="text-sm truncate">{node.name}</span>
          </div>

          {!node.isFile && isExpanded && node.children && (
            <div>{renderFileTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const fileTree = buildFileTree(fileStructure);

  return (
    <div className="text-sm">
      {fileTree.length === 0 ? (
        <div className="text-zinc-500 p-4 text-center">
          <File className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No files to display</p>
        </div>
      ) : (
        <div className="space-y-1">{renderFileTree(fileTree)}</div>
      )}
    </div>
  );
};

export default FileExplorer;

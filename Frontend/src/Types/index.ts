export interface BuildStep {
  title: string;
  status: 'completed' | 'pending' | 'error' | 'in-progress';
  code: string;
  path: string;
}

export interface TemplateResponse {
  prompts: string[];
  sessionId: string;
}

export interface ChatMessage {
  parts: string;
}

export interface SSEData {
  xml?: string;
}

export interface FileStructure {
  [key: string]: string | FileStructure;
}

// Step types for the XML parser
export enum StepType {
  CreateFolder = 'create-folder',
  CreateFile = 'create-file',
  RunScript = 'run-script',
  InstallDependencies = 'install-dependencies'
}

export interface Step {
  id: number;
  title: string;
  description: string;
  type: StepType;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  code?: string;
  path?: string;
}

export interface StreamingChunkData {
  type: 'chunk';
  event: 'artifact_start' | 'content_chunk';
  content?: string;
  artifact?: {
    title: string;
    path: string;
    type: string;
  };
}  
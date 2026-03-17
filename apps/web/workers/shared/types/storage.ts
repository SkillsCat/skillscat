export interface DirectoryFile {
  path: string;
  sha: string;
  size: number;
  type: 'text' | 'binary';
}

export interface FileStructure {
  commitSha: string;
  indexedAt: string;
  files: DirectoryFile[];
  fileTree: FileNode[];
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  mode: string;
}

export interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

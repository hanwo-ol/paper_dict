import type { FileNode } from './fileSystem';

// Fetch flat git tree recursive list
export async function fetchGithubTree(
  owner: string,
  repo: string,
  branch: string = 'main',
  token: string | null = null
): Promise<any[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`GitHub API returned status ${response.status}`);
  }

  const data = await response.json();
  return data.tree || [];
}

// Convert flat git tree response to FileNode tree structure
export function buildFileTreeFromGitTree(
  treeItems: any[],
  basePath: string = ''
): FileNode[] {
  const rootNodes: FileNode[] = [];
  const dirMap: Record<string, FileNode> = {};

  // Normalize basePath (remove leading/trailing slashes)
  const cleanBasePath = basePath.replace(/^\/+|\/+$/g, '');

  // Filter items that belong to the base path, and only keep directories and markdown files
  const filteredItems = treeItems.filter(item => {
    if (cleanBasePath) {
      if (!item.path.startsWith(cleanBasePath + '/')) return false;
    }
    
    // Only keep directories and markdown files
    if (item.type === 'blob') {
      return item.path.endsWith('.md');
    }
    return item.type === 'tree';
  });

  // Sort by path length so parents are processed before children
  filteredItems.sort((a, b) => a.path.length - b.path.length);

  filteredItems.forEach(item => {
    // Relative path from the base path
    let relativePath = item.path;
    if (cleanBasePath) {
      relativePath = item.path.substring(cleanBasePath.length + 1);
    }

    const parts = relativePath.split('/');
    const name = parts[parts.length - 1];
    
    // Directory path of the item
    const parentParts = parts.slice(0, parts.length - 1);
    const parentPath = parentParts.join('/');

    const node: FileNode = {
      name,
      kind: item.type === 'tree' ? 'directory' : 'file',
      path: relativePath,
      // Pass the sha and size inside handle object to simulate FileSystemHandle structure
      handle: {
        kind: item.type === 'tree' ? 'directory' : 'file',
        name,
        sha: item.sha,
        size: item.size || 0,
        fullPath: item.path // keep full path in repo
      } as any,
      children: item.type === 'tree' ? [] : undefined
    };

    if (item.type === 'tree') {
      dirMap[relativePath] = node;
    }

    if (parentParts.length === 0) {
      // Root level node within the selected subfolder
      rootNodes.push(node);
    } else {
      const parentNode = dirMap[parentPath];
      if (parentNode && parentNode.children) {
        parentNode.children.push(node);
      }
    }
  });

  // Sort nodes helper: directories first, then alphabetically
  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind === b.kind) return a.name.localeCompare(b.name);
      return a.kind === 'directory' ? -1 : 1;
    });
    
    nodes.forEach(node => {
      if (node.children) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(rootNodes);
  return rootNodes;
}

// Download raw file text from GitHub via blob sha
export async function readGithubFileContent(
  owner: string,
  repo: string,
  sha: string,
  token: string | null = null
): Promise<string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3.raw',
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to read file from GitHub, status: ${response.status}`);
  }

  return await response.text();
}

// Write/Create file in GitHub and return new SHA
export async function writeGithubFileContent(
  owner: string,
  repo: string,
  fullPath: string,
  content: string,
  sha: string | null,
  token: string,
  branch: string = 'main',
  message: string = 'Update note'
): Promise<string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'Authorization': `token ${token}`
  };

  // Convert unicode string correctly to base64
  const base64Content = btoa(unescape(encodeURIComponent(content)));

  const body: Record<string, any> = {
    message,
    content: base64Content,
    branch
  };

  // If modifying existing file, SHA is mandatory
  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${fullPath}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `Failed to write file, status: ${response.status}`);
  }

  const data = await response.json();
  return data.content.sha;
}

// Delete file in GitHub
export async function deleteGithubFile(
  owner: string,
  repo: string,
  fullPath: string,
  sha: string,
  token: string,
  branch: string = 'main',
  message: string = 'Delete note'
): Promise<void> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'Authorization': `token ${token}`
  };

  const body = {
    message,
    sha,
    branch
  };

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${fullPath}`,
    {
      method: 'DELETE',
      headers,
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `Failed to delete file, status: ${response.status}`);
  }
}

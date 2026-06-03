export interface FileNode {
  name: string;
  kind: 'file' | 'directory';
  path: string;
  handle: FileSystemHandle | FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: FileNode[];
}

export async function readDirectoryRecursive(
  dirHandle: any,
  currentPath: string = ''
): Promise<FileNode[]> {
  const nodes: FileNode[] = [];
  
  for await (const entry of dirHandle.values()) {
    const nodePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    
    if (entry.kind === 'file') {
      // We only care about markdown files for now
      if (entry.name.endsWith('.md')) {
        nodes.push({
          name: entry.name,
          kind: 'file',
          path: nodePath,
          handle: entry
        });
      }
    } else if (entry.kind === 'directory') {
      // Ignore hidden directories like .git or .obsidian
      if (entry.name.startsWith('.')) continue;
      
      const children = await readDirectoryRecursive(entry, nodePath);
      nodes.push({
        name: entry.name,
        kind: 'directory',
        path: nodePath,
        handle: entry,
        children
      });
    }
  }
  
  // Sort: directories first, then files, both alphabetically
  nodes.sort((a, b) => {
    if (a.kind === b.kind) return a.name.localeCompare(b.name);
    return a.kind === 'directory' ? -1 : 1;
  });
  
  return nodes;
}

export async function readFileContent(fileHandle: any): Promise<string> {
  const file = await fileHandle.getFile();
  return await file.text();
}

export async function writeFileContent(fileHandle: any, content: string): Promise<void> {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { readDirectoryRecursive, readFileContent, writeFileContent } from './utils/fileSystem';
import { parseMarkdownMetadata } from './utils/parser';
import { 
  fetchGithubTree, 
  buildFileTreeFromGitTree, 
  readGithubFileContent, 
  writeGithubFileContent, 
  deleteGithubFile 
} from './utils/githubApi';
import type { FileNode } from './utils/fileSystem';
import type { FileMetadata } from './utils/parser';
import { Folder, Network, Key } from 'lucide-react';

interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string | null;
}

// Helper: Format date/time to YYYY-MM-DD HH:mm:ss
const getFormattedDateTime = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

// Helper: Generate default standard Markdown template (no emojis)
const generateDefaultTemplate = (title: string) => {
  const dateTime = getFormattedDateTime();
  return `---
title: "${title}"
created: ${dateTime}
updated: ${dateTime}
type: "concept"
status: "inbox"
tags:
  - "inbox"
aliases: []
---

# ${title}

## 개요
> 이 노트의 핵심 정의나 한 줄 요약을 작성하세요.

## 연관 노트
* 상위 주제: [[상위 주제 노트]]
* 관련 노트: [[관련 노트]]

## 본문
* 내용을 작성하고 관련 단어는 [[다른 노트]] 형태로 연결해 보세요.
`;
};

// Helper: Read custom template from .templates/default-template.md if it exists
const getCustomTemplateContent = async (rootHandle: any, vaultType: 'local' | 'github', _githubConfig: GitHubConfig | null): Promise<string | null> => {
  if (vaultType === 'local') {
    try {
      const templatesDir = await rootHandle.getDirectoryHandle('.templates');
      const templateFile = await templatesDir.getFileHandle('default-template.md');
      const file = await templateFile.getFile();
      return await file.text();
    } catch (e) {
      return null;
    }
  } else {
    // GitHub: Search inside contentMap if cached
    return null; // Fallback to default
  }
};

// Helper: Replace custom template placeholders
const applyCustomTemplate = (rawTemplate: string, title: string) => {
  const dateTime = getFormattedDateTime();
  return rawTemplate
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{created\}\}/g, dateTime)
    .replace(/\{\{updated\}\}/g, dateTime);
};

// Helper: Rename Wiki-links [[OldName]] -> [[NewName]] or [[OldName|Alias]] -> [[NewName|Alias]]
const renameWikiLinksInText = (text: string, oldName: string, newName: string): string => {
  const escapedOld = oldName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\[\\[(${escapedOld})(?:\\|([^\\]]+))?\\]\\]`, 'g');
  return text.replace(regex, (_, _target, alias) => {
    if (alias) return `[[${newName}|${alias}]]`;
    return `[[${newName}]]`;
  });
};

// Helper: Update frontmatter updated time before writing to disk
const updateFrontmatterTime = (content: string): string => {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return content; // No frontmatter
  
  const fmContent = fmMatch[1];
  const nowStr = getFormattedDateTime();
  
  let updatedFm = fmContent;
  if (fmContent.match(/^updated:/m)) {
    updatedFm = fmContent.replace(/^updated:\s*.*$/m, `updated: ${nowStr}`);
  } else {
    updatedFm = fmContent.trim() + `\nupdated: ${nowStr}\n`;
  }
  
  return content.replace(fmMatch[1], updatedFm);
};

function App() {
  const [vaultType, setVaultType] = useState<'local' | 'github' | null>(null);
  const [dirHandle, setDirHandle] = useState<any | null>(null);
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  
  // State for original file content vs current draft editor content
  const [originalContent, setOriginalContent] = useState<string>('');
  const [draftContent, setDraftContent] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle');

  // Metadata map for all markdown files to build the graph view
  const [metadataMap, setMetadataMap] = useState<Record<string, FileMetadata>>({});
  // Raw content cache of all files for real-time full-text search
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  // Search query state
  const [searchQuery, setSearchQuery] = useState<string>('');

  // History Stack for navigation (back/forward)
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // GitHub Vault state config
  const [githubConfig, setGithubConfig] = useState<GitHubConfig | null>(null);
  const [showGithubModal, setShowGithubModal] = useState<boolean>(false);
  const [githubTokenRequested, setGithubTokenRequested] = useState<boolean>(false);

  // Load basic GitHub configurations from localStorage on mount (excluding Token)
  useEffect(() => {
    const savedOwner = localStorage.getItem('gh_owner');
    const savedRepo = localStorage.getItem('gh_repo');
    const savedBranch = localStorage.getItem('gh_branch');
    const savedPath = localStorage.getItem('gh_path');
    
    // Attempt to load token from sessionStorage (wipes when tab closes)
    const savedToken = sessionStorage.getItem('gh_token');

    if (savedOwner && savedRepo) {
      setGithubConfig({
        owner: savedOwner,
        repo: savedRepo,
        branch: savedBranch || 'main',
        path: savedPath || '',
        token: savedToken
      });
    }
  }, []);

  // Abstract reader supporting local file handles and GitHub raw content downloads
  const readNoteContent = async (node: FileNode): Promise<string> => {
    if (vaultType === 'local') {
      return await readFileContent(node.handle);
    } else {
      if (!githubConfig) throw new Error("GitHub 설정이 없습니다.");
      const handle = node.handle as any;
      return await readGithubFileContent(
        githubConfig.owner,
        githubConfig.repo,
        handle.sha,
        githubConfig.token
      );
    }
  };

  // Abstract writer supporting local directories and GitHub PUT API commits
  const writeNoteContent = async (node: FileNode, content: string): Promise<string | null> => {
    if (vaultType === 'local') {
      await writeFileContent(node.handle, content);
      return null;
    } else {
      if (!githubConfig) throw new Error("GitHub 설정이 없습니다.");
      if (!githubConfig.token) {
        setGithubTokenRequested(true);
        throw new Error("읽기 전용 모드에서는 저장할 수 없습니다.");
      }
      
      const handle = node.handle as any;
      const noteTitle = node.name.replace(/\.md$/i, '');
      const newSha = await writeGithubFileContent(
        githubConfig.owner,
        githubConfig.repo,
        handle.fullPath,
        content,
        handle.sha,
        githubConfig.token,
        githubConfig.branch,
        `Update note: ${noteTitle}`
      );

      // Mutate the sha key dynamically in the tree node handle so future writes match
      node.handle = {
        ...node.handle,
        sha: newSha
      } as any;

      return newSha;
    }
  };

  // Helper to recursively find file node in tree by name
  const findFileNodeByName = (nodes: FileNode[], targetName: string): FileNode | null => {
    const cleanTarget = targetName.toLowerCase().endsWith('.md') ? targetName.toLowerCase() : `${targetName.toLowerCase()}.md`;
    
    for (const node of nodes) {
      if (node.kind === 'file' && node.name.toLowerCase() === cleanTarget) {
        return node;
      }
      if (node.kind === 'directory' && node.children) {
        const found = findFileNodeByName(node.children, targetName);
        if (found) return found;
      }
    }
    return null;
  };

  // Helper to recursively scan all markdown files, parsing metadata and caching contents
  const scanVault = async (
    nodes: FileNode[], 
    currentMetaMap: Record<string, FileMetadata> = {},
    currentContentMap: Record<string, string> = {}
  ): Promise<{ metaMap: Record<string, FileMetadata>; contentMap: Record<string, string> }> => {
    for (const node of nodes) {
      if (node.kind === 'file' && node.name.endsWith('.md')) {
        try {
          const content = await readNoteContent(node);
          const meta = parseMarkdownMetadata(content, node.name);
          const noteTitle = node.name.replace(/\.md$/i, '');
          currentMetaMap[noteTitle] = meta;
          currentContentMap[noteTitle] = content;
        } catch (err) {
          console.error("Failed to parse metadata and content for", node.name, err);
        }
      } else if (node.kind === 'directory' && node.children) {
        await scanVault(node.children, currentMetaMap, currentContentMap);
      }
    }
    return { metaMap: currentMetaMap, contentMap: currentContentMap };
  };

  const handleOpenVault = async () => {
    try {
      // @ts-expect-error File System Access API
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      setVaultType('local');
      setDirHandle(handle);
      setVaultName(handle.name);
      
      const nodes = await readDirectoryRecursive(handle);
      setFileTree(nodes);
      setSelectedFile(null);
      setOriginalContent('');
      setDraftContent('');
      setSaveStatus('idle');

      // Reset history
      setHistory([]);
      setHistoryIndex(-1);

      // Scan and cache all vault contents and metadata
      const { metaMap, contentMap: rawContentMap } = await scanVault(nodes);
      setMetadataMap(metaMap);
      setContentMap(rawContentMap);
    } catch (err) {
      console.error("Vault selection failed", err);
    }
  };

  // Remote loader helper for GitHub Vault connection
  const connectGithubVault = async (config: GitHubConfig) => {
    try {
      setSaveStatus('idle');
      const treeItems = await fetchGithubTree(config.owner, config.repo, config.branch, config.token);
      const nodes = buildFileTreeFromGitTree(treeItems, config.path);

      setVaultType('github');
      setDirHandle(null);
      setVaultName(`${config.owner}/${config.repo}`);
      setFileTree(nodes);
      setSelectedFile(null);
      setOriginalContent('');
      setDraftContent('');

      setHistory([]);
      setHistoryIndex(-1);

      // Temporary scan cache (downloading files remotely)
      // Since downloading all files at once can trigger rate limit,
      // we do it recursive in background
      const { metaMap, contentMap: rawContentMap } = await scanVault(nodes);
      setMetadataMap(metaMap);
      setContentMap(rawContentMap);

      // Persist config to browser
      localStorage.setItem('gh_owner', config.owner);
      localStorage.setItem('gh_repo', config.repo);
      localStorage.setItem('gh_branch', config.branch);
      localStorage.setItem('gh_path', config.path);
      if (config.token) {
        sessionStorage.setItem('gh_token', config.token);
      } else {
        sessionStorage.removeItem('gh_token');
      }

      setGithubConfig(config);
      setShowGithubModal(false);
    } catch (err: any) {
      console.error("Failed to connect GitHub Repository", err);
      alert(`GitHub 저장소 연결 실패: ${err.message || '정보가 유효하지 않습니다.'}`);
    }
  };

  const refreshFileTree = async () => {
    if (vaultType === 'local') {
      const nodes = await readDirectoryRecursive(dirHandle);
      setFileTree(nodes);
      return nodes;
    } else if (vaultType === 'github' && githubConfig) {
      const treeItems = await fetchGithubTree(githubConfig.owner, githubConfig.repo, githubConfig.branch, githubConfig.token);
      const nodes = buildFileTreeFromGitTree(treeItems, githubConfig.path);
      setFileTree(nodes);
      return nodes;
    }
    return [];
  };

  const handleSelectFile = async (node: FileNode, isHistoryNavigation: boolean = false) => {
    // 1. Unsaved check before switching
    if (selectedFile && draftContent !== originalContent) {
      try {
        const finalSaveContent = updateFrontmatterTime(draftContent);
        await writeNoteContent(selectedFile, finalSaveContent);
        
        const prevTitle = selectedFile.name.replace(/\.md$/i, '');
        const updatedMeta = parseMarkdownMetadata(finalSaveContent, selectedFile.name);
        setMetadataMap(prev => ({ ...prev, [prevTitle]: updatedMeta }));
        setContentMap(prev => ({ ...prev, [prevTitle]: finalSaveContent }));
      } catch (err) {
        console.error("Failed to save changes before switching", err);
      }
    }

    // 2. Select new file
    setSelectedFile(node);
    setSaveStatus('idle');
    try {
      const content = await readNoteContent(node);
      setOriginalContent(content);
      setDraftContent(content);

      // 3. History stack handling
      const noteTitle = node.name.replace(/\.md$/i, '');
      if (!isHistoryNavigation) {
        const newHistory = history.slice(0, historyIndex + 1);
        if (newHistory[newHistory.length - 1] !== noteTitle) {
          newHistory.push(noteTitle);
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
        }
      }
    } catch (err) {
      console.error("Failed to read file", err);
      setOriginalContent('');
      setDraftContent('파일을 읽을 수 없습니다.');
    }
  };

  // Debounced auto-save (Local: 800ms / GitHub: 3000ms to optimize rate limits)
  useEffect(() => {
    if (!selectedFile || draftContent === originalContent) {
      return;
    }

    const delay = vaultType === 'github' ? 3000 : 800;

    const timer = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const finalSaveContent = updateFrontmatterTime(draftContent);
        await writeNoteContent(selectedFile, finalSaveContent);
        
        const noteTitle = selectedFile.name.replace(/\.md$/i, '');
        const updatedMeta = parseMarkdownMetadata(finalSaveContent, selectedFile.name);

        setOriginalContent(finalSaveContent);
        setDraftContent(finalSaveContent);
        setMetadataMap(prev => ({ ...prev, [noteTitle]: updatedMeta }));
        setContentMap(prev => ({ ...prev, [noteTitle]: finalSaveContent }));
        setSaveStatus('saved');
        
        refreshFileTree();
      } catch (err: any) {
        console.error("Auto-save failed", err);
        setSaveStatus('error');
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [draftContent, selectedFile, originalContent, vaultType, githubConfig]);

  // Create a new note file with templates applied
  const createNewNote = async (targetName: string): Promise<FileNode | null> => {
    try {
      const cleanName = targetName.endsWith('.md') ? targetName : `${targetName}.md`;
      const title = targetName.replace(/\.md$/i, '');

      // Determine template content
      const customTemplate = await getCustomTemplateContent(dirHandle, vaultType!, githubConfig);
      let content = '';
      if (customTemplate) {
        content = applyCustomTemplate(customTemplate, title);
      } else {
        content = generateDefaultTemplate(title);
      }

      let newSha: string | null = null;
      if (vaultType === 'local') {
        const newFileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        if (!githubConfig || !githubConfig.token) {
          setGithubTokenRequested(true);
          throw new Error("읽기 전용 모드에서는 생성할 수 없습니다.");
        }
        
        const fullPath = githubConfig.path 
          ? `${githubConfig.path.replace(/\/$/, '')}/${cleanName}` 
          : cleanName;
          
        newSha = await writeGithubFileContent(
          githubConfig.owner,
          githubConfig.repo,
          fullPath,
          content,
          null,
          githubConfig.token,
          githubConfig.branch,
          `Create note: ${title}`
        );
      }

      const updatedTree = await refreshFileTree();
      
      // Update metadata map and content map for the new note
      const newMeta = parseMarkdownMetadata(content, cleanName);
      setMetadataMap(prev => ({ ...prev, [title]: newMeta }));
      setContentMap(prev => ({ ...prev, [title]: content }));

      // For remote files, inject sha reference after scan
      const newNode = findFileNodeByName(updatedTree, targetName);
      if (newNode && vaultType === 'github' && newSha) {
        newNode.handle = {
          ...newNode.handle,
          sha: newSha
        } as any;
      }

      return newNode;
    } catch (err) {
      console.error("Failed to create new note file", err);
      return null;
    }
  };

  // Create file triggered from Sidebar
  const handleCreateFile = async (name: string) => {
    const cleanName = name.endsWith('.md') ? name : `${name}.md`;
    const foundNode = findFileNodeByName(fileTree, cleanName);
    if (foundNode) {
      alert("이미 존재하는 노트 이름입니다.");
      return;
    }

    const newNode = await createNewNote(name);
    if (newNode) {
      await handleSelectFile(newNode);
    } else {
      alert("노트 생성에 실패했습니다.");
    }
  };

  // Wiki-link navigation and creation
  const handleWikiLinkClick = async (targetName: string) => {
    // Search for file
    const foundNode = findFileNodeByName(fileTree, targetName);
    if (foundNode) {
      await handleSelectFile(foundNode);
      return;
    }

    // If not found, create new markdown file in vault root directory using templates
    const newNode = await createNewNote(targetName);
    if (newNode) {
      await handleSelectFile(newNode);
    } else {
      alert(`새 노트를 생성할 수 없습니다: ${targetName}`);
    }
  };

  // Delete a note file
  const handleDeleteFile = async (node: FileNode) => {
    try {
      // 1. Remove file physically
      if (vaultType === 'local') {
        if ((node.handle as any).remove) {
          await (node.handle as any).remove();
        } else {
          await dirHandle.removeEntry(node.name);
        }
      } else {
        if (!githubConfig || !githubConfig.token) {
          setGithubTokenRequested(true);
          throw new Error("읽기 전용 모드에서는 삭제할 수 없습니다.");
        }
        
        const handle = node.handle as any;
        await deleteGithubFile(
          githubConfig.owner,
          githubConfig.repo,
          handle.fullPath,
          handle.sha,
          githubConfig.token,
          githubConfig.branch,
          `Delete note: ${node.name.replace('.md', '')}`
        );
      }

      // 2. Reset states if deleted file was selected
      const noteTitle = node.name.replace(/\.md$/i, '');
      if (selectedFile && selectedFile.path === node.path) {
        setSelectedFile(null);
        setOriginalContent('');
        setDraftContent('');
        setSaveStatus('idle');
      }

      // 3. Update cache maps
      setMetadataMap(prev => {
        const next = { ...prev };
        delete next[noteTitle];
        return next;
      });
      setContentMap(prev => {
        const next = { ...prev };
        delete next[noteTitle];
        return next;
      });

      // 4. Clean up navigation history stack
      setHistory(prev => {
        const next = prev.filter(t => t !== noteTitle);
        setHistoryIndex(prevIndex => {
          if (prevIndex >= next.length) return next.length - 1;
          return prevIndex;
        });
        return next;
      });

      // 5. Refresh tree
      await refreshFileTree();
    } catch (err) {
      console.error("Failed to delete note file", err);
      alert("노트 삭제 중 에러가 발생했습니다.");
    }
  };

  // Rename a note file and refactor all existing wiki-links pointing to it
  const handleRenameFile = async (node: FileNode, newName: string) => {
    const oldTitle = node.name.replace(/\.md$/i, '');
    const newTitle = newName.trim();
    const newFileName = `${newTitle}.md`;

    if (oldTitle.toLowerCase() === newTitle.toLowerCase()) {
      return;
    }

    const foundNode = findFileNodeByName(fileTree, newFileName);
    if (foundNode) {
      alert("이미 존재하는 노트 이름입니다.");
      return;
    }

    try {
      let content = '';
      if (selectedFile && selectedFile.path === node.path) {
        content = draftContent;
      } else {
        content = await readNoteContent(node);
      }

      let newSha: string | null = null;

      // 1. Write content to new entry
      if (vaultType === 'local') {
        const newFileHandle = await dirHandle.getFileHandle(newFileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        // Remove old file entry
        if ((node.handle as any).remove) {
          await (node.handle as any).remove();
        } else {
          await dirHandle.removeEntry(node.name);
        }
      } else {
        if (!githubConfig || !githubConfig.token) {
          setGithubTokenRequested(true);
          throw new Error("읽기 전용 모드에서는 이름 변경이 불가능합니다.");
        }
        
        const oldHandle = node.handle as any;
        const newFullPath = githubConfig.path 
          ? `${githubConfig.path.replace(/\/$/, '')}/${newFileName}` 
          : newFileName;

        // Create new remote file
        newSha = await writeGithubFileContent(
          githubConfig.owner,
          githubConfig.repo,
          newFullPath,
          content,
          null,
          githubConfig.token,
          githubConfig.branch,
          `Create note via rename: ${newTitle}`
        );

        // Delete old remote file
        await deleteGithubFile(
          githubConfig.owner,
          githubConfig.repo,
          oldHandle.fullPath,
          oldHandle.sha,
          githubConfig.token,
          githubConfig.branch,
          `Delete note via rename: ${oldTitle}`
        );
      }

      // 2. Link Refactoring: Update wiki-links [[Old]] -> [[New]] in all other files
      const nextContentMap = { ...contentMap };
      const nextMetaMap = { ...metadataMap };

      delete nextContentMap[oldTitle];
      delete nextMetaMap[oldTitle];

      nextContentMap[newTitle] = content;
      nextMetaMap[newTitle] = parseMarkdownMetadata(content, newFileName);

      // Search all other files and refactor links
      for (const title of Object.keys(nextContentMap)) {
        if (title === newTitle) continue;
        
        const oldBody = nextContentMap[title];
        const newBody = renameWikiLinksInText(oldBody, oldTitle, newTitle);

        if (oldBody !== newBody) {
          nextContentMap[title] = newBody;
          nextMetaMap[title] = parseMarkdownMetadata(newBody, `${title}.md`);

          // Write updated links back to disk / remote
          const targetNode = findFileNodeByName(fileTree, `${title}.md`);
          if (targetNode) {
            await writeNoteContent(targetNode, newBody);
          }
        }
      }

      setMetadataMap(nextMetaMap);
      setContentMap(nextContentMap);

      // Update history stack names
      setHistory(prev => prev.map(t => t === oldTitle ? newTitle : t));

      // 3. Refresh file tree
      const updatedTree = await refreshFileTree();

      // 4. Re-select note if renamed note was currently open
      if (selectedFile && selectedFile.path === node.path) {
        const renamedNode = findFileNodeByName(updatedTree, newFileName);
        if (renamedNode) {
          // Sync sha dynamically for github file node
          if (vaultType === 'github' && newSha) {
            renamedNode.handle = {
              ...renamedNode.handle,
              sha: newSha
            } as any;
          }
          setSelectedFile(renamedNode);
          setOriginalContent(content);
          setDraftContent(content);
        }
      }
    } catch (err) {
      console.error("Failed to rename note file and refactor links", err);
      alert("노트 이름 변경 중 에러가 발생했습니다.");
    }
  };

  // Navigate history stack
  const navigateHistory = async (direction: 'back' | 'forward') => {
    let nextIndex = historyIndex;
    if (direction === 'back' && historyIndex > 0) {
      nextIndex--;
    } else if (direction === 'forward' && historyIndex < history.length - 1) {
      nextIndex++;
    } else {
      return;
    }

    const targetTitle = history[nextIndex];
    const targetNode = findFileNodeByName(fileTree, `${targetTitle}.md`);
    if (targetNode) {
      setHistoryIndex(nextIndex);
      await handleSelectFile(targetNode, true);
    }
  };

  // Graph Node click navigation
  const handleGraphNodeClick = async (nodeId: string) => {
    const foundNode = findFileNodeByName(fileTree, nodeId);
    if (foundNode) {
      await handleSelectFile(foundNode);
    }
  };

  // Compute graph nodes & links dynamically from metadataMap
  const graphData = useMemo(() => {
    const nodes = Object.keys(metadataMap).map(title => ({
      id: title,
      title,
      type: metadataMap[title].type,
      val: 5
    }));

    const links: { source: string; target: string }[] = [];

    Object.keys(metadataMap).forEach(sourceTitle => {
      const meta = metadataMap[sourceTitle];
      meta.outLinks.forEach(targetTitle => {
        if (metadataMap[targetTitle]) {
          links.push({
            source: sourceTitle,
            target: targetTitle
          });
        }
      });
    });

    nodes.forEach(node => {
      const degree = links.filter(l => l.source === node.id || l.target === node.id).length;
      node.val = 5 + degree * 1.2;
    });

    return { nodes, links };
  }, [metadataMap]);

  // Derive search results dynamically from contentMap
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const results: { title: string; snippets: string[] }[] = [];

    Object.keys(contentMap).forEach(title => {
      const content = contentMap[title];
      const lowerTitle = title.toLowerCase();
      const snippets: string[] = [];

      if (lowerTitle.includes(query)) {
        snippets.push("제목에 키워드 포함");
      }

      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes(query)) {
          const isFmMeta = line.trim().startsWith('---') || 
                           line.includes('title:') || 
                           line.includes('created:') || 
                           line.includes('updated:') ||
                           line.includes('status:') ||
                           line.includes('type:');
          if (!isFmMeta && snippets.length < 3) {
            snippets.push(`L${idx + 1}: ${line.trim()}`);
          }
        }
      });

      if (snippets.length > 0) {
        results.push({
          title,
          snippets
        });
      }
    });

    return results;
  }, [searchQuery, contentMap]);

  // Manual save trigger via toolbar or Ctrl+S
  const handleManualSave = async () => {
    if (!selectedFile || draftContent === originalContent) return;
    setSaveStatus('saving');
    try {
      const finalSaveContent = updateFrontmatterTime(draftContent);
      await writeNoteContent(selectedFile, finalSaveContent);

      const noteTitle = selectedFile.name.replace(/\.md$/i, '');
      const updatedMeta = parseMarkdownMetadata(finalSaveContent, selectedFile.name);

      setOriginalContent(finalSaveContent);
      setDraftContent(finalSaveContent);
      setMetadataMap(prev => ({ ...prev, [noteTitle]: updatedMeta }));
      setContentMap(prev => ({ ...prev, [noteTitle]: finalSaveContent }));
      setSaveStatus('saved');
      
      refreshFileTree();
    } catch (err: any) {
      console.error("Manual save failed", err);
      setSaveStatus('error');
    }
  };

  // Bind Ctrl+S manually in the body content
  useEffect(() => {
    const handleGlobalSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handleGlobalSaveShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSaveShortcut);
  }, [draftContent, originalContent, selectedFile, vaultType]);

  // GitHub Connection Modal Component
  const GithubConnectModal = () => {
    const [owner, setOwner] = useState(githubConfig?.owner || '');
    const [repo, setRepo] = useState(githubConfig?.repo || '');
    const [branch, setBranch] = useState(githubConfig?.branch || 'main');
    const [path, setPath] = useState(githubConfig?.path || '');
    const [token, setToken] = useState(sessionStorage.getItem('gh_token') || '');

    const handleConnect = () => {
      if (!owner.trim() || !repo.trim()) {
        alert("계정명과 저장소 이름은 필수입니다.");
        return;
      }
      connectGithubVault({
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim() || 'main',
        path: path.trim(),
        token: token.trim() || null
      });
    };

    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50">
        <div className="bg-[#181818] border border-obsidian-border rounded-xl p-6 w-96 shadow-2xl flex flex-col gap-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-gray-200 border-b border-obsidian-border pb-3">
            <Network className="text-purple-400" size={18} />
            <span>GitHub 원격 저장소 연결</span>
          </div>

          <div className="flex flex-col gap-3.5 my-1">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">GitHub 계정명 (Owner) *</label>
              <input 
                type="text" 
                value={owner} 
                onChange={(e) => setOwner(e.target.value)} 
                placeholder="예: hanwo-ol" 
                className="bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
              />
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">저장소 이름 (Repository) *</label>
              <input 
                type="text" 
                value={repo} 
                onChange={(e) => setRepo(e.target.value)} 
                placeholder="예: paper_dict" 
                className="bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">브랜치 (Branch)</label>
                <input 
                  type="text" 
                  value={branch} 
                  onChange={(e) => setBranch(e.target.value)} 
                  placeholder="main" 
                  className="bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">대상 폴더 경로 (Path)</label>
                <input 
                  type="text" 
                  value={path} 
                  onChange={(e) => setPath(e.target.value)} 
                  placeholder="예: DICTIONARY (선택)" 
                  className="bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium flex items-center justify-between">
                <span>GitHub 개인 토큰 (Token)</span>
                <span className="text-[10px] text-gray-600">입력하지 않으면 읽기전용</span>
              </label>
              <input 
                type="password" 
                value={token} 
                onChange={(e) => setToken(e.target.value)} 
                placeholder="github_pat_..." 
                className="bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 text-xs font-medium pt-3 border-t border-obsidian-border">
            <button
              onClick={() => setShowGithubModal(false)}
              className="px-4 py-2 bg-obsidian-hover hover:bg-gray-700 border border-obsidian-border rounded text-gray-400 hover:text-white transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleConnect}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors"
            >
              연결하기
            </button>
          </div>
        </div>
      </div>
    );
  };

  // GitHub Access Token request prompt modal when write action requested in read-only mode
  const GithubTokenPromptModal = () => {
    const [token, setToken] = useState('');
    
    const handleSaveToken = () => {
      if (!token.trim()) return;
      if (githubConfig) {
        const nextConfig = {
          ...githubConfig,
          token: token.trim()
        };
        sessionStorage.setItem('gh_token', token.trim());
        setGithubConfig(nextConfig);
        setGithubTokenRequested(false);
        alert("토큰이 임시 저장되었습니다. 다시 저장을 시도해 주세요.");
      }
    };

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50">
        <div className="bg-[#181818] border border-obsidian-border rounded-xl p-5 w-80 shadow-2xl flex flex-col gap-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-gray-200 border-b border-obsidian-border pb-2">
            <Key className="text-yellow-400" size={16} />
            <span>GitHub 토큰 필요</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            원격 저장소에 수정한 내용을 커밋(저장)하거나 삭제하려면 개인 액세스 토큰(PAT)이 필요합니다.
          </p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_..."
            className="w-full bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
            autoFocus
          />
          <div className="flex justify-end gap-2 text-xs font-medium pt-2 border-t border-obsidian-border">
            <button
              onClick={() => setGithubTokenRequested(false)}
              className="px-3 py-1.5 bg-obsidian-hover hover:bg-gray-700 border border-obsidian-border rounded text-gray-400 hover:text-white transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSaveToken}
              className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded transition-colors"
            >
              토큰 등록
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Main intro dashboard for unmounted state
  if (vaultType === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-obsidian-bg text-obsidian-text">
        <div className="max-w-2xl w-full p-8 flex flex-col gap-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-200 tracking-wide uppercase">지식 사전 (Obsidian Clone)</h1>
            <p className="text-gray-500 text-sm mt-2">마크다운 양방향 링크를 통해 나만의 지식 우주를 구축하세요</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
            {/* Local Vault Option */}
            <div 
              onClick={handleOpenVault}
              className="bg-obsidian-sidebar border border-obsidian-border rounded-xl p-6 flex flex-col gap-3.5 cursor-pointer hover:border-gray-500 hover:bg-obsidian-hover transition-all shadow-xl group"
            >
              <div className="text-blue-400 group-hover:text-blue-300">
                <Folder size={32} />
              </div>
              <h3 className="font-semibold text-base text-gray-200">로컬 폴더 연동 (Local Vault)</h3>
              <p className="text-xs text-gray-500 leading-relaxed">컴퓨터 디바이스 내의 폴더 권한을 얻어 문서를 직접 읽고 씁니다.</p>
            </div>
            
            {/* GitHub Vault Option */}
            <div 
              onClick={() => setShowGithubModal(true)}
              className="bg-obsidian-sidebar border border-obsidian-border rounded-xl p-6 flex flex-col gap-3.5 cursor-pointer hover:border-gray-500 hover:bg-obsidian-hover transition-all shadow-xl group"
            >
              <div className="text-purple-400 group-hover:text-purple-300">
                <Network size={32} />
              </div>
              <h3 className="font-semibold text-base text-gray-200">GitHub 원격 연동 (GitHub Vault)</h3>
              <p className="text-xs text-gray-500 leading-relaxed">깃허브 저장소를 직접 연결하여 클라우드처럼 어디서나 필기하고 연동합니다.</p>
            </div>
          </div>
        </div>
        
        {/* Render GitHub Connection Modal */}
        {showGithubModal && <GithubConnectModal />}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden text-obsidian-text">
      <Sidebar 
        vaultName={vaultName} 
        fileTree={fileTree} 
        onOpenVault={handleOpenVault}
        onSelectFile={handleSelectFile}
        selectedFile={selectedFile}
        onCreateFile={handleCreateFile}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onSearchResultClick={handleWikiLinkClick}
        onRenameFile={handleRenameFile}
        onDeleteFile={handleDeleteFile}
      />

      {/* Main Editor Area */}
      <main className="flex-1 bg-obsidian-bg flex flex-col min-w-0">
        {!selectedFile ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 relative">
            {/* Dashboard backtrack button */}
            <button 
              onClick={() => setVaultType(null)} 
              className="absolute top-4 right-4 px-3 py-1.5 bg-obsidian-sidebar border border-obsidian-border rounded text-xs text-gray-400 hover:text-white transition-colors"
            >
              메인 대시보드로 가기
            </button>
            <svg className="w-16 h-16 mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>좌측에서 마크다운 파일을 선택해 주세요.</p>
          </div>
        ) : (
          <Editor
            selectedFile={selectedFile}
            value={draftContent}
            onChange={setDraftContent}
            saveStatus={saveStatus}
            onWikiLinkClick={handleWikiLinkClick}
            graphData={graphData}
            onGraphNodeClick={handleGraphNodeClick}
            
            // History navigation props
            canGoBack={historyIndex > 0}
            canGoForward={historyIndex < history.length - 1}
            onGoBack={() => navigateHistory('back')}
            onGoForward={() => navigateHistory('forward')}
          />
        )}
      </main>

      {/* GitHub Token Prompt Modal if needed */}
      {githubTokenRequested && <GithubTokenPromptModal />}
    </div>
  );
}

export default App;

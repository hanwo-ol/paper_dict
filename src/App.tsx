import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { readDirectoryRecursive, readFileContent, writeFileContent } from './utils/fileSystem';
import { parseMarkdownMetadata } from './utils/parser';
import type { FileNode } from './utils/fileSystem';
import type { FileMetadata } from './utils/parser';

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
const getCustomTemplateContent = async (rootHandle: any): Promise<string | null> => {
  try {
    const templatesDir = await rootHandle.getDirectoryHandle('.templates');
    const templateFile = await templatesDir.getFileHandle('default-template.md');
    const file = await templateFile.getFile();
    return await file.text();
  } catch (e) {
    return null;
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
    // Append updated field right before the closing ---
    updatedFm = fmContent.trim() + `\nupdated: ${nowStr}\n`;
  }
  
  return content.replace(fmMatch[1], updatedFm);
};

function App() {
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
          const content = await readFileContent(node.handle);
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
      setDirHandle(handle);
      setVaultName(handle.name);
      
      const nodes = await readDirectoryRecursive(handle);
      setFileTree(nodes);
      setSelectedFile(null);
      setOriginalContent('');
      setDraftContent('');
      setSaveStatus('idle');

      // Reset history on vault switch
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

  const refreshFileTree = async (rootHandle: any) => {
    if (!rootHandle) return [];
    const nodes = await readDirectoryRecursive(rootHandle);
    setFileTree(nodes);
    return nodes;
  };

  const handleSelectFile = async (node: FileNode, isHistoryNavigation: boolean = false) => {
    // 1. Unsaved check before switching
    if (selectedFile && draftContent !== originalContent) {
      try {
        const finalSaveContent = updateFrontmatterTime(draftContent);
        await writeFileContent(selectedFile.handle, finalSaveContent);
        
        // Update metadata and contents of the previously active file upon switching
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
      const content = await readFileContent(node.handle);
      setOriginalContent(content);
      setDraftContent(content);

      // 3. History stack handling
      const noteTitle = node.name.replace(/\.md$/i, '');
      if (!isHistoryNavigation) {
        // Cut off forward history records and push new note
        const newHistory = history.slice(0, historyIndex + 1);
        
        // Avoid pushing the same note consecutively
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

  // Debounced auto-save (includes updated frontmatter time auto-updates)
  useEffect(() => {
    if (!selectedFile || draftContent === originalContent) {
      return;
    }

    // Timer setup
    const timer = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        // Automatically inject updated timestamp to frontmatter before saving
        const finalSaveContent = updateFrontmatterTime(draftContent);
        await writeFileContent(selectedFile.handle, finalSaveContent);
        
        const noteTitle = selectedFile.name.replace(/\.md$/i, '');
        const updatedMeta = parseMarkdownMetadata(finalSaveContent, selectedFile.name);

        setOriginalContent(finalSaveContent);
        setDraftContent(finalSaveContent); // align editor state silently
        setMetadataMap(prev => ({ ...prev, [noteTitle]: updatedMeta }));
        setContentMap(prev => ({ ...prev, [noteTitle]: finalSaveContent }));
        setSaveStatus('saved');
        
        // Refresh file tree in background to update sizes if needed (silent)
        refreshFileTree(dirHandle);
      } catch (err) {
        console.error("Auto-save failed", err);
        setSaveStatus('error');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [draftContent, selectedFile, originalContent, dirHandle]);

  // Create a new note file with templates applied
  const createNewNote = async (targetName: string): Promise<FileNode | null> => {
    if (!dirHandle) return null;

    try {
      const cleanName = targetName.endsWith('.md') ? targetName : `${targetName}.md`;
      const title = targetName.replace(/\.md$/i, '');
      const newFileHandle = await dirHandle.getFileHandle(cleanName, { create: true });

      // Determine template content
      const customTemplate = await getCustomTemplateContent(dirHandle);
      let content = '';
      if (customTemplate) {
        content = applyCustomTemplate(customTemplate, title);
      } else {
        content = generateDefaultTemplate(title);
      }

      const writable = await newFileHandle.createWritable();
      await writable.write(content);
      await writable.close();

      const updatedTree = await refreshFileTree(dirHandle);
      
      // Update metadata map and content map for the new note
      const newMeta = parseMarkdownMetadata(content, cleanName);
      setMetadataMap(prev => ({ ...prev, [title]: newMeta }));
      setContentMap(prev => ({ ...prev, [title]: content }));

      return findFileNodeByName(updatedTree, targetName);
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
    if (!dirHandle) return;

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
    if (!dirHandle) return;
    try {
      // 1. Remove file physically
      if ((node.handle as any).remove) {
        await (node.handle as any).remove();
      } else {
        await dirHandle.removeEntry(node.name);
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
      await refreshFileTree(dirHandle);
    } catch (err) {
      console.error("Failed to delete note file", err);
      alert("노트 삭제 중 에러가 발생했습니다.");
    }
  };

  // Rename a note file and refactor all existing wiki-links pointing to it
  const handleRenameFile = async (node: FileNode, newName: string) => {
    if (!dirHandle) return;
    
    const oldTitle = node.name.replace(/\.md$/i, '');
    const newTitle = newName.trim();
    const newFileName = `${newTitle}.md`;

    if (oldTitle.toLowerCase() === newTitle.toLowerCase()) {
      return; // No change or case-only change (avoid conflicts)
    }

    const foundNode = findFileNodeByName(fileTree, newFileName);
    if (foundNode) {
      alert("이미 존재하는 노트 이름입니다.");
      return;
    }

    try {
      // 1. Create new file entry
      const newFileHandle = await dirHandle.getFileHandle(newFileName, { create: true });
      
      // 2. Fetch current content (prioritize editor draft if renamed node is currently open)
      let content = '';
      if (selectedFile && selectedFile.path === node.path) {
        content = draftContent;
      } else {
        content = await readFileContent(node.handle);
      }

      // 3. Write content to new file
      const writable = await newFileHandle.createWritable();
      await writable.write(content);
      await writable.close();

      // 4. Remove old file entry
      if ((node.handle as any).remove) {
        await (node.handle as any).remove();
      } else {
        await dirHandle.removeEntry(node.name);
      }

      // 5. Link Refactoring: Update wiki-links [[Old]] -> [[New]] in all other files
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

          // Write updated links back to disk
          const targetNode = findFileNodeByName(fileTree, `${title}.md`);
          if (targetNode) {
            await writeFileContent(targetNode.handle, newBody);
          }
        }
      }

      setMetadataMap(nextMetaMap);
      setContentMap(nextContentMap);

      // Update history stack names
      setHistory(prev => prev.map(t => t === oldTitle ? newTitle : t));

      // 6. Refresh file tree
      const updatedTree = await refreshFileTree(dirHandle);

      // 7. Re-select note if renamed note was currently open
      if (selectedFile && selectedFile.path === node.path) {
        const renamedNode = findFileNodeByName(updatedTree, newFileName);
        if (renamedNode) {
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
      return; // Cannot navigate
    }

    const targetTitle = history[nextIndex];
    const targetNode = findFileNodeByName(fileTree, `${targetTitle}.md`);
    if (targetNode) {
      setHistoryIndex(nextIndex);
      await handleSelectFile(targetNode, true); // true bypasses normal history pushes
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
      val: 5 // Default size, will be weighted below
    }));

    const links: { source: string; target: string }[] = [];

    Object.keys(metadataMap).forEach(sourceTitle => {
      const meta = metadataMap[sourceTitle];
      meta.outLinks.forEach(targetTitle => {
        // Draw edge only if the target note exists in the metadata map (vault)
        if (metadataMap[targetTitle]) {
          links.push({
            source: sourceTitle,
            target: targetTitle
          });
        }
      });
    });

    // Calculate node weights (degree-based sizing)
    nodes.forEach(node => {
      const degree = links.filter(l => l.source === node.id || l.target === node.id).length;
      node.val = 5 + degree * 1.2; // Premium sizing logic
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

      // Check title match
      if (lowerTitle.includes(query)) {
        snippets.push("제목에 키워드 포함");
      }

      // Check content match line by line
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes(query)) {
          // Skip frontmatter tags, titles, dates to keep search results clean
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
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
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
    </div>
  );
}

export default App;

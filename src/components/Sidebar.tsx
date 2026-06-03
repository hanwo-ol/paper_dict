import type { FileNode } from '../utils/fileSystem';
import { ChevronRight, ChevronDown, FileText, Folder, Plus, Search, X, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface SidebarProps {
  vaultName: string | null;
  fileTree: FileNode[];
  onOpenVault: () => void;
  onSelectFile: (file: FileNode) => void;
  selectedFile: FileNode | null;
  onCreateFile?: (name: string) => void;
  onRenameFile?: (file: FileNode, newName: string) => Promise<void>;
  onDeleteFile?: (file: FileNode) => Promise<void>;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchResults?: { title: string; snippets: string[] }[];
  onSearchResultClick?: (title: string) => void;
}

const FileTreeNode = ({ 
  node, 
  level, 
  onSelectFile, 
  selectedFile,
  onRenameClick,
  onDeleteClick
}: { 
  node: FileNode, 
  level: number, 
  onSelectFile: (f: FileNode) => void, 
  selectedFile: FileNode | null,
  onRenameClick: (node: FileNode) => void,
  onDeleteClick: (node: FileNode) => void
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isSelected = selectedFile?.path === node.path;
  
  if (node.kind === 'directory') {
    return (
      <div>
        <div 
          className={`flex items-center py-1 px-2 cursor-pointer hover:bg-obsidian-hover text-sm text-gray-300 transition-colors ${isSelected ? 'bg-obsidian-hover font-medium text-white' : ''}`}
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <ChevronDown size={14} className="mr-1 opacity-70" /> : <ChevronRight size={14} className="mr-1 opacity-70" />}
          <Folder size={14} className="mr-2 text-blue-400 opacity-80" />
          <span className="truncate">{node.name}</span>
        </div>
        {isOpen && node.children?.map(child => (
          <FileTreeNode 
            key={child.path} 
            node={child} 
            level={level + 1} 
            onSelectFile={onSelectFile} 
            selectedFile={selectedFile} 
            onRenameClick={onRenameClick}
            onDeleteClick={onDeleteClick}
          />
        ))}
      </div>
    );
  }

  return (
    <div 
      className={`group flex items-center justify-between py-1 px-2 cursor-pointer hover:bg-obsidian-hover text-sm transition-colors ${isSelected ? 'bg-obsidian-hover font-medium text-white' : 'text-gray-400'}`}
      style={{ paddingLeft: `${level * 12 + 24}px`, paddingRight: '8px' }}
      onClick={() => onSelectFile(node)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center min-w-0 flex-1">
        <FileText size={14} className="mr-2 opacity-60 flex-shrink-0" />
        <span className="truncate">{node.name.replace('.md', '')}</span>
      </div>
      
      {isHovered && (
        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRenameClick(node);
            }}
            className="p-0.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200 transition-colors"
            title="이름 변경"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(node);
            }}
            className="p-0.5 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400 transition-colors"
            title="삭제"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
};

export function Sidebar({ 
  vaultName, 
  fileTree, 
  onOpenVault, 
  onSelectFile, 
  selectedFile, 
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  searchQuery = '',
  onSearchQueryChange,
  searchResults = [],
  onSearchResultClick
}: SidebarProps) {
  // Modal dialog states
  const [modalType, setModalType] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [modalInputValue, setModalInputValue] = useState('');
  const [activeNode, setActiveNode] = useState<FileNode | null>(null);

  const openCreateModal = () => {
    setModalInputValue('');
    setModalType('create');
  };

  const openRenameModal = (node: FileNode) => {
    setActiveNode(node);
    setModalInputValue(node.name.replace('.md', ''));
    setModalType('rename');
  };

  const openDeleteModal = (node: FileNode) => {
    setActiveNode(node);
    setModalType('delete');
  };

  const closeModal = () => {
    setModalType(null);
    setModalInputValue('');
    setActiveNode(null);
  };

  const isSearching = searchQuery.trim() !== '';

  // Custom Modal dialog component
  const CustomModal = () => {
    if (modalType === null) return null;
    
    const isDelete = modalType === 'delete';
    const headerTitle = isDelete 
      ? '노트 삭제' 
      : (modalType === 'create' ? '새 노트 생성' : '노트 이름 변경');
      
    const placeholderText = modalType === 'create' 
      ? '노트 제목을 입력하세요' 
      : '새 이름을 입력하세요';

    const handleConfirm = () => {
      if (isDelete) {
        if (activeNode && onDeleteFile) {
          onDeleteFile(activeNode);
        }
      } else {
        if (!modalInputValue.trim()) return;
        if (modalType === 'create' && onCreateFile) {
          onCreateFile(modalInputValue.trim());
        } else if (modalType === 'rename' && activeNode && onRenameFile) {
          onRenameFile(activeNode, modalInputValue.trim());
        }
      }
      closeModal();
    };

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50">
        <div 
          className="bg-[#181818] border border-obsidian-border rounded-lg p-5 w-80 shadow-2xl flex flex-col gap-4 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="font-semibold text-gray-200 border-b border-obsidian-border pb-2">
            {headerTitle}
          </div>
          
          {isDelete ? (
            <p className="text-xs text-gray-400 leading-relaxed">
              정말로 <span className="text-red-400 font-semibold">{activeNode?.name.replace('.md', '')}</span> 노트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>
          ) : (
            <input
              type="text"
              value={modalInputValue}
              onChange={(e) => setModalInputValue(e.target.value)}
              placeholder={placeholderText}
              className="w-full bg-obsidian-bg border border-obsidian-border rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-gray-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') closeModal();
              }}
            />
          )}
          
          <div className="flex justify-end gap-2 text-xs font-medium pt-2">
            <button
              onClick={closeModal}
              className="px-3 py-1.5 bg-obsidian-hover hover:bg-gray-700 border border-obsidian-border rounded text-gray-400 hover:text-white transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleConfirm}
              className={`px-3 py-1.5 rounded text-white transition-colors ${
                isDelete 
                  ? 'bg-red-600 hover:bg-red-500' 
                  : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              확인
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="w-64 bg-obsidian-sidebar border-r border-obsidian-border flex flex-col h-full flex-shrink-0">
      {/* Sidebar Header */}
      <div className="p-3 border-b border-obsidian-border flex items-center justify-between shadow-sm">
        <h1 className="font-semibold truncate text-sm tracking-wide text-gray-200">
          {vaultName || 'OBSIDIAN CLONE'}
        </h1>
        <div className="flex items-center gap-1.5">
          {vaultName && (
            <button 
              onClick={openCreateModal}
              className="p-1 bg-obsidian-hover border border-obsidian-border rounded hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              title="새 노트 생성"
            >
              <Plus size={14} />
            </button>
          )}
          <button 
            onClick={onOpenVault}
            className="text-xs px-2 py-1 bg-obsidian-hover border border-obsidian-border rounded hover:bg-gray-700 transition-colors"
          >
            Open
          </button>
        </div>
      </div>

      {/* Search Input Box */}
      {vaultName && onSearchQueryChange && (
        <div className="p-2.5 border-b border-obsidian-border">
          <div className="relative flex items-center bg-obsidian-bg border border-obsidian-border rounded-md px-2 py-1 transition-all focus-within:border-gray-500">
            <Search size={14} className="text-gray-500 mr-2 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="문서 검색..."
              className="bg-transparent text-xs text-gray-200 outline-none w-full placeholder:text-gray-600"
            />
            {searchQuery && (
              <button 
                onClick={() => onSearchQueryChange('')}
                className="text-gray-500 hover:text-gray-300 flex-shrink-0"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* File Tree / Search Results Area */}
      <div className="flex-1 overflow-y-auto py-2">
        {!vaultName ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-sm text-gray-500 px-4">
            <p className="mb-4">폴더를 선택하여 노트를 불러오세요</p>
          </div>
        ) : isSearching ? (
          /* Search Results View */
          <div className="px-2">
            <h3 className="text-[10px] uppercase font-bold text-gray-500 px-2 mb-2 tracking-wider">검색 결과 ({searchResults.length})</h3>
            {searchResults.map((result) => (
              <div 
                key={result.title}
                onClick={() => onSearchResultClick && onSearchResultClick(result.title)}
                className="p-2 mb-1.5 rounded hover:bg-obsidian-hover cursor-pointer border border-transparent hover:border-obsidian-border transition-all"
              >
                <div className="flex items-center text-xs font-medium text-gray-200 truncate">
                  <FileText size={12} className="mr-1.5 text-blue-400 opacity-80" />
                  {result.title}
                </div>
                {result.snippets.map((snippet, sIdx) => (
                  <div 
                    key={sIdx}
                    className="text-[10px] text-gray-500 mt-1 pl-4 truncate leading-tight font-mono"
                    title={snippet}
                  >
                    {snippet}
                  </div>
                ))}
              </div>
            ))}
            {searchResults.length === 0 && (
              <div className="text-center text-xs text-gray-600 mt-8">
                일치하는 검색 결과가 없습니다.
              </div>
            )}
          </div>
        ) : (
          /* Regular File Tree View */
          <div>
            {fileTree.map(node => (
              <FileTreeNode 
                key={node.path} 
                node={node} 
                level={0} 
                onSelectFile={onSelectFile}
                selectedFile={selectedFile}
                onRenameClick={openRenameModal}
                onDeleteClick={openDeleteModal}
              />
            ))}
            {fileTree.length === 0 && (
              <div className="text-center text-sm text-gray-500 mt-4">
                마크다운(.md) 파일이 없습니다.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Render Custom Dialog Modal */}
      <CustomModal />
    </aside>
  );
}

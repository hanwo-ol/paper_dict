import { useState, useMemo, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileNode } from '../utils/fileSystem';
import { 
  Eye, Edit3, Columns, Check, Loader2, AlertCircle, Network, 
  ChevronLeft, ChevronRight, Bold, Italic, Link, Code, Quote,
  ChevronDown, ChevronUp, Calendar, Clock, Tag, Layers, Bookmark, Info
} from 'lucide-react';
import { GraphView } from './GraphView';
import { parseFrontmatter } from '../utils/parser';

interface EditorProps {
  selectedFile: FileNode;
  value: string;
  onChange: (val: string) => void;
  saveStatus: 'saved' | 'saving' | 'error' | 'idle';
  onWikiLinkClick?: (targetName: string) => void;
  graphData: {
    nodes: any[];
    links: any[];
  };
  onGraphNodeClick?: (nodeId: string) => void;
  
  // History navigation props
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
}

type ViewMode = 'edit' | 'preview' | 'split' | 'graph';
type RightPaneMode = 'preview' | 'graph';

// Component to render parsed frontmatter metadata
function MetadataPanel({ data }: { data: Record<string, any> }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const keys = Object.keys(data).filter(k => k !== 'title' && k !== 'outLinks');
  if (keys.length === 0) return null;

  // Helper to format field value
  const renderValue = (key: string, val: any) => {
    if (key === 'tags' && Array.isArray(val)) {
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((tag, idx) => (
            <span key={idx} className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full text-xs font-mono">
              #{tag}
            </span>
          ))}
        </div>
      );
    }
    if (key === 'aliases' && Array.isArray(val)) {
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((alias, idx) => (
            <span key={idx} className="bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-md text-xs font-mono">
              {alias}
            </span>
          ))}
        </div>
      );
    }
    if (Array.isArray(val)) {
      return val.join(', ');
    }
    return String(val);
  };

  // Helper to get field icon
  const getFieldIcon = (key: string) => {
    switch (key.toLowerCase()) {
      case 'created':
        return <Calendar size={13} className="text-gray-400" />;
      case 'updated':
        return <Clock size={13} className="text-gray-400" />;
      case 'tags':
        return <Tag size={13} className="text-purple-450" />;
      case 'aliases':
        return <Layers size={13} className="text-blue-400" />;
      case 'status':
        return <Info size={13} className="text-yellow-450" />;
      default:
        return <Bookmark size={13} className="text-gray-400" />;
    }
  };

  return (
    <div className="mb-6 border border-obsidian-border rounded-xl bg-obsidian-sidebar/20 overflow-hidden transition-all shadow-sm">
      {/* Header Toggle */}
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-gray-405 hover:text-gray-200 hover:bg-obsidian-hover/40 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <Info size={14} className="text-gray-400" />
          <span>노트 메타데이터 ({keys.length}개 필드)</span>
          {/* Quick preview of tags if collapsed */}
          {!isExpanded && data.tags && Array.isArray(data.tags) && data.tags.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 ml-2">
              {data.tags.slice(0, 3).map((t: string, i: number) => (
                <span key={i} className="text-[10px] bg-purple-500/5 text-purple-400/80 px-1.5 py-0.2 rounded border border-purple-500/10">
                  #{t}
                </span>
              ))}
              {data.tags.length > 3 && <span className="text-[10px] text-gray-500">...</span>}
            </div>
          )}
        </div>
        <div className="text-gray-500 hover:text-gray-300">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded Fields */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1.5 border-t border-obsidian-border bg-obsidian-sidebar/10 flex flex-col gap-2 text-xs">
          <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 items-center">
            {keys.map((key) => (
              <Fragment key={key}>
                <div className="flex items-center gap-2 text-gray-400 font-medium capitalize">
                  {getFieldIcon(key)}
                  <span>{key}</span>
                </div>
                <div className="text-gray-300 font-mono">
                  {renderValue(key, data[key])}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Editor({ 
  selectedFile, 
  value, 
  onChange, 
  saveStatus, 
  onWikiLinkClick,
  graphData,
  onGraphNodeClick,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward
}: EditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('preview');

  // Split frontmatter and body content
  const { frontmatter, bodyContentOnly } = useMemo(() => {
    const fmMatch = value.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      try {
        const parsed = parseFrontmatter(fmMatch[1]);
        const body = value.substring(fmMatch[0].length);
        return { frontmatter: parsed, bodyContentOnly: body };
      } catch (e) {
        console.error("Failed to parse YAML frontmatter in preview", e);
      }
    }
    return { frontmatter: null, bodyContentOnly: value };
  }, [value]);
  
  // Transform Wiki-links [[Note Name]] or [[Note Name|Alias]] into custom markdown links
  const transformWikiLinks = (text: string): string => {
    return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
      const display = alias ? alias : target;
      return `[${display}](wiki://${encodeURIComponent(target.trim())})`;
    });
  };

  // Convert content for preview
  const previewContent = useMemo(() => transformWikiLinks(bodyContentOnly), [bodyContentOnly]);

  // Custom renderer for ReactMarkdown components
  const markdownComponents = {
    a: ({ href, children, ...props }: any) => {
      if (href && href.startsWith('wiki://')) {
        const targetName = decodeURIComponent(href.replace('wiki://', ''));
        // Check if the target note actually exists in the vault nodes
        const nodeExists = graphData.nodes.some(n => n.id.toLowerCase() === targetName.toLowerCase());
        
        return (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (onWikiLinkClick) {
                onWikiLinkClick(targetName);
              }
            }}
            className={nodeExists 
              ? "text-blue-400 hover:underline cursor-pointer border-b border-dashed border-blue-400" 
              : "text-gray-500 hover:text-gray-300 cursor-pointer border-b border-dotted border-gray-600 opacity-80"}
            title={nodeExists ? targetName : `${targetName} (존재하지 않는 노트 - 클릭하여 생성)`}
            {...props}
          >
            {children}
          </a>
        );
      }
      return (
        <a 
          href={href} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-400 hover:underline"
          {...props}
        >
          {children}
        </a>
      );
    }
  };

  // Status Indicator Component
  const StatusIndicator = () => {
    switch (saveStatus) {
      case 'saving':
        return (
          <div className="flex items-center text-xs text-blue-400 gap-1 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
            <Loader2 size={12} className="animate-spin" />
            <span>저장 중...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center text-xs text-green-400 gap-1 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
            <Check size={12} />
            <span>저장됨</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center text-xs text-red-400 gap-1 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20">
            <AlertCircle size={12} />
            <span>저장 실패</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center text-xs text-gray-400 gap-1 bg-gray-500/10 px-2.5 py-1 rounded-full border border-gray-500/20">
            <span>수정 중</span>
          </div>
        );
    }
  };

  // Common text formatting utility
  const insertFormatting = (type: 'bold' | 'italic' | 'link' | 'code' | 'quote') => {
    const textarea = document.querySelector('textarea');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    let replacement = '';
    switch (type) {
      case 'bold':
        replacement = `**${selectedText || '텍스트'}**`;
        break;
      case 'italic':
        replacement = `*${selectedText || '텍스트'}*`;
        break;
      case 'link':
        replacement = `[${selectedText || '텍스트'}](https://)`;
        break;
      case 'code':
        replacement = `\`\`\`\n${selectedText || '코드'}\n\`\`\``;
        break;
      case 'quote':
        replacement = `\n> ${selectedText || '인용구'}\n`;
        break;
    }

    const newValue = text.substring(0, start) + replacement + text.substring(end);
    onChange(newValue);

    // Refocus and place selection range back
    setTimeout(() => {
      textarea.focus();
      const offset = replacement.indexOf(selectedText || '');
      if (!selectedText) {
        // Highlight the default placeholder text inside markup
        const placeholderText = type === 'bold' ? '텍스트' : (type === 'italic' ? '텍스트' : (type === 'link' ? '텍스트' : (type === 'code' ? '코드' : '인용구')));
        textarea.setSelectionRange(start + offset, start + offset + placeholderText.length);
      } else {
        textarea.setSelectionRange(start + offset, start + offset + selectedText.length);
      }
    }, 0);
  };

  // Keyboard shortcut handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        insertFormatting('bold');
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        insertFormatting('italic');
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        insertFormatting('link');
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-bg min-w-0">
      {/* Editor Header / Toolbar */}
      <div className="px-6 py-3 border-b border-obsidian-border flex items-center justify-between shadow-sm bg-obsidian-bg flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* History Navigation Buttons */}
          <div className="flex items-center gap-0.5 mr-2 flex-shrink-0">
            <button
              onClick={onGoBack}
              disabled={!canGoBack}
              className={`p-1 rounded hover:bg-obsidian-hover transition-colors ${canGoBack ? 'text-gray-300 hover:text-white' : 'text-gray-650 cursor-not-allowed opacity-30'}`}
              title="뒤로 가기"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={onGoForward}
              disabled={!canGoForward}
              className={`p-1 rounded hover:bg-obsidian-hover transition-colors ${canGoForward ? 'text-gray-300 hover:text-white' : 'text-gray-650 cursor-not-allowed opacity-30'}`}
              title="앞으로 가기"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <h2 className="text-base font-medium text-gray-200 truncate">
            {selectedFile.name.replace('.md', '')}
          </h2>
          <StatusIndicator />
        </div>
        
        {/* View Mode Switcher */}
        <div className="flex bg-obsidian-sidebar border border-obsidian-border rounded-lg p-0.5 shadow-inner">
          <button
            onClick={() => setViewMode('edit')}
            className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              viewMode === 'edit' 
                ? 'bg-obsidian-hover text-white shadow-sm' 
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Edit Mode"
          >
            <Edit3 size={14} />
            <span className="hidden sm:inline">편집</span>
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              viewMode === 'preview' 
                ? 'bg-obsidian-hover text-white shadow-sm' 
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Preview Mode"
          >
            <Eye size={14} />
            <span className="hidden sm:inline">미리보기</span>
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              viewMode === 'split' 
                ? 'bg-obsidian-hover text-white shadow-sm' 
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Split Mode"
          >
            <Columns size={14} />
            <span className="hidden sm:inline">분할</span>
          </button>
          <button
            onClick={() => setViewMode('graph')}
            className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              viewMode === 'graph' 
                ? 'bg-obsidian-hover text-white shadow-sm' 
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title="Graph Mode"
          >
            <Network size={14} />
            <span className="hidden sm:inline">그래프</span>
          </button>
        </div>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Full Graph Mode */}
        {viewMode === 'graph' && (
          <GraphView 
            data={graphData} 
            selectedNodeId={selectedFile.name.replace('.md', '')}
            onNodeClick={onGraphNodeClick || (() => {})}
          />
        )}

        {/* Left: Raw Text Area (Visible in Edit & Split) */}
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className={`h-full flex flex-col min-w-0 ${viewMode === 'split' ? 'w-1/2 border-r border-obsidian-border' : 'w-full'}`}>
            {/* Formatting Toolbar */}
            <div className="px-6 py-1.5 border-b border-obsidian-border bg-obsidian-bg flex items-center gap-2 flex-shrink-0 select-none">
              <button
                onClick={() => insertFormatting('bold')}
                className="p-1 hover:bg-obsidian-hover rounded text-gray-400 hover:text-white transition-colors"
                title="굵게 (Ctrl+B)"
              >
                <Bold size={14} />
              </button>
              <button
                onClick={() => insertFormatting('italic')}
                className="p-1 hover:bg-obsidian-hover rounded text-gray-400 hover:text-white transition-colors"
                title="기울임 (Ctrl+I)"
              >
                <Italic size={14} />
              </button>
              <button
                onClick={() => insertFormatting('link')}
                className="p-1 hover:bg-obsidian-hover rounded text-gray-400 hover:text-white transition-colors"
                title="링크 삽입 (Ctrl+K)"
              >
                <Link size={14} />
              </button>
              <button
                onClick={() => insertFormatting('code')}
                className="p-1 hover:bg-obsidian-hover rounded text-gray-400 hover:text-white transition-colors"
                title="코드 블록"
              >
                <Code size={14} />
              </button>
              <button
                onClick={() => insertFormatting('quote')}
                className="p-1 hover:bg-obsidian-hover rounded text-gray-400 hover:text-white transition-colors"
                title="인용구"
              >
                <Quote size={14} />
              </button>
            </div>

            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 w-full h-full p-6 bg-obsidian-bg text-obsidian-text font-mono text-[14px] leading-relaxed resize-none focus:outline-none overflow-y-auto selection:bg-blue-500/20"
              placeholder="여기에 마크다운 문서를 입력하세요..."
              autoFocus
            />
          </div>
        )}

        {/* Right Pane (Visible in Preview & Split) */}
        {viewMode === 'preview' && (
          <div className="h-full overflow-y-auto p-6 min-w-0 bg-obsidian-bg w-full">
            <div className="markdown-preview max-w-3xl mx-auto">
              {frontmatter && <MetadataPanel data={frontmatter} />}
              {previewContent.trim() ? (
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {previewContent}
                </ReactMarkdown>
              ) : (
                <p className="text-gray-600 italic select-none">작성된 내용이 없습니다.</p>
              )}
            </div>
          </div>
        )}

        {/* Split Right Pane with Preview / Graph toggle */}
        {viewMode === 'split' && (
          <div className="h-full flex flex-col min-w-0 w-1/2 bg-obsidian-bg">
            {/* Split right header for toggling between preview and graph */}
            <div className="px-4 py-1.5 border-b border-obsidian-border bg-obsidian-bg flex items-center justify-end gap-1 flex-shrink-0">
              <button
                onClick={() => setRightPaneMode('preview')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  rightPaneMode === 'preview' 
                    ? 'bg-obsidian-hover text-white' 
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                미리보기
              </button>
              <button
                onClick={() => setRightPaneMode('graph')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  rightPaneMode === 'graph' 
                    ? 'bg-obsidian-hover text-white' 
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                그래프
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {rightPaneMode === 'preview' ? (
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="markdown-preview">
                    {frontmatter && <MetadataPanel data={frontmatter} />}
                    {previewContent.trim() ? (
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {previewContent}
                      </ReactMarkdown>
                    ) : (
                      <p className="text-gray-600 italic select-none">작성된 내용이 없습니다.</p>
                    )}
                  </div>
                </div>
              ) : (
                <GraphView 
                  data={graphData} 
                  selectedNodeId={selectedFile.name.replace('.md', '')}
                  onNodeClick={onGraphNodeClick || (() => {})}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

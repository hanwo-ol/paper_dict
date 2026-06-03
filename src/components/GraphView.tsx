import { useRef, useEffect, useMemo, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface GraphNode {
  id: string;
  title: string;
  type: string;
  color?: string;
  val?: number; // Used for node size based on degree
  isSelected?: boolean;
}

interface GraphLink {
  source: string | any;
  target: string | any;
}

interface GraphViewProps {
  data: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
}

// Colors based on document type
const getTypeColor = (type: string, isSelected: boolean) => {
  if (isSelected) return '#58a6ff'; // Accent blue for selected node
  
  switch (type) {
    case 'concept':
      return '#a3b8cc'; // Silver/Gray for concepts
    case 'project':
      return '#85e89d'; // Green for projects
    case 'daily':
      return '#ffab70'; // Orange for daily logs
    case 'resource':
      return '#f97583'; // Red/Pink for resources
    default:
      return '#79b8ff'; // Default blue
  }
};

export function GraphView({ data, selectedNodeId, onNodeClick }: GraphViewProps) {
  const fgRef = useRef<any>(null);
  const [hoverNode, setHoverNode] = useState<any | null>(null);

  // Prepare nodes and links with visualization properties, cloning to prevent D3 mutations from leaking
  const graphData = useMemo(() => {
    const nodesCloned = data.nodes.map(node => {
      const isSelected = selectedNodeId === node.id;
      return {
        ...node,
        color: getTypeColor(node.type, isSelected),
        isSelected,
        val: node.val || 5
      };
    });

    const linksCloned = data.links.map(link => {
      // D3 mutates source and target properties into object references.
      // We must extract the ID string cleanly to avoid rendering mismatch on subsequent updates.
      const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      return {
        source: sourceId,
        target: targetId
      };
    });

    return { nodes: nodesCloned, links: linksCloned };
  }, [data, selectedNodeId]);

  // Keep track of hover node's immediate neighbors to perform connection highlighting
  const neighbors = useMemo(() => {
    const set = new Set<string>();
    if (!hoverNode) return set;

    graphData.links.forEach(link => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;

      if (sId === hoverNode.id) set.add(tId);
      if (tId === hoverNode.id) set.add(sId);
    });

    return set;
  }, [hoverNode, graphData.links]);

  // Keep physics running smoothly
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3ReheatSimulation();
    }
  }, [graphData]);

  const handleNodeClick = (node: any) => {
    onNodeClick(node.id);
  };

  const handleNodeHover = (node: any) => {
    setHoverNode(node || null);
  };

  // Custom node drawing to render text labels, shapes, and handle dimming
  const drawNodeCanvasObject = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.title || node.id;
    const fontSize = 11 / globalScale;
    ctx.font = `${fontSize}px sans-serif`;
    
    const r = node.val || 5;
    
    // Dim logic: if another node is hovered and this node is not related, dim it
    const isFocused = !hoverNode || hoverNode.id === node.id || neighbors.has(node.id);
    ctx.save();
    ctx.globalAlpha = isFocused ? 1.0 : 0.15;

    // Draw Circle Shape
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = node.color;
    ctx.fill();
    
    // Draw Stroke Highlight for selection
    if (node.isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#1e1e1e';
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();
    }

    // Don't draw text labels if zoomed out too much (reduces visual clutter)
    if (globalScale > 0.4) {
      const textWidth = ctx.measureText(label).width;
      const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.3); // padding
      
      // Semitransparent background for label readability
      ctx.fillStyle = 'rgba(24, 24, 24, 0.7)';
      ctx.fillRect(
        node.x - bckgDimensions[0] / 2,
        node.y + r + 3,
        bckgDimensions[0],
        bckgDimensions[1]
      );
      
      // Text Drawing
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = node.isSelected ? '#ffffff' : '#c9d1d9';
      ctx.fillText(label, node.x, node.y + r + 3);
    }
    
    ctx.restore();
  };

  // Dynamic link color based on hover focus
  const getLinkColor = (link: any) => {
    if (!hoverNode) return '#363636';
    const sId = typeof link.source === 'object' ? link.source.id : link.source;
    const tId = typeof link.target === 'object' ? link.target.id : link.target;
    const isRelated = sId === hoverNode.id || tId === hoverNode.id;
    return isRelated ? '#58a6ff' : 'rgba(54, 54, 54, 0.15)';
  };

  // Dynamic link width based on hover focus
  const getLinkWidth = (link: any) => {
    if (!hoverNode) return 1.5;
    const sId = typeof link.source === 'object' ? link.source.id : link.source;
    const tId = typeof link.target === 'object' ? link.target.id : link.target;
    const isRelated = sId === hoverNode.id || tId === hoverNode.id;
    return isRelated ? 2.5 : 0.5;
  };

  return (
    <div className="w-full h-full bg-obsidian-bg relative overflow-hidden flex-1 select-none">
      {/* Legend overlay */}
      <div className="absolute top-4 left-4 bg-obsidian-sidebar/80 border border-obsidian-border rounded-lg p-3 text-xs text-gray-400 z-10 backdrop-blur-sm flex flex-col gap-1.5 pointer-events-none">
        <div className="font-semibold text-gray-300 mb-1">노트 분류</div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#a3b8cc' }}></span>
          <span>개념 (Concept)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#85e89d' }}></span>
          <span>프로젝트 (Project)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ffab70' }}></span>
          <span>일지 (Daily)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f97583' }}></span>
          <span>자료 (Resource)</span>
        </div>
        <div className="flex items-center gap-2 border-t border-obsidian-border pt-1 mt-1">
          <span className="w-2.5 h-2.5 rounded-full border border-white" style={{ backgroundColor: '#58a6ff' }}></span>
          <span className="text-gray-200">선택된 노트</span>
        </div>
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        nodeCanvasObject={drawNodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        nodeRelSize={5}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        backgroundColor="#1e1e1e"
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        cooldownTicks={100}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.08}
      />
    </div>
  );
}

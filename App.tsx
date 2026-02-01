import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Menu, MousePointer2, Minus, Square, Circle as CircleIcon, 
  Type as TypeIcon, Move, RotateCw, Copy, Trash2, 
  Undo, Redo, Layers, Settings, ChevronRight, ChevronDown,
  Download, Upload, Sparkles, Loader2, ZoomIn, ZoomOut, Hash
} from 'lucide-react';
import { 
  Entity, Layer, ToolType, Point, ViewState, 
  LineEntity, RectEntity, CircleEntity, TextEntity 
} from './types';
import { 
  distance, screenToWorld, generateId, createDXFContent 
} from './utils/math';
import { generateCadEntities } from './services/geminiService';

// --- Constants ---
const INITIAL_LAYERS: Layer[] = [
  { id: '0', name: '0 (Default)', color: '#ffffff', visible: true, locked: false },
  { id: '1', name: 'Construction', color: '#38bdf8', visible: true, locked: false },
  { id: '2', name: 'Dimensions', color: '#fbbf24', visible: true, locked: false },
];

const INITIAL_VIEW: ViewState = { x: 0, y: 0, zoom: 1.0 };
const SNAP_DIST = 10;

// --- Sub-Components ---

interface ToolButtonProps {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}

const ToolButton: React.FC<ToolButtonProps> = ({ 
  icon: Icon, 
  label, 
  active, 
  onClick 
}) => (
  <button
    onClick={onClick}
    title={label}
    className={`p-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors ${
      active 
        ? 'bg-cad-accent text-cad-bg font-bold' 
        : 'text-cad-text hover:bg-cad-border'
    }`}
  >
    <Icon size={20} />
    <span className="text-[10px] uppercase tracking-wide">{label}</span>
  </button>
);

interface LayerRowProps {
  layer: Layer;
  active: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
}

const LayerRow: React.FC<LayerRowProps> = ({ 
  layer, 
  active, 
  onSelect, 
  onToggleVisible,
  onToggleLock 
}) => (
  <div 
    onClick={onSelect}
    className={`flex items-center gap-2 p-2 text-sm cursor-pointer border-b border-cad-border ${active ? 'bg-cad-border' : 'hover:bg-opacity-50 hover:bg-cad-border'}`}
  >
    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: layer.color }}></div>
    <span className="flex-1 font-mono truncate">{layer.name}</span>
    <button onClick={(e) => { e.stopPropagation(); onToggleVisible(); }} className="text-gray-400 hover:text-white">
      {layer.visible ? '👁️' : '🚫'}
    </button>
    <button onClick={(e) => { e.stopPropagation(); onToggleLock(); }} className="text-gray-400 hover:text-white">
      {layer.locked ? '🔒' : '🔓'}
    </button>
  </div>
);

// --- Main App ---

export default function App() {
  // State
  const [entities, setEntities] = useState<Entity[]>([]);
  const [layers, setLayers] = useState<Layer[]>(INITIAL_LAYERS);
  const [activeLayerId, setActiveLayerId] = useState<string>('0');
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [tool, setTool] = useState<ToolType>(ToolType.SELECT);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewEntity, setPreviewEntity] = useState<Entity | null>(null);
  
  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null); // For Pan
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>(["Welcome to Gemini CAD Studio."]);
  const [mousePos, setMousePos] = useState<Point>({x:0, y:0});

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Logic Helpers ---

  const getActiveLayer = () => layers.find(l => l.id === activeLayerId) || layers[0];

  const addToHistory = (msg: string) => {
    setCommandHistory(prev => [...prev.slice(-4), msg]);
  };

  // --- Handlers: Tool Logic ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === ToolType.PAN) {
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Coordinates relative to SVG canvas
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY, view.x, view.y, view.zoom);
    
    if (e.button === 1) { // Middle click pan
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (tool === ToolType.SELECT) {
      // Simple point selection logic
      const hit = entities.slice().reverse().find(ent => {
        if (!layers.find(l => l.id === ent.layerId)?.visible) return false;
        // Basic hit detection tolerance
        const tolerance = 5 / view.zoom;
        if (ent.type === 'circle') {
          const d = distance(worldPos, { x: ent.cx, y: ent.cy });
          return Math.abs(d - ent.r) < tolerance;
        }
        if (ent.type === 'line') {
          // Point line distance check (simplified)
          const l2 = Math.pow(distance(ent.start, ent.end), 2);
          if (l2 === 0) return distance(worldPos, ent.start) < tolerance;
          const t = ((worldPos.x - ent.start.x) * (ent.end.x - ent.start.x) + (worldPos.y - ent.start.y) * (ent.end.y - ent.start.y)) / l2;
          const tClamped = Math.max(0, Math.min(1, t));
          const proj = { x: ent.start.x + tClamped * (ent.end.x - ent.start.x), y: ent.start.y + tClamped * (ent.end.y - ent.start.y) };
          return distance(worldPos, proj) < tolerance;
        }
        if (ent.type === 'rect') {
           return (worldPos.x >= ent.x && worldPos.x <= ent.x + ent.width && worldPos.y >= ent.y && worldPos.y <= ent.y + ent.height);
        }
        return false;
      });

      if (hit) {
        setSelectedIds([hit.id]);
      } else {
        setSelectedIds([]);
      }
      return;
    }

    // Drawing Tools
    if (!isDrawing) {
      setIsDrawing(true);
      setStartPoint(worldPos);
      
      const newId = generateId();
      let newEnt: Entity | null = null;

      const common = {
        id: newId,
        layerId: activeLayerId,
        selected: false,
        color: getActiveLayer().color,
      };

      if (tool === ToolType.LINE) {
        newEnt = { ...common, type: 'line', start: worldPos, end: worldPos };
      } else if (tool === ToolType.RECTANGLE) {
        newEnt = { ...common, type: 'rect', x: worldPos.x, y: worldPos.y, width: 0, height: 0 };
      } else if (tool === ToolType.CIRCLE) {
        newEnt = { ...common, type: 'circle', cx: worldPos.x, cy: worldPos.y, r: 0 };
      }

      setPreviewEntity(newEnt);
    } else {
      // Finish Drawing
      if (previewEntity) {
        setEntities(prev => [...prev, previewEntity]);
        setPreviewEntity(null);
        addToHistory(`Created ${previewEntity.type}`);
      }
      setIsDrawing(false);
      setStartPoint(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, view.x, view.y, view.zoom);
    setMousePos(worldPos);

    if (dragStart) {
       const dx = e.clientX - dragStart.x;
       const dy = e.clientY - dragStart.y;
       setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
       setDragStart({ x: e.clientX, y: e.clientY });
       return;
    }

    if (isDrawing && startPoint && previewEntity) {
      if (previewEntity.type === 'line') {
        setPreviewEntity({ ...previewEntity, end: worldPos });
      } else if (previewEntity.type === 'rect') {
        setPreviewEntity({
          ...previewEntity,
          width: worldPos.x - startPoint.x,
          height: worldPos.y - startPoint.y
        });
      } else if (previewEntity.type === 'circle') {
        const r = distance(startPoint, worldPos);
        setPreviewEntity({ ...previewEntity, r });
      }
    }
  };

  const handleMouseUp = () => {
    if (dragStart) setDragStart(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const scaleFactor = 1.1;
    const zoomIn = e.deltaY < 0;
    const newZoom = zoomIn ? view.zoom * scaleFactor : view.zoom / scaleFactor;
    
    // Zoom towards mouse pointer logic would go here, simpler center zoom for now
    setView(prev => ({ ...prev, zoom: newZoom }));
  };

  // --- Handlers: AI ---

  const handleGeminiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsGenerating(true);
    addToHistory(`AI: "${prompt}"...`);

    try {
      const newEntities = await generateCadEntities(prompt, activeLayerId);
      setEntities(prev => [...prev, ...newEntities]);
      addToHistory(`AI: Generated ${newEntities.length} entities.`);
      setPrompt("");
    } catch (err) {
      console.error(err);
      addToHistory("AI: Error generating content.");
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Handlers: File I/O ---

  const handleExportDXF = () => {
    const content = createDXFContent(entities);
    const blob = new Blob([content], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'drawing.dxf';
    a.click();
    addToHistory("System: DXF Exported.");
  };

  const handleDelete = () => {
    if (selectedIds.length === 0) return;
    setEntities(prev => prev.filter(e => !selectedIds.includes(e.id)));
    setSelectedIds([]);
    addToHistory("Deleted objects.");
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete') handleDelete();
      if (e.key === 'Escape') {
        setIsDrawing(false);
        setPreviewEntity(null);
        setSelectedIds([]);
        setTool(ToolType.SELECT);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  // --- Rendering ---

  return (
    <div className="flex flex-col h-screen bg-cad-bg text-cad-text font-sans overflow-hidden select-none">
      
      {/* Header */}
      <header className="h-12 bg-cad-panel border-b border-cad-border flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-cyan-400 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">
            G
          </div>
          <h1 className="font-bold text-lg tracking-tight">Gemini <span className="font-light text-cad-accent">CAD Studio</span></h1>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-900 rounded-md border border-cad-border p-1">
             <button title="Undo (Ctrl+Z)" className="p-1 hover:bg-slate-700 rounded"><Undo size={16} /></button>
             <button title="Redo (Ctrl+Y)" className="p-1 hover:bg-slate-700 rounded"><Redo size={16} /></button>
          </div>
          <button 
            onClick={handleExportDXF}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
          >
            <Download size={14} /> Export DXF
          </button>
        </div>
      </header>

      {/* Ribbon / Toolbar */}
      <div className="h-16 bg-cad-panel border-b border-cad-border flex items-center px-4 gap-6 shrink-0 z-10 overflow-x-auto">
        
        {/* Draw Group */}
        <div className="flex gap-1 pr-6 border-r border-cad-border">
          <ToolButton icon={MousePointer2} label="Select" active={tool === ToolType.SELECT} onClick={() => setTool(ToolType.SELECT)} />
          <ToolButton icon={Minus} label="Line" active={tool === ToolType.LINE} onClick={() => setTool(ToolType.LINE)} />
          <ToolButton icon={Square} label="Rect" active={tool === ToolType.RECTANGLE} onClick={() => setTool(ToolType.RECTANGLE)} />
          <ToolButton icon={CircleIcon} label="Circle" active={tool === ToolType.CIRCLE} onClick={() => setTool(ToolType.CIRCLE)} />
          <ToolButton icon={TypeIcon} label="Text" active={tool === ToolType.TEXT} onClick={() => setTool(ToolType.TEXT)} />
        </div>

        {/* Modify Group */}
        <div className="flex gap-1 pr-6 border-r border-cad-border">
          <ToolButton icon={Move} label="Move" active={false} onClick={() => {}} />
          <ToolButton icon={RotateCw} label="Rotate" active={false} onClick={() => {}} />
          <ToolButton icon={Copy} label="Copy" active={false} onClick={() => {}} />
          <ToolButton icon={Trash2} label="Delete" active={false} onClick={handleDelete} />
        </div>

        {/* AI Input */}
        <form onSubmit={handleGeminiSubmit} className="flex-1 max-w-xl flex gap-2 items-center">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              {isGenerating ? <Loader2 className="animate-spin text-yellow-400" size={16} /> : <Sparkles className="text-cad-accent" size={16} />}
            </div>
            <input 
              type="text" 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe a shape to generate (e.g., 'Draw a house with a door')" 
              className="w-full bg-slate-900 border border-cad-border rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-cad-accent focus:ring-1 focus:ring-cad-accent transition-all"
            />
          </div>
          <button type="submit" disabled={isGenerating} className="bg-cad-accent text-slate-900 px-4 py-2 rounded-md text-sm font-bold hover:bg-sky-300 disabled:opacity-50">
            Generate
          </button>
        </form>

      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Canvas Area */}
        <div 
          ref={canvasRef}
          className="flex-1 bg-[#0b1120] relative cursor-crosshair overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* Grid Background (CSS Gradient for performance) */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage: `linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)`,
              backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
              backgroundPosition: `${view.x}px ${view.y}px`
            }}
          />

          {/* SVG Layer */}
          <svg className="w-full h-full block">
            <g transform={`translate(${view.x}, ${view.y}) scale(${view.zoom})`}>
              {/* Origin Marker */}
              <line x1="0" y1="0" x2="50" y2="0" stroke="red" strokeWidth="2" />
              <line x1="0" y1="0" x2="0" y2="50" stroke="#10b981" strokeWidth="2" />

              {/* Entities */}
              {entities.map(ent => {
                const layer = layers.find(l => l.id === ent.layerId);
                if (!layer || !layer.visible) return null;
                const isSelected = selectedIds.includes(ent.id);
                const strokeColor = isSelected ? '#38bdf8' : (ent.color || layer.color);
                const strokeWidth = isSelected ? 2/view.zoom + 2 : 1;

                if (ent.type === 'line') {
                  return <line key={ent.id} x1={ent.start.x} y1={ent.start.y} x2={ent.end.x} y2={ent.end.y} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />;
                }
                if (ent.type === 'rect') {
                  return <rect key={ent.id} x={ent.x} y={ent.y} width={ent.width} height={ent.height} stroke={strokeColor} strokeWidth={strokeWidth} fill="none" />;
                }
                if (ent.type === 'circle') {
                  return <circle key={ent.id} cx={ent.cx} cy={ent.cy} r={ent.r} stroke={strokeColor} strokeWidth={strokeWidth} fill="none" />;
                }
                if (ent.type === 'text') {
                  return <text key={ent.id} x={ent.x} y={ent.y} fill={strokeColor} fontSize={ent.fontSize}>{ent.text}</text>;
                }
                return null;
              })}

              {/* Preview Entity */}
              {previewEntity && (
                <g opacity="0.6">
                  {previewEntity.type === 'line' && <line x1={previewEntity.start.x} y1={previewEntity.start.y} x2={previewEntity.end.x} y2={previewEntity.end.y} stroke="yellow" strokeWidth="1" strokeDasharray="5,5" />}
                  {previewEntity.type === 'rect' && <rect x={previewEntity.x} y={previewEntity.y} width={previewEntity.width} height={previewEntity.height} stroke="yellow" strokeWidth="1" strokeDasharray="5,5" fill="none" />}
                  {previewEntity.type === 'circle' && <circle cx={previewEntity.cx} cy={previewEntity.cy} r={previewEntity.r} stroke="yellow" strokeWidth="1" strokeDasharray="5,5" fill="none" />}
                </g>
              )}
            </g>
          </svg>

          {/* Floating Command Line */}
          <div className="absolute bottom-4 left-4 right-80 h-32 bg-slate-900/90 border border-cad-border rounded-lg flex flex-col shadow-2xl backdrop-blur-sm z-30">
            <div className="flex-1 p-2 overflow-y-auto font-mono text-xs text-slate-400 space-y-1">
              {commandHistory.map((msg, i) => <div key={i}>{msg}</div>)}
            </div>
            <div className="border-t border-cad-border p-2 flex items-center gap-2">
              <span className="text-cad-accent font-bold text-xs">CMD {'>'}</span>
              <input 
                className="bg-transparent border-none focus:outline-none text-white text-sm w-full font-mono" 
                placeholder="Type a command..." 
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = e.currentTarget.value.toUpperCase();
                    if (val === 'L') setTool(ToolType.LINE);
                    else if (val === 'C') setTool(ToolType.CIRCLE);
                    else if (val === 'R') setTool(ToolType.RECTANGLE);
                    else addToHistory(`Unknown command: ${val}`);
                    e.currentTarget.value = '';
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-72 bg-cad-panel border-l border-cad-border flex flex-col z-20">
          
          {/* Layers Panel */}
          <div className="flex flex-col h-1/2 border-b border-cad-border">
            <div className="p-3 bg-slate-900 border-b border-cad-border flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Layers size={14} /> Layers
              </span>
              <button 
                onClick={() => setLayers(prev => [...prev, { id: generateId(), name: `Layer ${prev.length}`, color: '#ffffff', visible: true, locked: false }])}
                className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded border border-cad-border"
              >
                + New
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {layers.map(l => (
                <LayerRow 
                  key={l.id} 
                  layer={l} 
                  active={activeLayerId === l.id} 
                  onSelect={() => setActiveLayerId(l.id)} 
                  onToggleVisible={() => setLayers(prev => prev.map(pl => pl.id === l.id ? { ...pl, visible: !pl.visible } : pl))}
                  onToggleLock={() => setLayers(prev => prev.map(pl => pl.id === l.id ? { ...pl, locked: !pl.locked } : pl))}
                />
              ))}
            </div>
          </div>

          {/* Properties Panel */}
          <div className="flex flex-col h-1/2">
             <div className="p-3 bg-slate-900 border-b border-cad-border">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Settings size={14} /> Properties
              </span>
            </div>
            <div className="p-4 space-y-4 text-xs">
              {selectedIds.length === 0 ? (
                <div className="text-slate-500 italic text-center mt-10">No selection</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-slate-400">Object Type</label>
                    <div className="font-mono text-right">{entities.find(e => e.id === selectedIds[0])?.type.toUpperCase()}</div>
                    
                    <label className="text-slate-400">Layer</label>
                    <div className="font-mono text-right">{layers.find(l => l.id === entities.find(e => e.id === selectedIds[0])?.layerId)?.name}</div>

                    <label className="text-slate-400">Color</label>
                    <div className="flex justify-end"><div className="w-4 h-4 rounded-full" style={{ background: entities.find(e => e.id === selectedIds[0])?.color || '#fff' }}></div></div>
                  </div>
                  <hr className="border-cad-border" />
                  <div className="text-slate-500 text-center">Geometry (Read-only)</div>
                  {/* Geometry details could go here */}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Status Bar */}
      <div className="h-8 bg-cad-bg border-t border-cad-border flex items-center px-4 justify-between text-[10px] text-slate-400 font-mono">
        <div className="flex gap-4">
          <span>X: {mousePos.x.toFixed(2)} Y: {mousePos.y.toFixed(2)}</span>
          <span>Items: {entities.length}</span>
        </div>
        <div className="flex gap-4">
          <span className="hover:text-white cursor-pointer">SNAP: ON</span>
          <span className="hover:text-white cursor-pointer">GRID: ON</span>
          <span>Zoom: {(view.zoom * 100).toFixed(0)}%</span>
        </div>
      </div>

    </div>
  );
}
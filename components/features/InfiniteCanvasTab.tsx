import React, { useState, useRef, useEffect, MouseEvent, WheelEvent, DragEvent, useCallback, TouchEvent } from 'react';
import Button from '../ui/Button';
import ImageEditor from './ImageEditor';
import { 
  ensureHttps, queuePrompt, getHistory, getImageUrl, generateClientId, uploadImage, getLogs, parseConsoleProgress 
} from '../../services/api';
import { generateFluxWorkflow, generateEditWorkflow, generateSdxlWorkflow } from '../../services/workflows';

// --- Constants ---

const SIZE_PRESETS = [
  { label: 'Square (1:1)', w: 1024, h: 1024 },
  { label: 'Landscape (16:9)', w: 1280, h: 720 },
  { label: 'Portrait (9:16)', w: 720, h: 1280 },
  { label: 'Tall (8:16)', w: 512, h: 1024 },
  { label: 'Classic (4:3)', w: 1152, h: 864 },
];

const CLIPBOARD_MARKER = "COMFY_UI_PRO_INTERNAL_NODES";

// --- Types ---

type ItemType = 'image' | 'generator' | 'editor';
type ModelType = 'flux' | 'sdxl';

interface BaseItem {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  parentId?: string; // Track upstream source
}

interface GenerationParams {
  prompt: string;
  sourceId: string;
  steps: number;
  cfg: number;
}

interface ImageItem extends BaseItem {
  type: 'image';
  src: string;
  // History Support
  history?: string[]; // Array of all generated image URLs for this node
  historyIndex?: number; // Current index in history
  // Edit state
  editPrompt?: string;
  isEditing?: boolean;
  editProgress?: number;
  // Regeneration
  generationParams?: GenerationParams;
  isRegenerating?: boolean;
}

interface GeneratorItem extends BaseItem {
  type: 'generator';
  data: {
    model: ModelType;
    prompt: string;
    negPrompt: string; // for SDXL
    width: number;
    height: number;
    steps: number;
    cfg: number;
    isGenerating: boolean;
    progress: number;
    // Unified node fields
    resultImage?: string;
    mode: 'input' | 'result';
    // History Support for Generator
    history?: string[];
    historyIndex?: number;
    // Edit state for result
    editPrompt?: string;
    isEditing?: boolean;
    editProgress?: number;
    // Flux options
    useLora?: boolean; 
  };
}

interface EditorItem extends BaseItem {
  type: 'editor';
  data: {
    targetId: string | null;
    prompt: string;
    steps: number;
    cfg: number;
    isGenerating: boolean;
    progress: number;
  };
}

type CanvasItem = ImageItem | GeneratorItem | EditorItem;

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

interface InfiniteCanvasTabProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
}

interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface ResizeState {
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
}

const InfiniteCanvasTab: React.FC<InfiniteCanvasTabProps> = ({ serverUrl, setServerUrl }) => {
  // --- State ---
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  
  // Selection State
  const [activeItemId, setActiveItemId] = useState<string | null>(null); // The one currently being edited/focused
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // Multi-selection set
  const [activeSizeMenuId, setActiveSizeMenuId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  
  // Resize State
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  // Copy/Paste State
  const [clipboard, setClipboard] = useState<CanvasItem[]>([]);
  
  // Connection Visibility State
  const [showConnections, setShowConnections] = useState(true);
  
  // Dragging State
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<'canvas' | 'item' | 'selection'>('canvas');
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Mouse Tracking for Paste
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Touch Tracking
  const lastPinchDistRef = useRef<number | null>(null);

  // Preview / Editor State
  const [previewImage, setPreviewImage] = useState<{ src: string; dims?: { w: number; h: number } } | null>(null);
  const [editingImage, setEditingImage] = useState<{ id: string; src: string; originalSrc: string } | null>(null);

  // Z-Index Management
  const [topZ, setTopZ] = useState(10);

  const containerRef = useRef<HTMLDivElement>(null);
  const pollInterval = useRef<number | null>(null);

  // --- Helper Functions ---

  const getAdaptiveFontSize = (text: string) => {
    const len = text.length;
    if (len < 20) return 'text-4xl'; // Large, impactful text for short prompts
    if (len < 60) return 'text-3xl';
    if (len < 120) return 'text-2xl';
    if (len < 240) return 'text-xl';
    return 'text-base leading-relaxed'; // Standard readable size for long descriptions
  };

  /**
   * Smart Prompt Copy/Input Logic
   * 1. Updates the edit prompt of the source node (so "Modify this image" is filled).
   * 2. Updates the main prompt of the active generator (so "Generate" is ready).
   */
  const copyPromptToActiveNode = useCallback((text: string, sourceNodeId?: string) => {
    setItems(prev => {
        // Update editPrompt for the source node
        const itemsWithEdit = prev.map(item => {
            if (item.id === sourceNodeId) {
                if (item.type === 'image') return { ...item, editPrompt: text };
                if (item.type === 'generator') return { ...item, data: { ...item.data, editPrompt: text } };
            }
            return item;
        });

        // Determine target generator for main prompt
        let targetGenId = activeItemId;
        let activeItem = itemsWithEdit.find(i => i.id === targetGenId);
        
        if (!activeItem || activeItem.type !== 'generator') {
            const firstGen = itemsWithEdit.find(i => i.type === 'generator');
            if (firstGen) targetGenId = firstGen.id;
        }

        if (targetGenId) {
            return itemsWithEdit.map(item => {
                if (item.id === targetGenId && item.type === 'generator') {
                    return {
                        ...item,
                        data: {
                            ...item.data,
                            prompt: text,
                            mode: 'input' // Switch back to input if it was in result mode
                        }
                    };
                }
                return item;
            });
        }
        
        return itemsWithEdit;
    });

    // Automatically focus/select the source node so the user sees the filled "Modify this image" box
    if (sourceNodeId) {
        setActiveItemId(sourceNodeId);
        setSelectedIds(new Set([sourceNodeId]));
    }
  }, [activeItemId]);

  // --- Actions ---
  
  const pasteItems = useCallback(() => {
      if (clipboard.length === 0) return;

      // 1. Calculate center of clipboard items
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      clipboard.forEach(item => {
          minX = Math.min(minX, item.x);
          minY = Math.min(minY, item.y);
          maxX = Math.max(maxX, item.x + item.width);
          maxY = Math.max(maxY, item.y + item.height);
      });
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // 2. Determine paste target position (Mouse Cursor)
      let targetX = centerX + 20; // fallback offset
      let targetY = centerY + 20;

      if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const clientX = mousePosRef.current.x;
          const clientY = mousePosRef.current.y;
          
          if (clientX > 0 && clientY > 0) {
              const localX = clientX - rect.left;
              const localY = clientY - rect.top;
              targetX = (localX - view.x) / view.scale;
              targetY = (localY - view.y) / view.scale;
          }
      }

      const dx = targetX - centerX;
      const dy = targetY - centerY;

      const newIdsMap = new Map<string, string>();
      const newItems: CanvasItem[] = [];
      let maxZ = topZ;

      clipboard.forEach(item => {
          const newId = Math.random().toString(36).substr(2, 9);
          newIdsMap.set(item.id, newId);
          maxZ++;
          
          const clonedItem = JSON.parse(JSON.stringify(item));
          clonedItem.id = newId;
          clonedItem.x = item.x + dx;
          clonedItem.y = item.y + dy;
          clonedItem.zIndex = maxZ;
          clonedItem.parentId = undefined;
          
          newItems.push(clonedItem);
      });

      newItems.forEach(item => {
           if (item.type === 'editor') {
               const oldTargetId = (item as EditorItem).data.targetId;
               if (oldTargetId && newIdsMap.has(oldTargetId)) {
                   (item as EditorItem).data.targetId = newIdsMap.get(oldTargetId) || null;
               } else {
                   (item as EditorItem).data.targetId = null;
               }
           }
      });

      setTopZ(maxZ);
      setItems(prev => [...prev, ...newItems]);
      
      const newSelectedIds = new Set(newItems.map(i => i.id));
      setSelectedIds(newSelectedIds);
      if (newItems.length === 1) setActiveItemId(newItems[0].id);
  }, [clipboard, topZ, view]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
        if ((e.target as HTMLElement).matches('input, textarea')) return;
        const pastedText = e.clipboardData?.getData('text');
        if (pastedText === CLIPBOARD_MARKER) {
            e.preventDefault();
            pasteItems();
        }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [pasteItems]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
        if (e.code === 'Space') setIsSpacePressed(true);
        if (e.key === 'Escape') {
            if (previewImage) setPreviewImage(null);
            if (editingImage) setEditingImage(null);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (selectedIds.size > 0 && !(e.target as HTMLElement).matches('input, textarea')) {
                const selectedItems = items.filter(i => selectedIds.has(i.id));
                setClipboard(selectedItems);
                navigator.clipboard.writeText(CLIPBOARD_MARKER).catch(err => {
                    console.warn('Could not write to clipboard', err);
                });
            }
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
            if (!(e.target as HTMLElement).matches('input, textarea')) {
                setItems(prev => prev.filter(i => !selectedIds.has(i.id)));
                setSelectedIds(new Set());
                setActiveItemId(null);
            }
        }
    };

    const handleKeyUp = (e: globalThis.KeyboardEvent) => {
        if (e.code === 'Space') setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedIds, items, clipboard, previewImage, editingImage]);

  const handleWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement).closest('textarea')) return;
    
    e.preventDefault();
    const scaleAmount = -e.deltaY * 0.001;
    const newScale = Math.min(Math.max(0.1, view.scale * (1 + scaleAmount)), 5);
    
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const mouseWorldBeforeX = (mouseX - view.x) / view.scale;
      const mouseWorldBeforeY = (mouseY - view.y) / view.scale;
      
      const newX = mouseX - mouseWorldBeforeX * newScale;
      const newY = mouseY - mouseWorldBeforeY * newScale;
      
      setView({ x: newX, y: newY, scale: newScale });
    }
  };

  const handleResizeStart = (e: MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      const item = items.find(i => i.id === id);
      if (item) {
          setResizeState({
              id,
              startX: e.clientX,
              startY: e.clientY,
              startW: item.width,
              startH: item.height
          });
      }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.size-menu-container')) {
        setActiveSizeMenuId(null);
    }
    if ((e.target as HTMLElement).closest('input, textarea, button, label')) return;

    const isCanvasBg = e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-bg');
    
    if (isCanvasBg) {
        if (isSpacePressed || e.button === 1) {
            setDragMode('canvas');
        } else {
            setDragMode('selection');
            if (!e.shiftKey) {
                setSelectedIds(new Set());
                setActiveItemId(null);
            }
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const x2 = e.clientX - rect.left; // Added just to satisfy some linters or keep structure
                const y = e.clientY - rect.top;
                setSelectionBox({ startX: x, startY: y, currentX: x, currentY: y });
            }
        }
    }
    
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: MouseEvent) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };

    // Handling Resize
    if (resizeState) {
        const dx = (e.clientX - resizeState.startX) / view.scale;
        const dy = (e.clientY - resizeState.startY) / view.scale;
        
        setItems(prev => prev.map(item => {
            if (item.id === resizeState.id) {
                return {
                    ...item,
                    width: Math.max(256, resizeState.startW + dx),
                    height: Math.max(256, resizeState.startH + dy)
                };
            }
            return item;
        }));
        return; // Skip drag logic if resizing
    }

    if (isDragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      if (dragMode === 'item') {
          setItems(prev => prev.map(item => {
              if (selectedIds.has(item.id)) {
                  return { ...item, x: item.x + dx / view.scale, y: item.y + dy / view.scale };
              }
              return item;
          }));
          setDragStart({ x: e.clientX, y: e.clientY });
      } 
      else if (dragMode === 'canvas') {
          setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          setDragStart({ x: e.clientX, y: e.clientY });
      }
      else if (dragMode === 'selection' && selectionBox && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const currentX = e.clientX - rect.left;
          const currentY = e.clientY - rect.top;
          
          setSelectionBox(prev => prev ? ({ ...prev, currentX, currentY }) : null);

          const boxX = Math.min(selectionBox.startX, currentX);
          const boxY = Math.min(selectionBox.startY, currentY);
          const boxW = Math.abs(currentX - selectionBox.startX);
          const boxH = Math.abs(currentY - selectionBox.startY);

          const worldX = (boxX - view.x) / view.scale;
          const worldY = (boxY - view.y) / view.scale;
          const worldW = boxW / view.scale;
          const worldH = boxH / view.scale;

          const newSelectedIds = new Set(e.shiftKey ? selectedIds : []);
          
          items.forEach(item => {
              // Intersection check logic
              if (
                  item.x < worldX + worldW &&
                  item.x + item.width > worldX &&
                  item.y < worldY + worldH &&
                  item.y + item.height > worldY
              ) {
                  newSelectedIds.add(item.id);
              }
          });

          // Optimization: Only update state if selection actually changed to prevent lags
          if (newSelectedIds.size !== selectedIds.size || [...newSelectedIds].some(id => !selectedIds.has(id))) {
              setSelectedIds(newSelectedIds);
          }
      }
    }
  };

  const handleMouseUp = () => {
      setIsDragging(false);
      setResizeState(null);
      setSelectionBox(null);
      setDragMode('canvas'); 
  };

  // --- Touch Event Handlers for Mobile ---

  const handleTouchStart = (e: TouchEvent) => {
    // If interacting with inputs, don't drag/pan unless it's a pinch
    if ((e.target as HTMLElement).closest('input, textarea, button, .no-drag')) {
        // Allow text selection or input focus, but if 2 fingers, we override for zoom
        if (e.touches.length !== 2) return;
    }

    if (e.touches.length === 2) {
        // Pinch Start
        e.preventDefault(); // Prevent browser zoom
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        lastPinchDistRef.current = dist;
        // Don't set isDragging true for pinch, or handle it separately
        setDragMode('canvas'); 
    } else if (e.touches.length === 1) {
        const isCanvasBg = e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-bg');
        if (isCanvasBg) {
             setDragMode('canvas');
             setIsDragging(true);
             setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
        }
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2) {
        // Pinch Move
        e.preventDefault();
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        
        if (lastPinchDistRef.current) {
            const scaleChange = dist / lastPinchDistRef.current;
            const newScale = Math.min(Math.max(0.1, view.scale * scaleChange), 5);
            
            // Calculate center of pinch to zoom towards
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const localX = cx - rect.left;
                const localY = cy - rect.top;
                
                // Keep the focal point stationary:
                // world = (local - translate) / oldScale
                // newTranslate = local - world * newScale
                const worldX = (localX - view.x) / view.scale;
                const worldY = (localY - view.y) / view.scale;
                
                setView({
                    x: localX - worldX * newScale,
                    y: localY - worldY * newScale,
                    scale: newScale
                });
            }
        }
        lastPinchDistRef.current = dist;
    } else if (e.touches.length === 1 && isDragging) {
        // Prevent scroll if dragging canvas or item
        // Allow scroll if target is textarea
        if (!((e.target as HTMLElement).closest('textarea'))) {
           if (e.cancelable) e.preventDefault();
        }
        
        const touch = e.touches[0];
        const dx = touch.clientX - dragStart.x;
        const dy = touch.clientY - dragStart.y;
        
        if (dragMode === 'item') {
             setItems(prev => prev.map(item => {
              if (selectedIds.has(item.id)) {
                  return { ...item, x: item.x + dx / view.scale, y: item.y + dy / view.scale };
              }
              return item;
          }));
        } else if (dragMode === 'canvas') {
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        }
        
        setDragStart({ x: touch.clientX, y: touch.clientY });
    }
  };

  const handleTouchEnd = () => {
      setIsDragging(false);
      lastPinchDistRef.current = null;
  };

  const handleItemTouchStart = (e: TouchEvent, id: string) => {
      e.stopPropagation();
      const newZ = topZ + 1;
      setTopZ(newZ);
      setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: newZ } : i));
      
      if (!selectedIds.has(id)) {
          setSelectedIds(new Set([id]));
          setActiveItemId(id);
      } else {
          setActiveItemId(id);
      }

      if (!(e.target as HTMLElement).closest('input, textarea, button')) {
        setDragMode('item');
        setIsDragging(true);
        setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      }
  };

  const handleDragOver = (e: DragEvent) => e.preventDefault();

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        const img = new Image();
        img.src = src;
        img.onload = () => {
            const clientX = e.clientX;
            const clientY = e.clientY;
            const x = (clientX - view.x) / view.scale;
            const y = (clientY - view.y) / view.scale;

            const maxSide = 512;
            let finalWidth = img.width;
            let finalHeight = img.height;

            if (img.width > img.height) {
                finalWidth = maxSide;
                finalHeight = (img.height / img.width) * maxSide;
            } else {
                finalHeight = maxSide;
                finalWidth = (img.width / img.height) * maxSide;
            }

            const newItem: ImageItem = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'image',
                x: x - (finalWidth / 2), 
                y: y - (finalHeight / 2),
                width: finalWidth,
                height: finalHeight,
                zIndex: topZ + 1,
                src,
                history: [src],
                historyIndex: 0
            };
            setTopZ(prev => prev + 1);
            setItems(prev => [...prev, newItem]);
            setActiveItemId(newItem.id);
            setSelectedIds(new Set([newItem.id]));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleItemMouseDown = (e: MouseEvent, id: string) => {
      e.stopPropagation(); 
      const newZ = topZ + 1;
      setTopZ(newZ);
      setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: newZ } : i));
      
      if (e.shiftKey) {
          const newSelected = new Set(selectedIds);
          if (newSelected.has(id)) {
              newSelected.delete(id);
              if (activeItemId === id) setActiveItemId(null);
          } else {
              newSelected.add(id);
              setActiveItemId(id);
          }
          setSelectedIds(newSelected);
      } else {
          if (!selectedIds.has(id)) {
              setSelectedIds(new Set([id]));
              setActiveItemId(id);
          } else {
              setActiveItemId(id);
          }
      }

      if (!(e.target as HTMLElement).closest('input, textarea, button')) {
        setDragMode('item');
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
  };

  const addGeneratorNode = () => {
      const id = Math.random().toString(36).substr(2, 9);
      const centerX = ((-view.x) + (window.innerWidth / 2) - 200) / view.scale;
      const centerY = ((-view.y) + (window.innerHeight / 2) - 200) / view.scale;

      const newItem: GeneratorItem = {
          id,
          type: 'generator',
          x: centerX,
          y: centerY,
          width: 400,
          height: 400,
          zIndex: topZ + 1,
          data: {
              model: 'flux',
              prompt: '',
              negPrompt: '',
              width: 1024,
              height: 1024,
              steps: 9,
              cfg: 3.5,
              isGenerating: false,
              progress: 0,
              mode: 'input',
              useLora: true // Default enable Cartoon LoRA
          }
      };
      setTopZ(prev => prev + 1);
      setItems(prev => [...prev, newItem]);
      setActiveItemId(id);
      setSelectedIds(new Set([id]));
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        const img = new Image();
        img.src = src;
        img.onload = () => {
            const maxSide = 512;
            let finalWidth = img.width;
            let finalHeight = img.height;

            if (img.width > img.height) {
                finalWidth = maxSide;
                finalHeight = (img.height / img.width) * maxSide;
            } else {
                finalHeight = maxSide;
                finalWidth = (img.width / img.height) * maxSide;
            }

            const newItem: ImageItem = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'image',
                x: ((-view.x) + (window.innerWidth / 2) - (finalWidth / 2)) / view.scale,
                y: ((-view.y) + (window.innerHeight / 2) - (finalHeight / 2)) / view.scale,
                width: finalWidth,
                height: finalHeight,
                zIndex: topZ + 1,
                src,
                history: [src],
                historyIndex: 0
            };
            setTopZ(prev => prev + 1);
            setItems(prev => [...prev, newItem]);
            setActiveItemId(newItem.id);
            setSelectedIds(new Set([newItem.id]));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const removeItem = (id: string, e: MouseEvent | TouchEvent) => {
      e.stopPropagation();
      setItems(prev => prev.filter(i => i.id !== id));
      if (activeItemId === id) setActiveItemId(null);
      setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
      });
  };

  const updateItemData = (id: string, partialData: any) => {
      setItems(prev => prev.map(item => {
          if (item.id === id) {
              // @ts-ignore
              return { ...item, data: { ...item.data, ...partialData } };
          }
          return item;
      }));
  };

  const updateImageItem = (id: string, partialData: Partial<ImageItem>) => {
      setItems(prev => prev.map(item => {
          if (item.id === id && item.type === 'image') {
              return { ...item, ...partialData };
          }
          return item;
      }));
  };

  const switchImageVersion = (itemId: string, index: number) => {
      setItems(prev => prev.map(item => {
          if (item.id === itemId && item.type === 'image') {
              const imgItem = item as ImageItem;
              const history = imgItem.history || [imgItem.src];
              if (index >= 0 && index < history.length) {
                  return {
                      ...imgItem,
                      src: history[index],
                      historyIndex: index,
                      history // ensure history is set
                  };
              }
          }
          return item;
      }));
  };

  const removeImageVersion = (itemId: string, index: number, e: MouseEvent) => {
      e.stopPropagation();
      setItems(prev => prev.map(item => {
          if (item.id === itemId && item.type === 'image') {
              const imgItem = item as ImageItem;
              const history = imgItem.history || [imgItem.src];
              if (history.length <= 1) return imgItem;
              
              const newHistory = history.filter((_, i) => i !== index);
              let newIndex = imgItem.historyIndex ?? (history.length - 1);
              if (newIndex >= index) newIndex = Math.max(0, newIndex - 1);
              
              return {
                  ...imgItem,
                  history: newHistory,
                  historyIndex: newIndex,
                  src: newHistory[newIndex]
              };
          }
          return item;
      }));
  };

  const switchGeneratorVersion = (itemId: string, index: number) => {
      setItems(prev => prev.map(item => {
          if (item.id === itemId && item.type === 'generator') {
              const genItem = item as GeneratorItem;
              const history = genItem.data.history || (genItem.data.resultImage ? [genItem.data.resultImage] : []);
              if (index >= 0 && index < history.length) {
                  return {
                      ...genItem,
                      data: {
                          ...genItem.data,
                          resultImage: history[index],
                          historyIndex: index,
                          history,
                          mode: 'result' // Explicitly switch to result mode
                      }
                  };
              }
          }
          return item;
      }));
  };

  const removeGeneratorVersion = (itemId: string, index: number, e: MouseEvent) => {
      e.stopPropagation();
      setItems(prev => prev.map(item => {
          if (item.id === itemId && item.type === 'generator') {
              const genItem = item as GeneratorItem;
              const history = genItem.data.history || (genItem.data.resultImage ? [genItem.data.resultImage] : []);
              if (history.length <= 1) return genItem;
              
              const newHistory = history.filter((_, i) => i !== index);
              let newIndex = genItem.data.historyIndex ?? (history.length - 1);
              if (newIndex >= index) newIndex = Math.max(0, newIndex - 1);
              
              return {
                  ...genItem,
                  data: {
                      ...genItem.data,
                      history: newHistory,
                      historyIndex: newIndex,
                      resultImage: newHistory[newIndex]
                  }
              };
          }
          return item;
      }));
  };

  // --- Generation Logic ---

  const convertSrcToFile = async (src: string): Promise<File> => {
    const res = await fetch(src);
    const blob = await res.blob();
    return new File([blob], "source.png", { type: "image/png" });
  };

  const regenerateImage = async (itemId: string) => {
      const item = items.find(i => i.id === itemId) as ImageItem;
      if (!item || !item.generationParams) return;

      const { prompt, sourceId, steps, cfg } = item.generationParams;
      const sourceItem = items.find(i => i.id === sourceId);
      
      if (!sourceItem) {
          alert("Source image not found! Cannot regenerate.");
          return;
      }

      const url = ensureHttps(serverUrl);
      if (!url) {
          alert("Please check Server URL");
          return;
      }

      updateImageItem(itemId, { isRegenerating: true }); 

      try {
          let src = '';
          if (sourceItem.type === 'image') src = (sourceItem as ImageItem).src;
          else if (sourceItem.type === 'generator') src = (sourceItem as GeneratorItem).data.resultImage || '';
          
          if (!src) throw new Error("Source has no image data");

          const file = await convertSrcToFile(src);
          const serverFileName = await uploadImage(url, file);
          
          const clientId = generateClientId();
          const workflow = generateEditWorkflow(prompt, serverFileName, steps || 20, cfg || 2.5);
          const promptId = await queuePrompt(url, workflow, clientId);

          const checkStatus = async () => {
              try {
                  const historyResponse = await getHistory(url, promptId);
                  if (historyResponse[promptId]) {
                      const result = historyResponse[promptId];
                      if (result.status.status_str === 'success') {
                           const outputs = result.outputs;
                           for (const key in outputs) {
                              if (outputs[key].images?.length > 0) {
                                  const img = outputs[key].images[0];
                                  const imgUrl = getImageUrl(url, img.filename, img.subfolder, img.type);
                                  
                                  // Update history and set new image
                                  const currentHistory = item.history || [item.src];
                                  const newHistory = [...currentHistory, imgUrl];
                                  
                                  updateImageItem(itemId, { 
                                      src: imgUrl, 
                                      isRegenerating: false,
                                      history: newHistory,
                                      historyIndex: newHistory.length - 1
                                  });
                                  return;
                              }
                           }
                      } else if (result.status.status_str === 'error') {
                           throw new Error("Regeneration failed");
                      }
                  }

                  // Continue polling
                  setTimeout(checkStatus, 1000);

              } catch (e) {
                  console.error(e);
                  updateImageItem(itemId, { isRegenerating: false });
              }
          };
          checkStatus();

      } catch (e: any) {
          alert(e.message);
          updateImageItem(itemId, { isRegenerating: false });
      }
  };

  const executeEdit = async (itemId: string, prompt: string) => {
      const item = items.find(i => i.id === itemId);
      if (!item) return;

      const url = ensureHttps(serverUrl);
      if (!url) {
          alert("Please check Server URL");
          return;
      }

      if (item.type === 'image') updateImageItem(itemId, { isEditing: true, editProgress: 0 });
      else if (item.type === 'generator') updateItemData(itemId, { isEditing: true, editProgress: 0 });

      try {
          let src = '';
          if (item.type === 'image') src = (item as ImageItem).src;
          else if (item.type === 'generator') src = (item as GeneratorItem).data.resultImage || '';
          
          if (!src) throw new Error("No source image");

          const file = await convertSrcToFile(src);
          const serverFileName = await uploadImage(url, file);

          if (item.type === 'image') updateImageItem(itemId, { editProgress: 20 });
          else updateItemData(itemId, { editProgress: 20 });

          const clientId = generateClientId();
          const steps = 20;
          const cfg = 2.5;
          const workflow = generateEditWorkflow(prompt, serverFileName, steps, cfg);
          const promptId = await queuePrompt(url, workflow, clientId);

          const checkStatus = async () => {
              try {
                  const history = await getHistory(url, promptId);
                  if (history[promptId]) {
                      const result = history[promptId];
                      if (result.status.status_str === 'success') {
                           const outputs = result.outputs;
                           for (const key in outputs) {
                              if (outputs[key].images?.length > 0) {
                                  const img = outputs[key].images[0];
                                  const imgUrl = getImageUrl(url, img.filename, img.subfolder, img.type);
                                  
                                  const newItem: ImageItem = {
                                      id: Math.random().toString(36).substr(2, 9),
                                      type: 'image',
                                      x: item.x + item.width + 40,
                                      y: item.y,
                                      width: item.width, 
                                      height: item.height,
                                      zIndex: topZ + 2, 
                                      parentId: item.id, 
                                      src: imgUrl,
                                      history: [imgUrl], // Initialize history
                                      historyIndex: 0,
                                      generationParams: {
                                          prompt,
                                          sourceId: item.id,
                                          steps,
                                          cfg
                                      }
                                  };

                                  setTopZ(prev => prev + 2);
                                  setItems(prev => [...prev, newItem]);
                                  setSelectedIds(new Set([newItem.id])); 

                                  if (item.type === 'image') updateImageItem(itemId, { isEditing: false, editProgress: 100, editPrompt: '' });
                                  else updateItemData(itemId, { isEditing: false, editProgress: 100, editPrompt: '' });
                                  return;
                              }
                           }
                      } else if (result.status.status_str === 'error') {
                           throw new Error("Edit failed");
                      }
                  }

                  const logs = await getLogs(url);
                  const parsed = parseConsoleProgress(logs);
                  const currentProg = item.type === 'image' ? ((item as ImageItem).editProgress || 20) : ((item as GeneratorItem).data.editProgress || 20);
                  const newProg = parsed > 0 ? parsed : Math.min(currentProg + 2, 95);

                  if (item.type === 'image') updateImageItem(itemId, { editProgress: newProg });
                  else updateItemData(itemId, { editProgress: newProg });

                  setTimeout(checkStatus, 1000);

              } catch (e) {
                  console.error(e);
                  if (item.type === 'image') updateImageItem(itemId, { isEditing: false });
                  else updateItemData(itemId, { isEditing: false });
              }
          };
          checkStatus();

      } catch (e: any) {
          alert(e.message);
          if (item.type === 'image') updateImageItem(itemId, { isEditing: false });
          else updateItemData(itemId, { isEditing: false });
      }
  };

  const executeGeneration = async (itemId: string) => {
      const item = items.find(i => i.id === itemId);
      if (!item) return;

      const url = ensureHttps(serverUrl);
      if (!url) {
          alert("Please check Server URL");
          return;
      }

      updateItemData(itemId, { isGenerating: true, progress: 0 });

      try {
          let workflow;
          let promptId;
          const clientId = generateClientId();

          if (item.type === 'generator') {
              const data = item.data;
              if (data.model === 'flux') {
                  // Pass useLora option
                  workflow = generateFluxWorkflow(data.prompt, data.width, data.height, data.steps, data.useLora ?? true);
              } else {
                  workflow = generateSdxlWorkflow(data.prompt, data.negPrompt, data.width, data.height, data.steps, data.cfg);
              }
              promptId = await queuePrompt(url, workflow, clientId);
          } 
          else if (item.type === 'editor') {
              const data = item.data;
              if (!data.targetId) throw new Error("No target image selected");
              
              const targetImage = items.find(i => i.id === data.targetId) as ImageItem;
              if (!targetImage) throw new Error("Target image not found");

              updateItemData(itemId, { progress: 10 });
              const file = await convertSrcToFile(targetImage.src);
              const serverFileName = await uploadImage(url, file);
              
              workflow = generateEditWorkflow(data.prompt, serverFileName, data.steps, data.cfg);
              promptId = await queuePrompt(url, workflow, clientId);
          } else {
              return;
          }

          const checkStatus = async () => {
              try {
                  const history = await getHistory(url, promptId);
                  if (history[promptId]) {
                      const result = history[promptId];
                      if (result.status.status_str === 'success') {
                          const outputs = result.outputs;
                          for (const key in outputs) {
                              if (outputs[key].images?.length > 0) {
                                  const img = outputs[key].images[0];
                                  const imgUrl = getImageUrl(url, img.filename, img.subfolder, img.type);
                                  
                                  if (item.type === 'generator') {
                                      const currentHistory = item.data.history || (item.data.resultImage ? [item.data.resultImage] : []);
                                      const newHistory = [...currentHistory, imgUrl];
                                      
                                      updateItemData(itemId, { 
                                          isGenerating: false, 
                                          progress: 100, 
                                          resultImage: imgUrl, 
                                          mode: 'result',
                                          history: newHistory,
                                          historyIndex: newHistory.length - 1
                                      });
                                  } else {
                                      const imgObj = new Image();
                                      imgObj.src = imgUrl;
                                      imgObj.onload = () => {
                                          const newItem: ImageItem = {
                                              id: Math.random().toString(36).substr(2, 9),
                                              type: 'image',
                                              x: item.x + item.width + 50,
                                              y: item.y,
                                              width: imgObj.width / 2,
                                              height: imgObj.height / 2,
                                              zIndex: topZ + 2,
                                              parentId: item.id, 
                                              src: imgUrl,
                                              history: [imgUrl],
                                              historyIndex: 0,
                                              generationParams: item.type === 'editor' ? {
                                                  prompt: item.data.prompt,
                                                  sourceId: item.data.targetId || '',
                                                  steps: item.data.steps,
                                                  cfg: item.data.cfg
                                              } : undefined
                                          };
                                          setTopZ(prev => prev + 2);
                                          setItems(prev => [...prev, newItem]);
                                          setSelectedIds(new Set([newItem.id])); 
                                          updateItemData(itemId, { isGenerating: false, progress: 100 });
                                      };
                                  }
                                  return;
                              }
                          }
                      } else if (result.status.status_str === 'error') {
                          throw new Error('Generation Failed');
                      }
                  }

                  const logs = await getLogs(url);
                  const parsed = parseConsoleProgress(logs);
                  const currentProg = item.type === 'generator' ? item.data.progress : item.data.progress;
                  const newProg = parsed > 0 ? parsed : Math.min(currentProg + 2, 95);
                  
                  updateItemData(itemId, { progress: newProg });
                  setTimeout(checkStatus, 1000);
              } catch (e) {
                  console.error(e);
                  updateItemData(itemId, { isGenerating: false, progress: 0 }); 
              }
          };

          checkStatus();

      } catch (e: any) {
          alert(e.message);
          updateItemData(itemId, { isGenerating: false, progress: 0 });
      }
  };

  const handleEditorSave = (newSrc: string) => {
    if (!editingImage) return;
    const itemId = editingImage.id;
    
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        if (item.type === 'image') {
          const imgItem = item as ImageItem;
          const oldHistory = imgItem.history || [imgItem.src];
          const newHistory = [...oldHistory, newSrc];
          return { 
              ...imgItem, 
              src: newSrc,
              history: newHistory,
              historyIndex: newHistory.length - 1
          } as ImageItem;
        } else if (item.type === 'generator') {
          const genItem = item as GeneratorItem;
          const oldHistory = genItem.data.history || (genItem.data.resultImage ? [genItem.data.resultImage] : []);
          const newHistory = [...oldHistory, newSrc];
          return { 
              ...genItem, 
              data: { 
                  ...genItem.data, 
                  resultImage: newSrc,
                  history: newHistory,
                  historyIndex: newHistory.length - 1
              } 
          } as GeneratorItem;
        }
      }
      return item;
    }));
    
    setEditingImage(null);
  };

  const renderConnections = () => {
      const connections: React.ReactElement[] = [];
      const drawnConnections = new Set<string>();

      items.forEach(item => {
          if (item.parentId) {
              const parent = items.find(i => i.id === item.parentId);
              if (parent) {
                  const key = `${parent.id}-${item.id}`;
                  if (!drawnConnections.has(key)) {
                      drawnConnections.add(key);
                      
                      const parentCenter = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
                      const itemCenter = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
                      
                      const isActive = selectedIds.has(item.id) || selectedIds.has(parent.id);

                      connections.push(
                          <line 
                              key={key}
                              x1={parentCenter.x} y1={parentCenter.y}
                              x2={itemCenter.x} y2={itemCenter.y}
                              stroke={isActive ? "#3b82f6" : "#cbd5e1"}
                              strokeWidth={isActive ? "2" : "1.5"}
                              strokeDasharray={isActive ? "10,10" : "6,6"}
                              className={`transition-all duration-300 connection-line ${isActive ? 'opacity-100 stroke-blue-500 animate-flow' : 'opacity-40'}`}
                          />
                      );
                  }
              }
          }
      });
      
      if (connections.length === 0) return null;

      return (
          <svg className="absolute top-0 left-0 pointer-events-none overflow-visible" style={{ width: 1, height: 1, zIndex: 0 }}>
              {connections}
          </svg>
      );
  };

  const renderEditOverlay = (isEditing: boolean, progress: number, prompt: string | undefined, onPromptChange: (val: string) => void, onExecute: () => void) => (
      <div 
        className={`absolute bottom-6 left-6 right-24 transition-all duration-300 z-50 ${isEditing ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100'}`}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()} 
      >
          <div className="glass-panel p-2 rounded-2xl flex items-center gap-2 shadow-glass-hover bg-white/80 backdrop-blur-xl">
              <input 
                  type="text" 
                  className="flex-1 bg-transparent border-none text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none px-3 font-mono"
                  placeholder="Modify this image..."
                  value={prompt || ''}
                  onChange={e => onPromptChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onExecute()}
              />
              <button 
                  onClick={onExecute}
                  disabled={isEditing || !prompt}
                  className="bg-slate-900 text-white rounded-xl w-8 h-8 flex items-center justify-center hover:bg-black transition-colors disabled:opacity-50 shadow-md"
              >
                  {isEditing ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
              </button>
          </div>
          {isEditing && (
              <div className="absolute -top-3 left-0 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
          )}
      </div>
  );

  const renderResizeHandle = (itemId: string) => (
      <div
          className="absolute bottom-0 right-0 w-8 h-8 z-50 cursor-se-resize flex items-end justify-end p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseDown={(e) => handleResizeStart(e, itemId)}
      >
           <div className="w-3 h-3 border-b-2 border-r-2 border-blue-500 rounded-br-sm" />
      </div>
  );

  const renderEditNode = (item: EditorItem) => {
      const isActive = activeItemId === item.id || selectedIds.has(item.id);

      return (
        <div 
          className="relative group w-full h-full flex flex-col transition-all duration-300"
          onMouseDown={e => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') {
               e.stopPropagation();
            }
          }}
          onTouchStart={e => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') {
               e.stopPropagation();
            }
          }}
        >
            <div className={`w-full h-full glass-panel rounded-3xl overflow-hidden shadow-glass hover:shadow-glass-hover transition-all duration-500 relative ${item.data.isGenerating ? 'ring-2 ring-blue-500/30' : ''}`}>
                
                {item.data.isGenerating && (
                    <div className="absolute inset-0 bg-white/90 backdrop-blur-md z-20 flex flex-col items-center justify-center">
                        <div className="w-12 h-12 border-2 border-slate-100 border-t-slate-900 rounded-full animate-spin mb-6"></div>
                        <span className="text-xs font-mono font-medium text-slate-400 tracking-widest uppercase">{item.data.progress}% Processing</span>
                    </div>
                )}

                <div className="w-full h-full p-6 flex flex-col relative bg-white/50">
                    <div className="flex items-center justify-between mb-4">
                         <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Editor Node</span>
                         {item.data.targetId ? (
                            <span className="text-[10px] text-green-500 font-mono font-bold flex items-center gap-1">
                                <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                Linked
                            </span>
                         ) : (
                            <span className="text-[10px] text-orange-400 font-mono font-bold flex items-center gap-1">
                                <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                                Unlinked
                            </span>
                         )}
                    </div>

                    <textarea 
                        rows={4}
                        className={`w-full flex-1 bg-transparent font-medium text-slate-800 placeholder:text-slate-300/80 resize-none focus:outline-none text-sm leading-relaxed tracking-tight font-sans transition-all duration-200 border-b border-transparent focus:border-slate-200`}
                        placeholder="Describe edits..."
                        value={item.data.prompt}
                        onChange={(e) => updateItemData(item.id, { prompt: e.target.value })}
                    />
                    
                    <div className="flex gap-4 mt-4 pt-4 border-t border-slate-100/50">
                        <div className="flex-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Steps</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-transparent focus:border-blue-200 rounded-lg px-2 py-1 text-xs font-mono transition-all outline-none"
                                value={item.data.steps}
                                onChange={(e) => updateItemData(item.id, { steps: Number(e.target.value) })}
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">CFG</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-transparent focus:border-blue-200 rounded-lg px-2 py-1 text-xs font-mono transition-all outline-none"
                                value={item.data.cfg}
                                onChange={(e) => updateItemData(item.id, { cfg: Number(e.target.value) })}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className={`absolute top-full left-0 w-full flex justify-center pt-4 opacity-0 group-hover:opacity-100 transition-all duration-500 transform -translate-y-2 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto z-50 ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : ''}`}>
                 <button 
                    onClick={() => executeGeneration(item.id)}
                    disabled={!item.data.targetId}
                    className="bg-slate-900 text-white px-6 py-2 rounded-full shadow-xl shadow-slate-900/10 text-[10px] font-bold tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-2 uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <span>Apply Edit</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
            </div>

            <button 
                 className={`absolute -top-2 -right-2 z-50 bg-white text-rose-500 w-8 h-8 flex items-center justify-center rounded-full shadow-lg border border-slate-100 transition-all duration-200 hover:scale-110 hover:bg-rose-50 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 ${isActive ? 'opacity-100 scale-100' : ''}`}
                 onClick={(e) => removeItem(item.id, e)}
                 onMouseDown={e => e.stopPropagation()}
                 onTouchStart={e => e.stopPropagation()}
               >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            {renderResizeHandle(item.id)}
        </div>
      );
  };

  const renderImageNode = (item: ImageItem) => {
      const isActive = activeItemId === item.id || selectedIds.has(item.id);
      return (
      <div 
        className="relative group w-full h-full select-none"
        onDoubleClick={(e) => {
            e.stopPropagation();
            const originalSrc = item.history && item.history.length > 0 ? item.history[0] : item.src;
            setEditingImage({ id: item.id, src: item.src, originalSrc });
        }}
      >
          {/* Prompt Info Panel (Sidecar) */}
          {item.generationParams?.prompt && (
             <div 
                className="absolute top-0 left-full h-full pl-4 flex flex-col justify-start z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none group-hover:pointer-events-auto"
                onMouseDown={e => e.stopPropagation()}
             >
                 <div 
                    className="w-64 max-h-full flex flex-col bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 origin-left scale-90 group-hover:scale-100 transition-transform duration-300 overflow-hidden"
                    onWheel={(e) => e.stopPropagation()}
                 >
                     <div className="p-4 overflow-y-auto custom-scrollbar">
                         <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Prompt</div>
                         <p 
                            className="text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-wrap font-mono select-text cursor-pointer hover:text-blue-600 hover:bg-blue-50/50 rounded p-1 -ml-1 transition-all active:scale-95"
                            onClick={(e) => {
                                e.stopPropagation();
                                copyPromptToActiveNode(item.generationParams!.prompt, item.id);
                            }}
                            title="Click to copy to active generator AND this node's edit box"
                         >
                            {item.generationParams.prompt}
                         </p>
                     </div>
                     <div className="p-3 bg-slate-50/80 border-t border-slate-100 flex gap-4 shrink-0">
                         <div>
                             <span className="text-[8px] text-slate-400 uppercase block">Steps</span>
                             <span className="text-xs font-mono font-bold text-slate-700">{item.generationParams.steps}</span>
                         </div>
                         <div>
                             <span className="text-[8px] text-slate-400 uppercase block">CFG</span>
                             <span className="text-xs font-mono font-bold text-slate-700">{item.generationParams.cfg}</span>
                         </div>
                     </div>
                 </div>
             </div>
          )}

          <div className="w-full h-full rounded-3xl shadow-glass hover:shadow-glass-hover transition-all duration-500 bg-white overflow-hidden relative">
              {/* Loading Overlay for Regeneration */}
              {item.isRegenerating && (
                 <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-40 flex flex-col items-center justify-center">
                     <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mb-2"></div>
                     <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Regenerating</span>
                 </div>
              )}
              
              {/* Version History Thumbnails (Floating Top Left) */}
              {(item.history && item.history.length > 1) && (
                  <div 
                    className="absolute top-4 left-4 flex gap-2 z-40 max-w-[80%] overflow-x-auto no-scrollbar p-1"
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                  >
                    {item.history.map((histSrc, idx) => (
                        <div key={idx} className="relative group/thumb">
                            <button
                                onClick={(e) => { e.stopPropagation(); switchImageVersion(item.id, idx); }}
                                className={`w-10 h-10 rounded-lg overflow-hidden border-2 shadow-sm transition-all duration-200 hover:scale-110 flex-shrink-0 ${
                                    (item.historyIndex ?? (item.history ? item.history.length - 1 : 0)) === idx 
                                    ? 'border-blue-500 ring-2 ring-blue-500/20 scale-105' 
                                    : 'border-white/80 opacity-60 hover:opacity-100 hover:border-white'
                                }`}
                                title={`Version ${idx + 1}`}
                            >
                                <img src={histSrc} className="w-full h-full object-cover pointer-events-none" />
                            </button>
                            <button 
                                onClick={(e) => removeImageVersion(item.id, idx, e)}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-md hover:bg-rose-600 scale-75 group-hover/thumb:scale-100"
                            >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    ))}
                </div>
              )}

              {/* Added background to handle aspect ratio differences cleanly */}
              <div className="w-full h-full flex items-center justify-center bg-slate-50">
                <img 
                    src={item.src} 
                    alt="uploaded" 
                    className="max-w-full max-h-full object-contain pointer-events-none select-none"
                />
              </div>

              {renderEditOverlay(
                  !!item.isEditing, 
                  item.editProgress || 0, 
                  item.editPrompt, 
                  (val) => updateImageItem(item.id, { editPrompt: val }),
                  () => executeEdit(item.id, item.editPrompt || '')
              )}
              
              {/* Action Buttons Group */}
              <div className={`absolute bottom-6 right-6 z-40 flex flex-col gap-3 items-end transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''}`}>
                 {/* Prominent White Refresh Button (Floating Card Style) */}
                 {item.generationParams && !item.isRegenerating && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            regenerateImage(item.id);
                        }}
                        className="w-12 h-12 bg-white rounded-2xl shadow-xl shadow-slate-200/50 text-slate-700 flex items-center justify-center hover:scale-110 hover:shadow-2xl hover:text-blue-600 active:scale-95 transition-all group/refresh"
                        title="Regenerate New Version"
                    >
                        <svg className="group-hover/refresh:rotate-180 transition-transform duration-500" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>
                 )}

                <a 
                    href={item.src} 
                    download={`img-${item.id}.png`}
                    className="w-10 h-10 bg-white/40 backdrop-blur-md border border-white/50 text-slate-700 rounded-xl flex items-center justify-center shadow-lg transition-all hover:bg-white hover:scale-105"
                    onClick={e => e.stopPropagation()}
                    title="Download"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </a>
              </div>
          </div>
          
           <button 
             className={`absolute -top-2 -right-2 z-50 bg-white text-rose-500 w-8 h-8 flex items-center justify-center rounded-full shadow-lg border border-slate-100 transition-all duration-200 hover:scale-110 hover:bg-rose-50 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 ${isActive ? 'opacity-100 scale-100' : ''}`}
             onClick={(e) => removeItem(item.id, e)}
             onMouseDown={e => e.stopPropagation()}
             onTouchStart={e => e.stopPropagation()}
           >
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
           
           {renderResizeHandle(item.id)}
      </div>
  );
  };

  const renderGeneratorNode = (item: GeneratorItem) => {
      const isInput = item.data.mode === 'input';
      const isActive = activeItemId === item.id || selectedIds.has(item.id);

      return (
        <div 
          className="relative group w-full h-full flex flex-col transition-all duration-300"
          onMouseDown={e => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA') {
               e.stopPropagation();
            }
          }}
          onTouchStart={e => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA') {
               e.stopPropagation();
            }
          }}
        >
            {/* START: New Info Panel */}
            {item.data.prompt && (
             <div 
                className="absolute top-0 left-full h-full pl-4 flex flex-col justify-start z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none group-hover:pointer-events-auto"
                onMouseDown={e => e.stopPropagation()}
             >
                 <div 
                    className="w-64 max-h-full flex flex-col bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 origin-left scale-90 group-hover:scale-100 transition-transform duration-300 overflow-hidden"
                    onWheel={(e) => e.stopPropagation()}
                 >
                     <div className="p-4 overflow-y-auto custom-scrollbar">
                         <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Prompt</div>
                         <p 
                            className="text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-wrap font-mono select-text cursor-pointer hover:text-blue-600 hover:bg-blue-50/50 rounded p-1 -ml-1 transition-all active:scale-95"
                            onClick={(e) => {
                                e.stopPropagation();
                                copyPromptToActiveNode(item.data.prompt, item.id);
                            }}
                            title="Click to copy to active generator AND this node's edit box"
                         >
                            {item.data.prompt}
                         </p>
                         
                         {item.data.negPrompt && (
                            <>
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2 mt-3">Negative</div>
                                <p className="text-xs text-slate-500 font-medium leading-relaxed whitespace-pre-wrap font-mono select-text">{item.data.negPrompt}</p>
                            </>
                         )}
                     </div>
                     <div className="p-3 bg-slate-50/80 border-t border-slate-100 flex gap-4 shrink-0">
                         <div>
                             <span className="text-[8px] text-slate-400 uppercase block">Steps</span>
                             <span className="text-xs font-mono font-bold text-slate-700">{item.data.steps}</span>
                         </div>
                         <div>
                             <span className="text-[8px] text-slate-400 uppercase block">CFG</span>
                             <span className="text-xs font-mono font-bold text-slate-700">{item.data.cfg}</span>
                         </div>
                         <div>
                             <span className="text-[8px] text-slate-400 uppercase block">Model</span>
                             <span className="text-xs font-mono font-bold text-slate-700 uppercase">{item.data.model}</span>
                         </div>
                     </div>
                 </div>
             </div>
            )}
            {/* END: New Info Panel */}

            {isInput && (
                <div className={`absolute bottom-full left-0 w-full flex justify-center pb-6 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto z-50 ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : ''}`}>
                    <div className="flex items-center gap-1 p-1.5 bg-white rounded-2xl shadow-glass-hover border border-slate-100/50">
                        <button 
                            className={`px-4 py-2 text-[10px] tracking-wider font-bold rounded-xl transition-all ${item.data.model === 'flux' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                            onClick={() => updateItemData(item.id, { model: 'flux' })}
                        >
                            FLUX
                        </button>
                        <button 
                            className={`px-4 py-2 text-[10px] tracking-wider font-bold rounded-xl transition-all ${item.data.model === 'sdxl' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                            onClick={() => updateItemData(item.id, { model: 'sdxl' })}
                        >
                            SDXL
                        </button>
                        <div className="w-[1px] h-4 bg-slate-100 mx-2"></div>
                        
                        <div className="relative flex items-center gap-1 px-2 size-menu-container">
                            <button 
                                className="text-[10px] font-bold text-slate-400 hover:text-slate-800 transition-colors flex items-center gap-1 uppercase tracking-wider"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveSizeMenuId(activeSizeMenuId === item.id ? null : item.id);
                                }}
                            >
                                {item.data.width} × {item.data.height}
                            </button>

                            {activeSizeMenuId === item.id && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 z-[60] min-w-[160px] animate-fade-in flex flex-col gap-1 origin-bottom">
                                    <div className="text-[9px] font-bold text-slate-300 px-3 py-2 uppercase tracking-widest">Presets</div>
                                    {SIZE_PRESETS.map(preset => (
                                        <button
                                            key={preset.label}
                                            className="text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 rounded-xl hover:text-slate-900 transition-colors flex justify-between items-center group"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                updateItemData(item.id, { width: preset.w, height: preset.h });
                                                setActiveSizeMenuId(null);
                                            }}
                                        >
                                            <span className="font-medium">{preset.label}</span>
                                            <span className="text-[9px] text-slate-300 font-mono group-hover:text-slate-500">{preset.w}×{preset.h}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className={`w-full h-full glass-panel rounded-3xl overflow-hidden shadow-glass hover:shadow-glass-hover transition-all duration-500 relative ${item.data.isGenerating ? 'ring-2 ring-blue-500/30' : ''}`}>
                
                {item.data.isGenerating && (
                    <div className="absolute inset-0 bg-white/90 backdrop-blur-md z-20 flex flex-col items-center justify-center">
                        <div className="w-12 h-12 border-2 border-slate-100 border-t-slate-900 rounded-full animate-spin mb-6"></div>
                        <span className="text-xs font-mono font-medium text-slate-400 tracking-widest uppercase">{item.data.progress}% Processing</span>
                    </div>
                )}

                {isInput ? (
                    <div className="w-full h-full p-8 flex flex-col items-center justify-center relative">
                         {/* History Thumbnails (Input Mode) */}
                        {(item.data.history && item.data.history.length > 0) && (
                            <div 
                                className="absolute top-4 left-4 flex gap-2 z-40 max-w-[80%] overflow-x-auto no-scrollbar p-1"
                                onMouseDown={e => e.stopPropagation()}
                                onTouchStart={e => e.stopPropagation()}
                            >
                                {item.data.history.map((histSrc, idx) => (
                                    <div key={idx} className="relative group/thumb">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); switchGeneratorVersion(item.id, idx); }}
                                            className={`w-10 h-10 rounded-lg overflow-hidden border-2 shadow-sm transition-all duration-200 hover:scale-110 flex-shrink-0 ${
                                                (item.data.historyIndex ?? (item.data.history ? item.data.history.length - 1 : 0)) === idx 
                                                ? 'border-blue-500 ring-2 ring-blue-500/20 scale-105' 
                                                : 'border-white/40 opacity-60 hover:opacity-100 hover:border-white'
                                            }`}
                                            title={`Version ${idx + 1}`}
                                        >
                                            <img src={histSrc} className="w-full h-full object-cover pointer-events-none" />
                                        </button>
                                        <button 
                                            onClick={(e) => removeGeneratorVersion(item.id, idx, e)}
                                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-md hover:bg-rose-600 scale-75 group-hover/thumb:scale-100"
                                        >
                                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                         <textarea 
                            rows={6}
                            className={`w-full flex-1 bg-transparent font-medium text-slate-800 placeholder:text-slate-300/80 resize-none focus:outline-none text-center leading-tight tracking-tight font-sans transition-all duration-200 break-words ${getAdaptiveFontSize(item.data.prompt)}`}
                            placeholder={item.data.model === 'flux' ? "Type to create..." : "SDXL Prompt..."}
                            value={item.data.prompt}
                            onChange={(e) => updateItemData(item.id, { prompt: e.target.value })}
                        />
                        {item.data.model === 'sdxl' && (
                            <input 
                                className="w-full bg-transparent border-t border-slate-100 mt-4 pt-4 text-sm text-slate-500 placeholder:text-slate-300 focus:outline-none text-center font-mono"
                                placeholder="Negative prompt..."
                                value={item.data.negPrompt}
                                onChange={(e) => updateItemData(item.id, { negPrompt: e.target.value })}
                            />
                        )}

                         {/* New LoRA Toggle for Flux */}
                        {item.data.model === 'flux' && (
                             <div 
                                className="mt-4 flex items-center gap-3 cursor-pointer group/lora bg-slate-50/50 hover:bg-slate-50 px-4 py-2 rounded-full border border-slate-100/50 transition-colors"
                                onClick={() => updateItemData(item.id, { useLora: !(item.data.useLora ?? true) })}
                             >
                                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${item.data.useLora !== false ? 'text-indigo-500' : 'text-slate-300'}`}>
                                    Cartoon LoRA
                                </span>
                                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-300 ${item.data.useLora !== false ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                                    <div className={`w-3 h-3 rounded-full bg-white shadow-sm transform transition-transform duration-300 ${item.data.useLora !== false ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                             </div>
                        )}
                    </div>
                ) : (
                    <div 
                        className="w-full h-full relative group/image bg-white overflow-hidden"
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            if(item.data.resultImage) {
                                const originalSrc = item.data.history && item.data.history.length > 0 ? item.data.history[0] : (item.data.resultImage || '');
                                setEditingImage({ id: item.id, src: item.data.resultImage, originalSrc });
                            }
                        }}
                    >
                         {/* History Thumbnails (Result Mode) */}
                        {(item.data.history && item.data.history.length > 1) && (
                            <div 
                                className="absolute top-4 left-4 flex gap-2 z-40 max-w-[80%] overflow-x-auto no-scrollbar p-1"
                                onMouseDown={e => e.stopPropagation()}
                                onTouchStart={e => e.stopPropagation()}
                            >
                                {item.data.history.map((histSrc, idx) => (
                                    <div key={idx} className="relative group/thumb">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); switchGeneratorVersion(item.id, idx); }}
                                            className={`w-10 h-10 rounded-lg overflow-hidden border-2 shadow-sm transition-all duration-200 hover:scale-110 flex-shrink-0 ${
                                                (item.data.historyIndex ?? (item.data.history ? item.data.history.length - 1 : 0)) === idx 
                                                ? 'border-blue-500 ring-2 ring-blue-500/20 scale-105' 
                                                : 'border-white/40 opacity-60 hover:opacity-100 hover:border-white'
                                            }`}
                                            title={`Version ${idx + 1}`}
                                        >
                                            <img src={histSrc} className="w-full h-full object-cover pointer-events-none" />
                                        </button>
                                        <button 
                                            onClick={(e) => removeGeneratorVersion(item.id, idx, e)}
                                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-md hover:bg-rose-600 scale-75 group-hover/thumb:scale-100"
                                        >
                                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Center image with object-contain to prevent cropping */}
                        <div className="w-full h-full flex items-center justify-center bg-slate-50/50">
                            <img 
                                src={item.data.resultImage} 
                                className="max-w-full max-h-full object-contain pointer-events-none select-none" 
                                alt="result" 
                            />
                        </div>
                        
                        {renderEditOverlay(
                            !!item.data.isEditing, 
                            item.data.editProgress || 0, 
                            item.data.editPrompt, 
                            (val) => updateItemData(item.id, { editPrompt: val }),
                            () => executeEdit(item.id, item.data.editPrompt || '')
                        )}

                        {/* Actions Bottom Right (Unified with ImageItem) */}
                        <div className={`absolute bottom-6 right-6 z-40 flex flex-col gap-3 items-end transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''}`}>
                             {/* Re-generate Button (Big White Card) */}
                             <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    executeGeneration(item.id);
                                }}
                                className="w-12 h-12 bg-white rounded-2xl shadow-xl shadow-slate-200/50 text-slate-700 flex items-center justify-center hover:scale-110 hover:shadow-2xl hover:text-blue-600 active:scale-95 transition-all group/refresh"
                                title="Re-generate"
                             >
                                <svg className="group-hover/refresh:rotate-180 transition-transform duration-500" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                             </button>

                             {/* Back to Edit Mode Button */}
                             <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    updateItemData(item.id, { mode: 'input' });
                                }}
                                className="w-10 h-10 bg-white/40 backdrop-blur-md border border-white/50 text-slate-700 rounded-xl flex items-center justify-center shadow-lg transition-all hover:bg-white hover:scale-105"
                                title="Edit Prompt"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            
                            {/* Download Button */}
                            <a 
                                href={item.data.resultImage} 
                                download={`gen-${item.id}.png`}
                                className="w-10 h-10 bg-white/40 backdrop-blur-md border border-white/50 text-slate-700 rounded-xl flex items-center justify-center shadow-lg transition-all hover:bg-white hover:scale-105"
                                onClick={e => e.stopPropagation()}
                                title="Download"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                )}
            </div>

            {isInput && !item.data.isGenerating && (
                <div className={`absolute top-full left-0 w-full flex justify-center pt-8 opacity-0 group-hover:opacity-100 transition-all duration-500 transform -translate-y-4 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto z-50 ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : ''}`}>
                    <button 
                        onClick={() => executeGeneration(item.id)}
                        className="bg-slate-900 text-white px-8 py-3 rounded-full shadow-2xl shadow-slate-900/20 text-xs font-bold tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-3 uppercase"
                    >
                        <span>Generate</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </button>
                </div>
            )}
            
            <button 
             className={`absolute -top-2 -right-2 z-50 bg-white text-rose-500 w-8 h-8 flex items-center justify-center rounded-full shadow-lg border border-slate-100 transition-all duration-200 hover:scale-110 hover:bg-rose-50 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 ${isActive ? 'opacity-100 scale-100' : ''}`}
             onClick={(e) => removeItem(item.id, e)}
             onMouseDown={e => e.stopPropagation()}
             onTouchStart={e => e.stopPropagation()}
           >
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
           
           {renderResizeHandle(item.id)}
        </div>
      );
  };

  return (
    <div className="h-full w-full relative overflow-hidden flex font-sans selection:bg-slate-200">
      <style>{`
          @keyframes flowAnimation {
              from { stroke-dashoffset: 20; }
              to { stroke-dashoffset: 0; }
          }
          .animate-flow {
              animation: flowAnimation 0.8s linear infinite;
              will-change: stroke-dashoffset;
          }
      `}</style>

      <div className="flex-1 relative h-full">
          {/* Dot Pattern Background */}
          <div 
            className="absolute inset-0 pointer-events-none canvas-bg"
            style={{
                opacity: 0.15,
                backgroundImage: 'radial-gradient(#64748b 1.5px, transparent 1.5px)',
                backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`,
                backgroundPosition: `${view.x}px ${view.y}px`
            }}
          />
          
          <div 
            ref={containerRef}
            className={`absolute inset-0 canvas-bg ${isSpacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
              <div 
                className="absolute origin-top-left will-change-transform"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
              >
                  {showConnections && renderConnections()}

                  {items.map(item => (
                      <div
                        key={item.id}
                        className={`absolute group transition-shadow duration-300 rounded-3xl ${
                            selectedIds.has(item.id) 
                            ? 'shadow-blue-500/30 ring-4 ring-blue-500 ring-offset-4 ring-offset-transparent shadow-2xl z-20' 
                            : activeItemId === item.id 
                                ? 'shadow-xl z-10' 
                                : ''
                        }`}
                        style={{
                            left: item.x,
                            top: item.y,
                            width: item.width,
                            height: item.height,
                            zIndex: item.zIndex,
                        }}
                        onMouseDown={(e) => handleItemMouseDown(e, item.id)}
                        onTouchStart={(e) => handleItemTouchStart(e, item.id)}
                      >
                          {item.type === 'image' && renderImageNode(item as ImageItem)}
                          {item.type === 'generator' && renderGeneratorNode(item as GeneratorItem)}
                          {item.type === 'editor' && renderEditNode(item as EditorItem)}
                      </div>
                  ))}
                  
                  {items.length === 0 && (
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center mix-blend-multiply">
                          <h1 className="text-4xl font-light text-slate-900/10 tracking-tight mb-2">ComfyUI Studio</h1>
                          <p className="text-sm font-mono text-slate-900/20 tracking-widest uppercase">Canvas Empty</p>
                      </div>
                  )}
              </div>
              
              {selectionBox && (
                  <div 
                      className="absolute border-2 border-blue-500 bg-blue-500/10 backdrop-blur-[1px] rounded-lg pointer-events-none z-50 transition-none"
                      style={{
                          left: Math.min(selectionBox.startX, selectionBox.currentX),
                          top: Math.min(selectionBox.startY, selectionBox.currentY),
                          width: Math.abs(selectionBox.currentX - selectionBox.startX),
                          height: Math.abs(selectionBox.currentY - selectionBox.startY)
                      }}
                  />
              )}
          </div>

          {/* Minimalist Server Config */}
          <div className="absolute top-6 left-6 z-50 group">
               <div className="flex items-center bg-white/30 backdrop-blur-md rounded-full border border-white/20 shadow-sm transition-all duration-500 ease-out p-1.5 hover:bg-white hover:shadow-lg hover:border-white/60 focus-within:bg-white focus-within:shadow-lg focus-within:border-white/60 cursor-pointer">
                   {/* Status Dot */}
                   <div className={`w-3 h-3 rounded-full shadow-inner ${serverUrl ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-red-400 shadow-red-400/50'} shrink-0`} />
                   
                   {/* Input Field (Hidden by default, reveals on hover/focus) */}
                   <div className="w-0 overflow-hidden group-hover:w-56 focus-within:w-56 transition-all duration-500 ease-out opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                       <input 
                        value={serverUrl} 
                        onChange={e => setServerUrl(e.target.value)}
                        className="bg-transparent border-none text-[10px] font-mono text-slate-600 w-full pl-3 pr-2 focus:outline-none placeholder:text-slate-300 h-full"
                        placeholder="Server URL"
                       />
                   </div>
               </div>
          </div>

          {/* Clean Zoom Controls */}
          <div className="absolute bottom-8 left-8 flex gap-3 z-50">
               <div className="glass-panel p-1 rounded-full flex gap-1 shadow-lg bg-white/80">
                  <button className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-500 transition-colors" onClick={() => setView(prev => ({ ...prev, scale: Math.max(prev.scale / 1.2, 0.1) }))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                  <span className="flex items-center justify-center w-12 text-[10px] font-mono text-slate-400">{Math.round(view.scale * 100)}%</span>
                  <button className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-500 transition-colors" onClick={() => setView(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, 5) }))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
               </div>
               <button 
                className="w-10 h-10 bg-white rounded-full text-slate-600 hover:text-slate-900 hover:shadow-lg transition-all shadow-md flex items-center justify-center"
                onClick={() => setView({ x: 0, y: 0, scale: 1 })}
               >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
               </button>
          </div>

          {/* Connection Toggle (Bottom Right) */}
          <div className="absolute bottom-8 right-8 z-50">
            <button 
                className={`w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${showConnections ? 'text-blue-600 shadow-blue-200' : 'text-slate-400'}`}
                onClick={() => setShowConnections(!showConnections)}
                title={showConnections ? "Hide Connections" : "Show Connections"}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showConnections ? (
                        <>
                            <circle cx="18" cy="5" r="3"></circle>
                            <circle cx="6" cy="12" r="3"></circle>
                            <circle cx="18" cy="19" r="3"></circle>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                        </>
                    ) : (
                        <>
                            <path d="M18 5a3 3 0 1 0-3 3"/>
                            <path d="M6 12a3 3 0 1 0 3 3"/>
                            <path d="M18 19a3 3 0 1 0-3-3"/>
                            <line x1="8.59" y1="13.51" x2="10" y2="14.33" opacity="0.3"></line>
                            <line x1="15.41" y1="6.51" x2="14" y2="7.33" opacity="0.3"></line>
                            <line x1="2" y1="2" x2="22" y2="22" className="text-slate-300"></line>
                        </>
                    )}
                </svg>
            </button>
          </div>

          {/* Elegant FAB */}
          <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 flex flex-row items-center gap-6 group">
               <button className="w-14 h-14 bg-slate-900 rounded-2xl shadow-2xl shadow-slate-900/30 flex items-center justify-center text-white transition-all duration-500 group-hover:rotate-90 hover:scale-110 active:scale-95 shrink-0 z-20">
                   <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
               </button>

               <div className="flex flex-col gap-3 items-start opacity-0 group-hover:opacity-100 transition-all duration-500 transform -translate-x-4 group-hover:translate-x-0 pointer-events-none group-hover:pointer-events-auto">
                   <button onClick={addGeneratorNode} className="flex items-center gap-4 group/item pl-2">
                       <div className="w-10 h-10 bg-white rounded-xl shadow-lg flex items-center justify-center text-slate-400 group-hover/item:text-slate-900 group-hover/item:scale-110 transition-all border border-slate-100">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"></path><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"></polygon></svg>
                       </div>
                       <span className="text-xs font-medium text-slate-500 bg-white/80 backdrop-blur px-3 py-1.5 rounded-lg shadow-sm whitespace-nowrap opacity-0 group-hover/item:opacity-100 transition-opacity translate-x-[-10px] group-hover/item:translate-x-0">Text to Image</span>
                   </button>
                   
                   <input type="file" id="fab-upload" className="hidden" accept="image/*" onChange={handleUpload} />
                   
                   <label htmlFor="fab-upload" className="flex items-center gap-4 cursor-pointer group/item pl-2">
                       <div className="w-10 h-10 bg-white rounded-xl shadow-lg flex items-center justify-center text-slate-400 group-hover/item:text-slate-900 group-hover/item:scale-110 transition-all border border-slate-100">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                       </div>
                       <span className="text-xs font-medium text-slate-500 bg-white/80 backdrop-blur px-3 py-1.5 rounded-lg shadow-sm whitespace-nowrap opacity-0 group-hover/item:opacity-100 transition-opacity translate-x-[-10px] group-hover/item:translate-x-0">Upload Image</span>
                   </label>
               </div>
          </div>
          
          {/* Image Editor */}
          {editingImage && (
             <ImageEditor 
                src={editingImage.src} 
                originalSrc={editingImage.originalSrc}
                onSave={handleEditorSave} 
                onCancel={() => setEditingImage(null)} 
             />
          )}

          {/* Lightbox Preview */}
          {previewImage && (
             <div 
               className="fixed inset-0 z-[100] bg-slate-50/90 backdrop-blur-xl flex items-center justify-center p-8 animate-fade-in"
               onClick={() => setPreviewImage(null)}
             >
                 <button 
                    className="absolute top-8 right-8 text-slate-400 hover:text-slate-900 transition-colors bg-white rounded-full p-2 shadow-sm"
                    onClick={() => setPreviewImage(null)}
                 >
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                 </button>

                 <div className="relative max-w-[95vw] max-h-[95vh] flex gap-8 shadow-2xl rounded-3xl bg-white p-2" onClick={e => e.stopPropagation()}>
                    <img 
                       src={previewImage.src} 
                       className="max-w-[85vw] max-h-[90vh] object-contain rounded-2xl bg-slate-100"
                       onLoad={(e) => {
                           const img = e.target as HTMLImageElement;
                           setPreviewImage(prev => prev ? { ...prev, dims: { w: img.naturalWidth, h: img.naturalHeight } } : null);
                       }}
                    />
                    
                    {/* Dimensions Badge */}
                    {previewImage.dims && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-slate-900/80 backdrop-blur-md rounded-full shadow-2xl border border-white/10 text-white z-50 animate-fade-in pointer-events-none select-none">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dimensions</span>
                            <div className="w-px h-3 bg-white/20"></div>
                            <span className="text-xs font-mono font-medium tracking-wider">
                                {previewImage.dims.w} <span className="text-slate-500">×</span> {previewImage.dims.h}
                            </span>
                        </div>
                    )}
                 </div>
             </div>
          )}
      </div>
    </div>
  );
};

export default InfiniteCanvasTab;
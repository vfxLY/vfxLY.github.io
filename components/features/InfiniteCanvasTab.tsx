import React, { useState, useRef, useEffect, MouseEvent, WheelEvent, DragEvent, useCallback } from 'react';
import Button from '../ui/Button';
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

interface ImageItem extends BaseItem {
  type: 'image';
  src: string;
  // Edit state
  editPrompt?: string;
  isEditing?: boolean;
  editProgress?: number;
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
    // Edit state for result
    editPrompt?: string;
    isEditing?: boolean;
    editProgress?: number;
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

const InfiniteCanvasTab: React.FC<InfiniteCanvasTabProps> = ({ serverUrl, setServerUrl }) => {
  // --- State ---
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  
  // Selection State
  const [activeItemId, setActiveItemId] = useState<string | null>(null); // The one currently being edited/focused
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // Multi-selection set
  const [activeSizeMenuId, setActiveSizeMenuId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  
  // Copy/Paste State
  const [clipboard, setClipboard] = useState<CanvasItem[]>([]);
  
  // Dragging State
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<'canvas' | 'item' | 'selection'>('canvas');
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Mouse Tracking for Paste
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Preview Image State
  const [previewImage, setPreviewImage] = useState<{ src: string; dims?: { w: number; h: number } } | null>(null);

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
        if (e.key === 'Escape' && previewImage) {
            setPreviewImage(null);
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
  }, [selectedIds, items, clipboard, previewImage]);

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
      setSelectionBox(null);
      setDragMode('canvas'); 
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

            const newItem: ImageItem = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'image',
                x: x - (img.width / 4), 
                y: y - (img.height / 4),
                width: img.width / 2,
                height: img.height / 2,
                zIndex: topZ + 1,
                src
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
              steps: 20,
              cfg: 3.5,
              isGenerating: false,
              progress: 0,
              mode: 'input'
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
            const newItem: ImageItem = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'image',
                x: ((-view.x) + (window.innerWidth / 2) - (img.width/4)) / view.scale,
                y: ((-view.y) + (window.innerHeight / 2) - (img.height/4)) / view.scale,
                width: img.width / 2,
                height: img.height / 2,
                zIndex: topZ + 1,
                src
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

  const removeItem = (id: string, e: MouseEvent) => {
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

  // --- Generation Logic ---

  const convertSrcToFile = async (src: string): Promise<File> => {
    const res = await fetch(src);
    const blob = await res.blob();
    return new File([blob], "source.png", { type: "image/png" });
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
          const workflow = generateEditWorkflow(prompt, serverFileName, 20, 2.5);
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
                                      src: imgUrl
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
                  workflow = generateFluxWorkflow(data.prompt, data.width, data.height, data.steps, true);
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
                                      updateItemData(itemId, { 
                                          isGenerating: false, 
                                          progress: 100, 
                                          resultImage: imgUrl, 
                                          mode: 'result'
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
                                              src: imgUrl
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
        className={`absolute bottom-6 left-6 right-6 transition-all duration-300 z-50 ${isEditing ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100'}`}
        onMouseDown={e => e.stopPropagation()}
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

  const renderImageNode = (item: ImageItem) => (
      <div 
        className="relative group w-full h-full rounded-3xl shadow-glass hover:shadow-glass-hover transition-all duration-500 select-none bg-white overflow-hidden"
        onDoubleClick={(e) => {
            e.stopPropagation();
            setPreviewImage({ src: item.src });
        }}
      >
          {/* Added background to handle aspect ratio differences cleanly */}
          <div className="w-full h-full flex items-center justify-center bg-slate-50">
            <img 
                src={item.src} 
                alt="uploaded" 
                className="max-w-full max-h-full object-contain pointer-events-none select-none"
            />
          </div>
          
           <button 
             className="absolute -top-3 -right-3 z-50 bg-white text-rose-500 w-8 h-8 flex items-center justify-center rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-110 hover:bg-rose-50"
             onClick={(e) => removeItem(item.id, e)}
             onMouseDown={e => e.stopPropagation()}
           >
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>

          {renderEditOverlay(
              !!item.isEditing, 
              item.editProgress || 0, 
              item.editPrompt, 
              (val) => updateImageItem(item.id, { editPrompt: val }),
              () => executeEdit(item.id, item.editPrompt || '')
          )}

          <a 
              href={item.src} 
              download={`img-${item.id}.png`}
              className="absolute top-4 left-4 p-2 bg-white/20 backdrop-blur-md border border-white/30 text-white rounded-xl opacity-0 group-hover:opacity-100 hover:bg-white/40 transition-all"
              onClick={e => e.stopPropagation()}
          >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </a>
      </div>
  );

  const renderGeneratorNode = (item: GeneratorItem) => {
      const isInput = item.data.mode === 'input';

      return (
        <div 
          className="relative group w-full h-full flex flex-col transition-all duration-300"
          onMouseDown={e => {
            if ((e.target as HTMLElement).tagName === 'TEXTAREA') {
               e.stopPropagation();
            }
          }}
        >
            {isInput && (
                <div className="absolute bottom-full left-0 w-full flex justify-center pb-6 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto z-50">
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
                    <div className="w-full h-full p-8 flex flex-col items-center justify-center">
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
                    </div>
                ) : (
                    <div 
                        className="w-full h-full relative group/image bg-white overflow-hidden"
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            if(item.data.resultImage) setPreviewImage({ src: item.data.resultImage });
                        }}
                    >
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

                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 z-30">
                             {/* Re-generate Button */}
                             <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    executeGeneration(item.id);
                                }}
                                className="bg-white/80 text-slate-700 p-2.5 rounded-xl backdrop-blur-md shadow-lg hover:bg-white hover:scale-105 transition-all"
                                title="Re-generate"
                             >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                             </button>

                             {/* Back to Edit Mode Button */}
                             <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    updateItemData(item.id, { mode: 'input' });
                                }}
                                className="bg-white/80 text-slate-700 p-2.5 rounded-xl backdrop-blur-md shadow-lg hover:bg-white hover:scale-105 transition-all"
                                title="Edit Prompt"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            
                            {/* Download Button */}
                            <a 
                                href={item.data.resultImage} 
                                download={`gen-${item.id}.png`}
                                className="bg-white/80 text-slate-700 p-2.5 rounded-xl backdrop-blur-md shadow-lg hover:bg-white hover:scale-105 transition-all"
                                onClick={e => e.stopPropagation()}
                                title="Download"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                )}
            </div>

            {isInput && !item.data.isGenerating && (
                <div className="absolute top-full left-0 w-full flex justify-center pt-8 opacity-0 group-hover:opacity-100 transition-all duration-500 transform -translate-y-4 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto z-50">
                    <button 
                        onClick={() => executeGeneration(item.id)}
                        className="bg-slate-900 text-white px-8 py-3 rounded-full shadow-2xl shadow-slate-900/20 text-xs font-bold tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-3 uppercase"
                    >
                        <span>Generate</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </button>
                </div>
            )}
        </div>
      );
  };

  const renderEditNode = (item: EditorItem) => {
      const targetImage = items.find(i => i.id === item.data.targetId && i.type === 'image') as ImageItem | undefined;

      return (
        <div 
            className="w-full h-full flex flex-col p-6 glass-panel rounded-3xl shadow-glass hover:shadow-glass-hover transition-all duration-300 animate-fade-in"
            onMouseDown={e => e.stopPropagation()}
        >
            <div className="flex justify-between items-center mb-6">
                <span className="text-[10px] font-bold tracking-widest px-2 py-1 bg-slate-100 text-slate-600 rounded uppercase">Editor</span>
                <div className="text-[10px] font-mono text-slate-300">ID-{item.id.substr(0,4)}</div>
            </div>

            <div className="mb-6">
                {targetImage ? (
                    <div className="flex items-center gap-4 p-3 bg-white/50 border border-white/60 rounded-2xl shadow-sm">
                        <img src={targetImage.src} className="w-12 h-12 rounded-xl object-cover bg-white shadow-sm" alt="target" />
                        <span className="text-xs text-slate-600 font-medium truncate flex-1 font-mono">Input Image</span>
                        <button onClick={() => updateItemData(item.id, { targetId: null })} className="text-slate-400 hover:text-slate-800 transition-colors">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                ) : (
                    <div className="h-24 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center hover:border-slate-300 transition-colors">
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mb-2">Connect Source</span>
                        <div className="flex gap-1">
                            {items.filter(i => i.type === 'image').slice(0, 3).map(img => (
                                <div 
                                    key={img.id} 
                                    className="w-6 h-6 rounded-full overflow-hidden border border-white shadow-sm cursor-pointer hover:scale-125 transition-transform"
                                    onClick={() => updateItemData(item.id, { targetId: img.id })}
                                >
                                    <img src={(img as ImageItem).src} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1">
                <textarea 
                    className="w-full p-4 bg-slate-50/50 border border-slate-100 rounded-2xl text-sm font-medium focus:bg-white focus:shadow-md outline-none resize-none h-32 transition-all placeholder:text-slate-300"
                    placeholder="Describe changes..."
                    value={item.data.prompt}
                    onChange={(e) => updateItemData(item.id, { prompt: e.target.value })}
                />
            </div>

            <div className="mt-6">
                {item.data.isGenerating ? (
                     <div className="h-10 w-full bg-slate-100 rounded-xl overflow-hidden relative">
                         <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-500 tracking-widest z-10">
                             PROCESSING {item.data.progress}%
                         </div>
                         <div className="h-full bg-slate-200/50 transition-all duration-300" style={{ width: `${item.data.progress}%` }}></div>
                     </div>
                 ) : (
                     <Button 
                        onClick={() => executeGeneration(item.id)} 
                        className="py-3 text-xs tracking-widest uppercase bg-slate-100 text-slate-800 hover:bg-slate-900 hover:text-white transition-colors w-full rounded-xl font-bold shadow-sm" 
                        disabled={!item.data.targetId}
                    >
                        Apply Edit
                     </Button>
                 )}
            </div>
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
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
              <div 
                className="absolute origin-top-left will-change-transform"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
              >
                  {renderConnections()}

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
                      >
                           {/* Simplified Remove Button (Only visible on hover/select) */}
                           <button 
                             className={`absolute -top-4 -right-4 z-50 bg-white text-rose-500 w-8 h-8 flex items-center justify-center rounded-full shadow-md opacity-0 transition-all duration-200 hover:scale-110 hover:bg-rose-50 ${activeItemId === item.id || selectedIds.has(item.id) ? 'opacity-100 scale-100' : 'group-hover:opacity-100 scale-90 group-hover:scale-100'}`}
                             onClick={(e) => removeItem(item.id, e)}
                             onMouseDown={e => e.stopPropagation()}
                          >
                             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>

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
          <div className="absolute top-6 left-6 group z-50">
               <div className="flex items-center gap-2 bg-white/50 backdrop-blur-md pl-3 pr-1 py-1 rounded-full border border-white/40 shadow-sm transition-all hover:bg-white hover:shadow-md">
                   <div className={`w-2 h-2 rounded-full ${serverUrl ? 'bg-emerald-400' : 'bg-red-400'}`}></div>
                   <input 
                    value={serverUrl} 
                    onChange={e => setServerUrl(e.target.value)}
                    className="bg-transparent border-none text-[10px] font-mono text-slate-500 w-24 focus:w-48 transition-all focus:outline-none placeholder:text-slate-300"
                    placeholder="Server URL"
                   />
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
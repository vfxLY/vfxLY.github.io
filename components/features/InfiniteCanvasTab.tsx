import React, { useState, useRef, DragEvent, MouseEvent, WheelEvent } from 'react';

interface InfiniteCanvasTabProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
}

interface CanvasItem {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

interface ImageItem extends CanvasItem {
  type: 'image';
  src: string;
}

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

const InfiniteCanvasTab: React.FC<InfiniteCanvasTabProps> = ({ serverUrl, setServerUrl }) => {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const [topZ, setTopZ] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [itemDragOffset, setItemDragOffset] = useState({ x: 0, y: 0 });

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    // Get all image files from the drop event
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    if (files.length === 0) return;

    // Helper to read file as Data URL
    const readFile = (file: File): Promise<string> => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target?.result as string);
            reader.readAsDataURL(file);
        });
    };

    // Helper to load image to get dimensions
    const loadImageData = (src: string): Promise<{src: string, w: number, h: number}> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ src, w: img.width, h: img.height });
            img.src = src;
        });
    };

    try {
        // 1. Read all files
        const base64Results = await Promise.all(files.map(readFile));
        
        // 2. Load all images to get dimensions
        const loadedImages = await Promise.all(base64Results.map(loadImageData));

        // 3. Calculate starting position in world coordinates
        const rect = containerRef.current?.getBoundingClientRect();
        const clientX = e.clientX - (rect?.left || 0);
        const clientY = e.clientY - (rect?.top || 0);
        
        const startX = (clientX - view.x) / view.scale;
        let currentY = (clientY - view.y) / view.scale;
        
        let currentZ = topZ;
        const newItems: ImageItem[] = [];
        const newIds = new Set<string>();

        // 4. Create items stacked vertically
        loadedImages.forEach((imgData) => {
            currentZ++;
            // Default size is half the original size for better initial fit
            const displayW = imgData.w / 2; 
            const displayH = imgData.h / 2;
            
            const newItem: ImageItem = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'image',
                // Center horizontally based on cursor
                x: startX - (displayW / 2), 
                // Stack vertically
                y: currentY, 
                width: displayW,
                height: displayH,
                zIndex: currentZ,
                src: imgData.src
            };

            newItems.push(newItem);
            newIds.add(newItem.id);

            // Increment Y for the next item (height + 20px gap)
            currentY += displayH + 20;
        });

        // 5. Update state
        setTopZ(currentZ);
        setItems(prev => [...prev, ...newItems]);
        setSelectedIds(newIds);
        // Set the last item as active
        if (newItems.length > 0) {
            setActiveItemId(newItems[newItems.length - 1].id);
        }

    } catch (err) {
        console.error("Error handling drop:", err);
    }
  };

  const handleCanvasMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    // If clicking on background, deselect items
    if (e.target === e.currentTarget) {
        setSelectedIds(new Set());
        setActiveItemId(null);
        setIsDraggingCanvas(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleItemMouseDown = (e: MouseEvent<HTMLDivElement>, id: string) => {
      e.stopPropagation();
      const item = items.find(i => i.id === id);
      if (!item) return;

      // Bring to front if not already
      let newZ = topZ;
      if (item.zIndex !== topZ) {
          newZ = topZ + 1;
          setTopZ(newZ);
          setItems(prev => prev.map(i => i.id === id ? { ...i, zIndex: newZ } : i));
      }

      // Select
      if (!e.shiftKey) {
          setSelectedIds(new Set([id]));
      } else {
          setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
          });
      }
      setActiveItemId(id);

      // Start drag
      setDraggingItemId(id);
      
      const rect = containerRef.current?.getBoundingClientRect();
      const mouseX = e.clientX - (rect?.left || 0);
      const mouseY = e.clientY - (rect?.top || 0);
      const worldMouseX = (mouseX - view.x) / view.scale;
      const worldMouseY = (mouseY - view.y) / view.scale;

      setItemDragOffset({
          x: worldMouseX - item.x,
          y: worldMouseY - item.y
      });
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
      if (isDraggingCanvas) {
          const dx = e.clientX - dragStart.x;
          const dy = e.clientY - dragStart.y;
          setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          setDragStart({ x: e.clientX, y: e.clientY });
      } else if (draggingItemId) {
          const rect = containerRef.current?.getBoundingClientRect();
          const mouseX = e.clientX - (rect?.left || 0);
          const mouseY = e.clientY - (rect?.top || 0);
          const worldMouseX = (mouseX - view.x) / view.scale;
          const worldMouseY = (mouseY - view.y) / view.scale;

          setItems(prev => prev.map(item => {
              if (item.id === draggingItemId) {
                  return {
                      ...item,
                      x: worldMouseX - itemDragOffset.x,
                      y: worldMouseY - itemDragOffset.y
                  };
              }
              return item;
          }));
      }
  };

  const handleMouseUp = () => {
      setIsDraggingCanvas(false);
      setDraggingItemId(null);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
          // e.preventDefault(); // React synthetic event doesn't always support preventing default on wheel
          const zoomSensitivity = 0.001;
          const delta = -e.deltaY * zoomSensitivity;
          const newScale = Math.min(Math.max(0.1, view.scale + delta), 5);
          
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          const worldX = (mouseX - view.x) / view.scale;
          const worldY = (mouseY - view.y) / view.scale;
          
          const newX = mouseX - worldX * newScale;
          const newY = mouseY - worldY * newScale;
          
          setView({ x: newX, y: newY, scale: newScale });
      } else {
          setView(prev => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-gray-50 select-none">
        <div 
            ref={containerRef}
            className="w-full h-full absolute inset-0 outline-none"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{ 
                cursor: isDraggingCanvas ? 'grabbing' : 'default',
                backgroundImage: 'radial-gradient(#ddd 1px, transparent 1px)',
                backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`,
                backgroundPosition: `${view.x}px ${view.y}px`
            }}
        >
            <div 
                style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                    transformOrigin: '0 0',
                    width: '0', 
                    height: '0',
                    position: 'absolute'
                }}
            >
                {items.map(item => (
                    <div
                        key={item.id}
                        className={`absolute group hover:ring-2 hover:ring-blue-300 transition-shadow ${selectedIds.has(item.id) ? 'ring-2 ring-blue-500 shadow-xl' : 'shadow-md'}`}
                        style={{
                            left: item.x,
                            top: item.y,
                            width: item.width,
                            height: item.height,
                            zIndex: item.zIndex,
                            cursor: 'grab'
                        }}
                        onMouseDown={(e) => handleItemMouseDown(e, item.id)}
                    >
                        <img 
                            src={item.src} 
                            alt="canvas-item" 
                            className="w-full h-full object-cover pointer-events-none select-none rounded-lg"
                        />
                        {selectedIds.has(item.id) && (
                            <div className="absolute -top-6 left-0 bg-blue-500 text-white text-xs px-2 py-0.5 rounded">
                                ID: {item.id.substr(0,4)}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
        
        {/* UI Overlay */}
        <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2">
            <div className="bg-white/90 backdrop-blur-sm p-4 rounded-2xl shadow-lg border border-gray-200 pointer-events-auto w-64">
                <h3 className="font-semibold text-gray-800 mb-2">Infinite Canvas</h3>
                <p className="text-xs text-gray-500 mb-4">
                    Drag and drop images anywhere. Scroll to pan, Ctrl+Scroll to zoom.
                </p>
                <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Items: {items.length}</span>
                    <span>Zoom: {(view.scale * 100).toFixed(0)}%</span>
                </div>
                <button 
                    onClick={() => { setItems([]); setView({x:0, y:0, scale:1}); }}
                    className="mt-3 w-full py-1.5 px-3 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 transition-colors"
                >
                    Clear Canvas
                </button>
            </div>
        </div>
    </div>
  );
};

export default InfiniteCanvasTab;
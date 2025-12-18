import React, { useState, useRef, useEffect, useCallback } from 'react';
import Button from '../ui/Button';

interface ImageEditorProps {
  src: string;
  originalSrc?: string; 
  onSave: (newSrc: string) => void;
  onCancel: () => void;
}

type Tool = 'brush' | 'crop';

const ImageEditor: React.FC<ImageEditorProps> = ({ src, originalSrc, onSave, onCancel }) => {
  const [tool, setTool] = useState<Tool>('brush');
  const [brushColor, setBrushColor] = useState('#3b82f6');
  const [brushSize, setBrushSize] = useState(10);
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  
  const isPanningRef = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const cropStartPos = useRef<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingLayerRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const pushToHistory = useCallback(() => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(dataUrl);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const loadInitialImage = useCallback((customSrc?: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = customSrc || src;
    img.onload = () => {
      if (canvasRef.current && drawingLayerRef.current && viewportRef.current) {
        const canvas = canvasRef.current;
        const drawLayer = drawingLayerRef.current;
        const viewport = viewportRef.current;

        canvas.width = img.width;
        canvas.height = img.height;
        drawLayer.width = img.width;
        drawLayer.height = img.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        }
        
        const dataUrl = canvas.toDataURL();
        setHistory([dataUrl]);
        setHistoryIndex(0);

        const viewRect = viewport.getBoundingClientRect();
        const padding = 120;
        const availableW = viewRect.width - padding;
        const availableH = viewRect.height - padding;

        const scaleX = availableW / img.width;
        const scaleY = availableH / img.height;
        const fitScale = Math.min(scaleX, scaleY, 0.85);
        
        setZoom(fitScale);
        setOffset({ x: 0, y: 0 });
        setCropRect(null);
      }
    };
  }, [src]);

  useEffect(() => {
    loadInitialImage();
  }, [loadInitialImage]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });
    window.addEventListener('mouseup', handleGlobalMouseUp, { capture: true });

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp, { capture: true });
    };
  }, []);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const img = new Image();
      img.src = history[prevIndex];
      img.onload = () => {
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.drawImage(img, 0, 0);
          setHistoryIndex(prevIndex);
        }
      };
    }
  }, [history, historyIndex]);

  const handleResetToInitial = () => {
    if (window.confirm('确定要去除所有画笔修改，还原到初始图像吗？')) {
      loadInitialImage(src);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isPanningRef.current) return;
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 0.9;
    setZoom(prev => Math.min(Math.max(0.05, prev * factor), 15));
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingLayerRef.current) return { x: 0, y: 0 };
    const canvas = drawingLayerRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startAction = (e: React.MouseEvent | React.TouchEvent) => {
    const isTouchEvent = 'touches' in e;
    const clientX = isTouchEvent ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = isTouchEvent ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    const button = 'button' in e ? (e as React.MouseEvent).button : 0;

    if (button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      setIsPanning(true);
      lastMousePos.current = { x: clientX, y: clientY };
      return;
    }

    if (e.currentTarget === viewportRef.current) return;
    if (isPanningRef.current) return;

    const { x, y } = getCoordinates(e);
    if (tool === 'brush') {
      setIsDrawing(true);
      const ctx = drawingLayerRef.current?.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = brushColor;
      }
    } else if (tool === 'crop') {
      setIsCropping(true);
      cropStartPos.current = { x, y };
      setCropRect({ x, y, w: 0, h: 0 });
    }
  };

  const moveAction = (e: React.MouseEvent | React.TouchEvent) => {
    if (isPanningRef.current) return;
    const { x, y } = getCoordinates(e);
    if (isDrawing && tool === 'brush') {
      const ctx = drawingLayerRef.current?.getContext('2d');
      if (ctx) {
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    } else if (isCropping && tool === 'crop' && cropStartPos.current) {
      setCropRect({
        x: Math.min(x, cropStartPos.current.x),
        y: Math.min(y, cropStartPos.current.y),
        w: Math.abs(x - cropStartPos.current.x),
        h: Math.abs(y - cropStartPos.current.y)
      });
    }
  };

  const endAction = () => {
    if (isDrawing && tool === 'brush') {
      setIsDrawing(false);
      if (canvasRef.current && drawingLayerRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.drawImage(drawingLayerRef.current, 0, 0);
        const dCtx = drawingLayerRef.current.getContext('2d');
        dCtx?.clearRect(0, 0, drawingLayerRef.current.width, drawingLayerRef.current.height);
        pushToHistory();
      }
    } else if (isCropping && tool === 'crop') {
      setIsCropping(false);
    }
  };

  const handleSave = () => {
    if (!canvasRef.current) return;
    if (tool === 'crop' && cropRect && cropRect.w > 5 && cropRect.h > 5) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = cropRect.w;
      tempCanvas.height = cropRect.h;
      const tCtx = tempCanvas.getContext('2d');
      tCtx?.drawImage(canvasRef.current, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
      onSave(tempCanvas.toDataURL('image/png'));
    } else {
      onSave(canvasRef.current.toDataURL('image/png'));
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-white/40 backdrop-blur-[50px] flex flex-col font-sans animate-fade-in select-none overflow-hidden text-slate-900">
      {/* Top Capsule - Minimalist Control Bar */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl h-14 flex items-center justify-between z-[220] px-6 rounded-full bg-white/80 border border-white shadow-2xl">
        <div className="flex items-center gap-6">
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-900 transition-colors p-2 hover:bg-slate-100 rounded-full" title="关闭编辑器">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <div className="h-4 w-[1px] bg-slate-200" />
          <div className="flex flex-col min-w-[70px]">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">Editor</span>
            <span className="text-xs font-bold text-slate-900">{tool === 'brush' ? '涂画' : '裁剪'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleUndo} disabled={historyIndex <= 0} className="px-3 py-2 text-[10px] font-bold text-slate-400 hover:text-slate-900 disabled:opacity-20 transition-all flex items-center gap-2" title="撤销上一步">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-15 9 9 0 0 0-6 2.3L3 7"></path></svg>
            撤销
          </button>
          <div className="w-[1px] h-4 bg-slate-100 mx-1" />
          <button onClick={handleResetToInitial} className="px-4 py-2 text-[10px] font-bold text-rose-500 hover:bg-rose-50 rounded-full transition-all flex items-center gap-2 border border-transparent hover:border-rose-100" title="去除本次所有画笔和修改">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            还原初始
          </button>
          <div className="w-[1px] h-4 bg-slate-100 mx-1" />
          <Button className="!w-auto !py-1.5 !px-6 !rounded-full !bg-slate-950 !text-white !text-[11px] !font-bold hover:!bg-black transition-all shadow-lg" onClick={handleSave}>
            保存修改
          </Button>
        </div>
      </div>

      {/* Floating Left Toolbar */}
      <div className="absolute left-10 top-1/2 -translate-y-1/2 flex flex-col gap-3 p-2 rounded-3xl bg-white/80 border border-white shadow-2xl z-[220]">
        <button 
          onClick={() => { setTool('brush'); setCropRect(null); }}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${tool === 'brush' ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path></svg>
        </button>
        <button 
          onClick={() => setTool('crop')}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${tool === 'crop' ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg>
        </button>
        <div className="h-[1px] w-8 bg-slate-100 mx-auto my-1" />
        <button onClick={() => setZoom(z => z * 1.2)} className="w-12 h-12 rounded-2xl text-slate-400 hover:text-slate-900 flex items-center justify-center transition-colors">+</button>
        <button onClick={() => setZoom(z => z / 1.2)} className="w-12 h-12 rounded-2xl text-slate-400 hover:text-slate-900 flex items-center justify-center transition-colors">-</button>
      </div>

      {/* Right Settings Panel */}
      <div className="absolute right-10 top-1/2 -translate-y-1/2 w-64 flex flex-col gap-6 p-6 rounded-3xl bg-white/80 border border-white shadow-2xl text-slate-900 z-[220]">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">工具设置</h3>
        
        {tool === 'brush' ? (
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase">画笔粗细</span>
                <span className="text-xs font-mono font-bold">{brushSize}px</span>
              </div>
              <input 
                type="range" min="1" max="100" 
                className="w-full h-1 bg-slate-100 rounded-full appearance-none accent-slate-950 cursor-pointer"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
              />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase block mb-3">色彩选择</span>
              <div className="grid grid-cols-5 gap-2">
                {['#3b82f6', '#ef4444', '#10b981', '#ffffff', '#000000'].map(c => (
                  <button 
                    key={c}
                    className={`w-7 h-7 rounded-full border border-slate-200 transition-all ${brushColor === c ? 'ring-2 ring-slate-950 scale-110 shadow-sm' : 'opacity-60 hover:opacity-100'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setBrushColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50/50 rounded-2xl border border-slate-100">
              <span className="text-[9px] font-bold text-slate-400 uppercase block mb-2 tracking-widest">选中区域</span>
              {cropRect ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono"><span className="text-slate-400">宽</span><span className="font-bold">{Math.round(cropRect.w)} px</span></div>
                  <div className="flex justify-between text-[11px] font-mono"><span className="text-slate-400">高</span><span className="font-bold">{Math.round(cropRect.h)} px</span></div>
                </div>
              ) : (
                <span className="text-[10px] text-slate-400 italic font-medium">在图像上拖拽选择区域...</span>
              )}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
            <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">视图比例</span>
            <span className="text-[10px] font-mono font-bold text-slate-400">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Viewport Content */}
      <div 
        ref={viewportRef}
        className={`flex-1 relative flex items-center justify-center p-32 overflow-hidden ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
        onWheel={handleWheel}
        onMouseDown={startAction}
        onDoubleClick={() => { setZoom(0.8); setOffset({ x: 0, y: 0 }); }}
      >
        <div 
          className="relative shadow-[0_80px_160px_rgba(0,0,0,0.1)] bg-white origin-center"
          style={{ 
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            minWidth: canvasRef.current?.width ? `${canvasRef.current.width}px` : 'auto',
            minHeight: canvasRef.current?.height ? `${canvasRef.current.height}px` : 'auto'
          }}
        >
          <canvas ref={canvasRef} className="block" />
          <canvas 
            ref={drawingLayerRef} 
            className={`absolute inset-0 w-full h-full block z-10 ${isPanning ? 'pointer-events-none' : (tool === 'brush' ? 'cursor-crosshair' : 'cursor-cell')}`}
            onMouseDown={startAction}
            onMouseMove={moveAction}
            onMouseUp={endAction}
            onMouseLeave={endAction}
          />
          
          {tool === 'crop' && cropRect && (
            <div className="absolute inset-0 pointer-events-none z-20">
              <div 
                className="absolute inset-0 bg-white/20 backdrop-blur-[2px]" 
                style={{
                  clipPath: `polygon(
                    0% 0%, 0% 100%, 
                    ${(cropRect.x / (drawingLayerRef.current?.width || 1)) * 100}% 100%, 
                    ${(cropRect.x / (drawingLayerRef.current?.width || 1)) * 100}% ${(cropRect.y / (drawingLayerRef.current?.height || 1)) * 100}%, 
                    ${((cropRect.x + cropRect.w) / (drawingLayerRef.current?.width || 1)) * 100}% ${(cropRect.y / (drawingLayerRef.current?.height || 1)) * 100}%, 
                    ${((cropRect.x + cropRect.w) / (drawingLayerRef.current?.width || 1)) * 100}% ${((cropRect.y + cropRect.h) / (drawingLayerRef.current?.height || 1)) * 100}%, 
                    ${(cropRect.x / (drawingLayerRef.current?.width || 1)) * 100}% ${((cropRect.y + cropRect.h) / (drawingLayerRef.current?.height || 1)) * 100}%, 
                    ${(cropRect.x / (drawingLayerRef.current?.width || 1)) * 100}% 100%, 
                    100% 100%, 100% 0%
                  )`
                }} 
              />
              <div 
                className="absolute border-2 border-slate-900 shadow-2xl"
                style={{ 
                  left: `${(cropRect.x / (drawingLayerRef.current?.width || 1)) * 100}%`, 
                  top: `${(cropRect.y / (drawingLayerRef.current?.height || 1)) * 100}%`, 
                  width: `${(cropRect.w / (drawingLayerRef.current?.width || 1)) * 100}%`, 
                  height: `${(cropRect.h / (drawingLayerRef.current?.height || 1)) * 100}%` 
                }}
              >
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white rounded-full border border-slate-900 shadow-md" />
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white rounded-full border border-slate-900 shadow-md" />
                <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white rounded-full border border-slate-900 shadow-md" />
                <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white rounded-full border border-slate-900 shadow-md" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[9px] font-bold text-slate-300 tracking-[0.6em] uppercase">
        Studio Editor v2.5
      </div>
    </div>
  );
};

export default ImageEditor;
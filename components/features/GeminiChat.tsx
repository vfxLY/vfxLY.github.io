
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";

interface PendingImage {
  url: string;
  base64: string;
  type: string;
  canvasItemId?: string;
}

interface ChatImage {
  url: string;
  canvasItemId?: string;
}

interface GroundingLink {
  title: string;
  uri: string;
}

interface Message {
  role: 'user' | 'model';
  text: string;
  images?: ChatImage[];
  links?: GroundingLink[];
}

const GeminiChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: '您好！我是您的专业设计助手。已为您接入 Nano Banana Pro (Gemini 3 Pro Image) 引擎，您可以上传或双击画布图像让我进行分析。' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      // Assume success as per instructions to avoid race conditions
      setHasKey(true);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const processImageSource = async (src: string, itemId?: string): Promise<PendingImage | null> => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const reader = new FileReader();
      return new Promise((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve({
            url: reader.result as string,
            base64: base64,
            type: blob.type,
            canvasItemId: itemId
          });
        };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error("Failed to process image source", e);
      return null;
    }
  };

  useEffect(() => {
    const handleAddImage = async (e: any) => {
      const { src, id } = e.detail;
      if (!src) return;
      setIsOpen(true);
      if (pendingImages.length >= 9) return;
      const processed = await processImageSource(src, id);
      if (processed) {
        setPendingImages(prev => {
          if (prev.length >= 9) return prev;
          if (id && prev.some(p => p.canvasItemId === id)) return prev;
          return [...prev, processed];
        });
      }
    };
    window.addEventListener('add-image-to-chat', handleAddImage);
    return () => window.removeEventListener('add-image-to-chat', handleAddImage);
  }, [pendingImages]);

  const handleFocusCanvasItem = (itemId?: string) => {
    if (!itemId) return;
    window.dispatchEvent(new CustomEvent('focus-canvas-item', { detail: { id: itemId } }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remainingSlots = 9 - pendingImages.length;
    const filesToProcess = files.slice(0, remainingSlots);
    for (const file of filesToProcess) {
      const processed = await processImageSource(URL.createObjectURL(file));
      if (processed) setPendingImages(prev => [...prev, processed]);
    }
    e.target.value = '';
  };

  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || isTyping || !hasKey) return;

    const userText = input;
    const currentImages = [...pendingImages];
    const useWebSearch = isWebSearchEnabled;
    
    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { 
      role: 'user', 
      text: userText, 
      images: currentImages.map(img => ({ url: img.url, canvasItemId: img.canvasItemId })) 
    }]);
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const conversationHistory = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const currentParts: any[] = [];
      currentImages.forEach(img => {
        currentParts.push({
          inlineData: {
            mimeType: img.type,
            data: img.base64
          }
        });
      });
      currentParts.push({ text: userText || "请根据提供的图片给出专业的设计建议。" });

      const config: any = {
        systemInstruction: "你是一个顶级的AI设计专家，接入了Gemini 3 Pro Image (Nano Banana Pro) 引擎。你拥有卓越的视觉审美和对复杂提示词的理解能力。你的任务是协助用户优化图像生成、分析设计风格、调整光影与构图。你的回答必须专业、极简且富有洞察力。如果用户提供了多张图片，请综合分析它们的关联性。",
        temperature: 0.7,
      };

      if (useWebSearch) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: [...conversationHistory, { role: 'user', parts: currentParts }],
        config: config
      });

      const aiText = response.text || "抱歉，引擎响应异常，请重试。";
      
      // Extract grounding links if search was used
      const links: GroundingLink[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        chunks.forEach((chunk: any) => {
          if (chunk.web) {
            links.push({ title: chunk.web.title, uri: chunk.web.uri });
          }
        });
      }

      setMessages(prev => [...prev, { role: 'model', text: aiText, links: links.length > 0 ? links : undefined }]);
    } catch (error: any) {
      console.error("Gemini Pro Error:", error);
      if (error.message?.includes("Requested entity was not found")) {
        setHasKey(false);
        setMessages(prev => [...prev, { role: 'model', text: "API Key 已失效或未找到相关实体，请重新关联付费项目。" }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', text: "Pro 引擎连接受阻，请确保您关联的是付费 GCP 项目并检查配额。" }]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="fixed right-8 top-1/2 -translate-y-1/2 w-14 h-14 bg-white border border-white rounded-2xl shadow-2xl flex items-center justify-center text-slate-900 transition-all hover:scale-110 active:scale-95 group z-[100]"
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-500/10 to-purple-500/10 animate-pulse" />
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="group-hover:rotate-12 transition-transform">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {pendingImages.length > 0 && (
             <div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white animate-bounce">
               {pendingImages.length}
             </div>
          )}
        </button>
      )}

      <div className={`fixed right-6 top-6 bottom-6 w-[420px] z-[100] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[450px] opacity-0'}`}>
        <div className="w-full h-full bg-white/70 backdrop-blur-[40px] border border-white/60 rounded-[40px] shadow-[0_32px_80px_-16px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden relative">
          
          <div className="px-8 pt-8 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-950 rounded-xl flex items-center justify-center text-white shadow-lg relative overflow-hidden group/logo">
                <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/20 to-purple-600/20 animate-pulse opacity-0 group-hover/logo:opacity-100 transition-opacity" />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="relative z-10">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                   <h3 className="text-sm font-bold text-slate-900 tracking-tight">AI Assistant</h3>
                   <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[8px] font-black rounded-md border border-amber-200 uppercase tracking-tighter">PRO</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${hasKey ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nano Banana Pro</span>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-colors rounded-full hover:bg-slate-100/50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {hasKey === false ? (
              <div className="h-full flex flex-col items-center justify-center p-12 text-center animate-fade-in">
                <div className="w-16 h-16 bg-blue-50 rounded-[24px] flex items-center justify-center text-blue-600 mb-6 shadow-sm border border-blue-100/50">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-3 tracking-tight">启用专业级视觉引擎</h3>
                <p className="text-xs text-slate-500 mb-8 leading-relaxed px-4">
                  接入 Nano Banana Pro (Gemini 3 Pro Image) 需要关联您的付费 API Key 以解锁高保真图像分析与专业提示词优化。
                </p>
                <button 
                  onClick={handleSelectKey}
                  className="w-full bg-slate-950 text-white px-8 py-3.5 rounded-2xl font-bold text-xs shadow-xl shadow-slate-900/10 hover:scale-[1.02] active:scale-98 transition-all flex items-center justify-center gap-2"
                >
                  <span>选择 API Key</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
                <a 
                  href="https://ai.google.dev/gemini-api/docs/billing" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-6 text-[10px] font-bold text-slate-300 uppercase tracking-widest hover:text-blue-500 transition-colors"
                >
                  计费文档说明
                </a>
              </div>
            ) : (
              <div className="px-8 py-4 space-y-6">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                    <div className={`max-w-[90%] p-4 rounded-3xl text-sm leading-relaxed flex flex-col gap-3 ${
                      msg.role === 'user' 
                        ? 'bg-slate-950 text-white shadow-lg rounded-tr-none' 
                        : 'bg-white/50 border border-white/80 text-slate-800 shadow-sm rounded-tl-none'
                    }`}>
                      {msg.images && msg.images.length > 0 && (
                        <div className={`grid gap-2 ${msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {msg.images.map((img, idx) => (
                            <div 
                              key={idx} 
                              className={`relative group/history-img ${img.canvasItemId ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
                              onDoubleClick={() => handleFocusCanvasItem(img.canvasItemId)}
                            >
                              <img src={img.url} className="w-full rounded-2xl object-cover aspect-square shadow-inner bg-slate-100" />
                              {img.canvasItemId && (
                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/history-img:opacity-100 flex items-center justify-center rounded-2xl transition-opacity">
                                  <span className="text-[10px] font-bold text-white bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm">双击定位</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.text && <div className="whitespace-pre-wrap">{msg.text}</div>}
                      {msg.links && msg.links.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">参考来源:</span>
                          {msg.links.map((link, idx) => (
                            <a key={idx} href={link.uri} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 hover:underline flex items-center gap-1">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                              {link.title || '网页链接'}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-start gap-2 animate-pulse">
                    <div className="bg-white/40 border border-white/60 px-4 py-2 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Processing...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="p-8">
            <div className={`bg-white rounded-[32px] shadow-[0_8px_32px_rgba(0,0,0,0.04)] border border-slate-100 p-3 transition-all focus-within:shadow-xl group ${!hasKey ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
              {pendingImages.length > 0 && (
                <div className="px-3 pt-2 flex gap-2 overflow-x-auto no-scrollbar pb-3 mb-1 border-b border-slate-50">
                  {pendingImages.map((img, idx) => (
                    <div key={idx} className="relative group/preview flex-shrink-0">
                      <div 
                        className={`relative w-16 h-16 rounded-xl overflow-hidden border border-slate-100 shadow-sm transition-all hover:scale-105 ${img.canvasItemId ? 'cursor-pointer border-blue-100 ring-2 ring-blue-500/10' : ''}`}
                        onDoubleClick={() => handleFocusCanvasItem(img.canvasItemId)}
                      >
                        <img src={img.url} className="w-full h-full object-cover" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); removePendingImage(idx); }}
                          className="absolute top-1 right-1 w-5 h-5 bg-slate-950/80 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:bg-black transition-colors z-10"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <textarea 
                rows={3}
                placeholder={pendingImages.length > 0 ? "请描述您的修改建议或分析需求..." : "请输入您的设计需求"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="w-full bg-transparent border-none resize-none focus:outline-none px-4 pt-3 text-sm text-slate-800 placeholder:text-slate-300 font-medium leading-relaxed"
              />
              
              <div className="flex items-center justify-between mt-2 px-1">
                <div className="flex items-center gap-1">
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleImageUpload} />
                  <button onClick={() => fileInputRef.current?.click()} className={`p-2.5 transition-colors rounded-xl ${pendingImages.length >= 9 ? 'text-slate-100' : 'text-slate-300 hover:text-slate-900 hover:bg-slate-50'}`} title="上传图片">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                  </button>
                  <button className="p-2.5 text-slate-300 hover:text-slate-900 transition-colors rounded-xl hover:bg-slate-50" title="提及">
                    <span className="text-lg font-bold">@</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                    className={`p-2.5 transition-all rounded-xl ${isWebSearchEnabled ? 'text-blue-500 bg-blue-50/50 shadow-sm' : 'text-slate-300 hover:text-slate-900 hover:bg-slate-50'}`} 
                    title="联网搜索"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </button>
                  <button className="p-2.5 text-slate-300 hover:text-slate-900 transition-colors rounded-xl hover:bg-slate-50" title="语音输入">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </button>
                  <button 
                    onClick={handleSend}
                    disabled={(input.trim() === '' && pendingImages.length === 0) || isTyping}
                    className={`ml-1 w-10 h-10 rounded-2xl flex items-center justify-center transition-all shadow-md ${
                      (input.trim() || pendingImages.length > 0) && !isTyping 
                        ? 'bg-slate-950 text-white hover:scale-105 active:scale-95' 
                        : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    }`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeminiChat;

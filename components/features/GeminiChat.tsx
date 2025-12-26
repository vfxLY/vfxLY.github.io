
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

interface Message {
  role: 'user' | 'model';
  text: string;
  images?: ChatImage[];
  isError?: boolean;
}

type ModelCategory = 'Image' | 'Video';

interface ModelInfo {
  id: string;
  name: string;
  category: ModelCategory;
  description: string;
  speedTag: string;
  tag: string;
  apiType: 'standard' | 'grsai-draw' | 'grsai-video';
}

const MODELS: ModelInfo[] = [
  // --- Image Models (Grsai Draw API) ---
  { id: 'nano-banana-pro-4k-vip', name: 'Nano Banana Pro 4K VIP', category: 'Image', description: "Ultra HD professional image generation.", speedTag: '30s', tag: '4K-VIP', apiType: 'grsai-draw' },
  { id: 'nano-banana-pro-vip', name: 'Nano Banana Pro VIP', category: 'Image', description: "Enhanced professional model for VIP users.", speedTag: '20s', tag: 'VIP', apiType: 'grsai-draw' },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro', category: 'Image', description: "Flagship balanced image generation.", speedTag: '15s', tag: 'PRO', apiType: 'grsai-draw' },
  { id: 'nano-banana-pro-vt', name: 'Nano Banana Pro VT', category: 'Image', description: "Visualized Thinking enhanced generation.", speedTag: '25s', tag: 'VT', apiType: 'grsai-draw' },
  { id: 'nano-banana-pro-cl', name: 'Nano Banana Pro CL', category: 'Image', description: "Creative Logic specialized model.", speedTag: '18s', tag: 'CL', apiType: 'grsai-draw' },
  { id: 'nano-banana-fast', name: 'Nano Banana Fast', category: 'Image', description: "Optimized for speed and iteration.", speedTag: '1.5s', tag: 'FAST', apiType: 'grsai-draw' },
  { id: 'nano-banana', name: 'Nano Banana', category: 'Image', description: "Standard high-quality image generation.", speedTag: '10s', tag: 'STD', apiType: 'grsai-draw' },
  { id: 'gpt-image-1.5', name: 'GPT Image 1.5', category: 'Image', description: "Next-gen prompt following excellence.", speedTag: '12s', tag: 'GPT', apiType: 'grsai-draw' },
  
  // --- Standard Gemini Models ---
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', category: 'Image', description: "Grsai Gemini 2.0 High Speed.", speedTag: '1s', tag: 'FLASH', apiType: 'standard' },
  { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro', category: 'Image', description: "Stable professional performance.", speedTag: '5s', tag: 'PRO', apiType: 'standard' },

  // --- Video Models (Grsai Video/Sora API) ---
  { id: 'sora-2', name: 'Sora 2.0', category: 'Video', description: "Cinematic photorealistic video generation.", speedTag: '5-10m', tag: 'CINEMA', apiType: 'grsai-video' },
  { id: 'veo3.1-pro', name: 'Veo 3.1 Pro', category: 'Video', description: "Professional grade video creative suite.", speedTag: '6m', tag: 'VEO-PRO', apiType: 'grsai-video' },
  { id: 'veo3.1-fast', name: 'Veo 3.1 Fast', category: 'Video', description: "Fast preview video generation.", speedTag: '2m', tag: 'VEO-FAST', apiType: 'grsai-video' }
];

const GeminiChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>('Image');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  
  const [manualKey, setManualKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');
  const [baseUrl, setBaseUrl] = useState<string>(localStorage.getItem('gemini_api_base') || 'https://api.grsai.com');
  const [selectedModel, setSelectedModel] = useState<string>(localStorage.getItem('gemini_selected_model') || 'nano-banana-pro');
  
  const [tempKey, setTempKey] = useState<string>(manualKey);
  const [tempBase, setTempBase] = useState<string>(baseUrl);
  const [tempModel, setTempModel] = useState<string>(selectedModel);

  const [input, setInput] = useState('');
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: '您好！我是您的专业创作助手。现已完美对接 Grsai 增强接口，支持 Nano Banana 全系列绘画模型。生成图片将直接为您呈现在对话框中。' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<number | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkKey = () => setHasKey(!!(manualKey || process.env.API_KEY));
    checkKey();
  }, [manualKey]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', tempKey.trim());
    localStorage.setItem('gemini_api_base', tempBase.trim());
    localStorage.setItem('gemini_selected_model', tempModel);
    setManualKey(tempKey.trim());
    setBaseUrl(tempBase.trim());
    setSelectedModel(tempModel);
    setIsSettingsOpen(false);
  };

  const currentModelInfo = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    } catch (e) { return null; }
  };

  useEffect(() => {
    const handleAddImage = async (e: any) => {
      const { src, id } = e.detail;
      if (!src) return;
      setIsOpen(true);
      const processed = await processImageSource(src, id);
      if (processed) setPendingImages(prev => [...prev, processed]);
    };
    window.addEventListener('add-image-to-chat', handleAddImage);
    return () => window.removeEventListener('add-image-to-chat', handleAddImage);
  }, []);

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || isTyping || !hasKey) return;
    
    const userText = input;
    const currentImages = [...pendingImages];
    const modelInfo = currentModelInfo;
    
    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(img => ({ url: img.url, canvasItemId: img.canvasItemId })) }]);
    setIsTyping(true);
    setCurrentProgress(0);

    const apiKey = manualKey || process.env.API_KEY || '';
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    try {
      if (modelInfo.apiType === 'grsai-draw') {
        const payload = {
          model: modelInfo.id,
          prompt: userText || "分析并根据图片生成内容",
          aspectRatio: "auto",
          imageSize: "1K",
          urls: currentImages.map(img => `data:${img.type};base64,${img.base64}`)
        };

        const response = await fetch(`${cleanBaseUrl}/v1/draw/nano-banana`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || err.msg || `API Error ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let finalImageUrl = "";
        let buffer = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
              const cleanLine = line.trim();
              if (!cleanLine.startsWith('data:')) continue;
              
              const jsonStr = cleanLine.replace('data:', '').trim();
              if (jsonStr === '[DONE]') break;
              
              try {
                const data = JSON.parse(jsonStr);
                if (data.progress !== undefined) setCurrentProgress(data.progress);
                if (data.results && data.results.length > 0) {
                   const res = data.results[0];
                   if (res.url) finalImageUrl = res.url;
                   if (res.content) fullText = res.content;
                }
              } catch (e) {
                // Ignore chunk errors
              }
            }
          }
        }

        setMessages(prev => [...prev, { 
          role: 'model', 
          text: fullText || (finalImageUrl ? "生成成功！" : "任务已完成"), 
          images: finalImageUrl ? [{ url: finalImageUrl }] : [] 
        }]);

      } else {
        const ai = new GoogleGenAI({ apiKey });
        const conversationHistory = messages.slice(-6).map(m => ({ role: m.role, parts: [{ text: m.text }] }));
        const currentParts: any[] = [];
        currentImages.forEach(img => currentParts.push({ inlineData: { mimeType: img.type, data: img.base64 } }));
        currentParts.push({ text: userText || "分析提供的图片。" });

        const result = await ai.models.generateContent({
          model: modelInfo.id,
          contents: [...conversationHistory, { role: 'user', parts: currentParts }],
          config: { 
            systemInstruction: "你是一个专业的设计与视觉专家。",
            tools: isWebSearchEnabled ? [{ googleSearch: {} }] : undefined 
          }
        });
        setMessages(prev => [...prev, { role: 'model', text: result.text || "引擎未返回有效文本。" }]);
      }
    } catch (error: any) {
      console.error("Chat Error:", error);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: `连接失败：${error.message}`,
        isError: true 
      }]);
    } finally {
      setIsTyping(false);
      setCurrentProgress(null);
    }
  };

  return (
    <>
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-[40px] shadow-2xl overflow-hidden border border-white">
            <div className="p-10 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-2xl font-black text-slate-900">配置中心</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-300 hover:text-slate-900"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="p-10 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Grsai API Key</label>
                <input type="password" placeholder="sk-..." value={tempKey} onChange={(e) => setTempKey(e.target.value)} className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all font-mono text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Base URL (代理地址)</label>
                <input type="text" placeholder="https://api.grsai.com" value={tempBase} onChange={(e) => setTempBase(e.target.value)} className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all font-mono text-sm" />
              </div>
              <button onClick={saveSettings} className="w-full bg-slate-950 text-white py-5 rounded-2xl font-bold shadow-xl shadow-slate-900/20 active:scale-[0.98] transition-all">保存并应用</button>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-8 top-1/2 -translate-y-1/2 w-16 h-16 bg-white border border-white rounded-3xl shadow-2xl flex items-center justify-center text-slate-900 transition-all hover:scale-110 z-[100] group">
          <div className="absolute -inset-1 bg-gradient-to-tr from-blue-500 to-indigo-500 rounded-[34px] opacity-0 group-hover:opacity-20 blur-lg transition-opacity" />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </button>
      )}

      <div className={`fixed right-6 top-6 bottom-6 w-[460px] z-[100] transition-all duration-700 ease-[cubic-bezier(0.2,1,0.2,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[500px] opacity-0'}`}>
        <div className="w-full h-full bg-white/80 backdrop-blur-[60px] border border-white rounded-[48px] shadow-[0_40px_100px_rgba(0,0,0,0.1)] flex flex-col relative overflow-visible">
          
          <div className="px-10 pt-10 pb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-slate-950 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-black text-slate-900 truncate">{currentModelInfo.name}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{hasKey ? 'READY' : 'KEY MISSING'}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsSettingsOpen(true)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all rounded-xl hover:bg-slate-50"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
              <button onClick={() => setIsOpen(false)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all rounded-xl hover:bg-slate-50"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-10">
            <div className="space-y-8 py-6">
              {messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                  <div className={`max-w-[85%] p-6 rounded-[32px] text-[13px] font-medium leading-[1.7] border ${msg.role === 'user' ? 'bg-slate-900 text-white border-slate-900 rounded-tr-none' : msg.isError ? 'bg-rose-50 border-rose-100 text-rose-600' : 'bg-white border-slate-100 text-slate-700 rounded-tl-none shadow-sm'}`}>
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-col gap-3 mt-4">
                        {msg.images.map((img, idx) => (
                          <div key={idx} className="relative group/img overflow-hidden rounded-2xl border border-slate-100 shadow-sm bg-slate-50">
                            <img src={img.url} className="w-full h-auto object-contain transition-transform duration-500 group-hover/img:scale-105" alt="generated" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex flex-col gap-2 pl-2">
                   <div className="animate-pulse flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                     {currentProgress !== null ? `Generating ${currentProgress}%` : 'Connecting Engine...'}
                   </div>
                   {currentProgress !== null && (
                     <div className="w-32 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-slate-950 transition-all duration-500" style={{ width: `${currentProgress}%` }} />
                     </div>
                   )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="p-8 relative overflow-visible">
            {pendingImages.length > 0 && (
              <div className="flex gap-2 mb-4 px-2 overflow-x-auto no-scrollbar py-2">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative shrink-0 group">
                    <img src={img.url} className="w-14 h-14 rounded-xl object-cover border-2 border-slate-100 shadow-md" alt="preview" />
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 bg-slate-950 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="bg-white rounded-[32px] shadow-[0_20px_60px_rgba(0,0,0,0.04)] border border-slate-100 p-3 relative overflow-visible">
              <textarea rows={2} placeholder="发消息..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} className="w-full bg-transparent border-none resize-none focus:outline-none px-4 pt-3 text-sm text-slate-800 placeholder:text-slate-300 font-bold" />
              
              <div className="flex items-center justify-between mt-2 px-1 relative overflow-visible">
                <div className="flex items-center gap-1 relative overflow-visible">
                  <button onClick={() => fileInputRef.current?.click()} className="p-2.5 text-slate-300 hover:text-slate-900 transition-colors rounded-xl hover:bg-slate-50"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
                  <button onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)} className={`p-2.5 transition-all rounded-xl ${isWebSearchEnabled ? 'text-blue-500 bg-blue-50' : 'text-slate-300 hover:text-slate-900 hover:bg-slate-50'}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></button>

                  <div className="relative overflow-visible" ref={modelMenuRef}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setIsModelMenuOpen(!isModelMenuOpen); }}
                      className={`px-3 py-1.5 border rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${isModelMenuOpen ? 'bg-slate-950 border-slate-950 text-white shadow-xl' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-300 hover:text-slate-900'}`}
                    >
                      {currentModelInfo.tag}
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    
                    {isModelMenuOpen && (
                      <div className="absolute bottom-full left-0 mb-4 bg-white rounded-[32px] shadow-[0_30px_90px_rgba(0,0,0,0.2)] border border-slate-100 p-6 z-[300] min-w-[380px] animate-fade-in origin-bottom-left">
                         <div className="flex items-center justify-between mb-6">
                            <h4 className="text-base font-black text-slate-900">模型偏好</h4>
                         </div>
                         <div className="flex bg-slate-50 p-1 rounded-2xl mb-6">
                            {(['Image', 'Video'] as ModelCategory[]).map((cat) => (
                              <button key={cat} onClick={() => setSelectedCategory(cat)} className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${selectedCategory === cat ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{cat}</button>
                            ))}
                         </div>
                         <div className="space-y-2 max-h-[450px] overflow-y-auto no-scrollbar pr-1">
                            {MODELS.filter(m => m.category === selectedCategory).map(m => (
                              <button key={m.id} onClick={() => { setSelectedModel(m.id); localStorage.setItem('gemini_selected_model', m.id); setIsModelMenuOpen(false); }} className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${selectedModel === m.id ? 'bg-slate-50/50 border-slate-900 shadow-sm' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-100'}`}>
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${selectedModel === m.id ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">{m.category === 'Video' ? <path d="M23 7l-7 5 7 5V7zM1 5h15v14H1V5z"/> : <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>}</svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-slate-900 truncate">{m.name}</span>
                                    {selectedModel === m.id && <div className="w-4 h-4 bg-slate-950 rounded-full flex items-center justify-center text-white shrink-0"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6L9 17l-5-5"/></svg></div>}
                                  </div>
                                  <div className="text-[9px] text-slate-400 font-medium truncate mt-0.5">{m.description}</div>
                                  <div className="flex items-center gap-2 mt-2">
                                     <span className="px-1.5 py-0.5 bg-white border border-slate-100 text-slate-400 text-[8px] font-black rounded uppercase tracking-tighter">{m.tag}</span>
                                     <span className="text-[9px] font-mono text-slate-300 font-bold">{m.speedTag}</span>
                                  </div>
                                </div>
                              </button>
                            ))}
                         </div>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={handleSend} disabled={(!input.trim() && pendingImages.length === 0) || isTyping} className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all shadow-xl ${ (input.trim() || pendingImages.length > 0) && !isTyping ? 'bg-slate-950 text-white hover:scale-105 active:scale-95' : 'bg-slate-50 text-slate-200' }`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
              </div>
            </div>
          </div>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={(e) => { const files = Array.from(e.target.files || []); files.forEach(async f => { const processed = await processImageSource(URL.createObjectURL(f)); if (processed) setPendingImages(prev => [...prev, processed]); }); }} />
        </div>
      </div>
    </>
  );
};

export default GeminiChat;

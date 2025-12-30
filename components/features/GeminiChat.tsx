
import React, { useState, useRef, useEffect } from 'react';
import { ensureHttps, queuePrompt, getHistory, getImageUrl, generateClientId } from '../../services/api';
import { generateFluxWorkflow, generateSdxlWorkflow } from '../../services/workflows';

interface PendingImage {
  url: string;
  base64: string;
  type: string;
  canvasItemId?: string;
  isLoading?: boolean;
}

interface ChatImage {
  url: string;
  canvasItemId?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  images?: ChatImage[];
  isError?: boolean;
  modelUsed?: string;
}

type DrawModel = 'nano-banana-pro' | 'nano-banana-fast' | 'flux' | 'sdxl';

const GEMINI_MODELS = [
  { id: 'gemini-3-pro-preview', short: '3 Pro', label: 'Gemini 3 Pro' },
  { id: 'gemini-3-flash-preview', short: '3 Flash', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-flash-latest', short: '2.5 Flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-flash-lite-latest', short: 'Lite', label: 'Gemini 2.5 Lite' },
];

const GeminiChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [selectedDrawModel, setSelectedDrawModel] = useState<DrawModel>('flux');
  const [useLora, setUseLora] = useState(true);
  
  const [externalKey, setExternalKey] = useState<string>(localStorage.getItem('external_api_key') || '');
  const [externalBaseUrl, setExternalBaseUrl] = useState<string>(localStorage.getItem('external_base_url') || 'https://api.grsai.com');
  const [chatModel, setChatModel] = useState<string>(localStorage.getItem('chat_model') || 'gemini-3-pro-preview');

  const [input, setInput] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Neural Interface Online. Awaiting instruction.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const COMFY_SERVER_URL = "https://17610400098.top";

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const targetHeight = Math.min(Math.max(scrollHeight, 40), 120);
      textareaRef.current.style.height = `${targetHeight}px`;
    }
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleAddImage = async (e: any) => {
      const { src, id } = e.detail;
      if (!src) return;
      setIsOpen(true);
      setPendingImages(prev => {
        if (prev.some(p => p.canvasItemId === id)) return prev;
        return [...prev, { url: src, base64: '', type: 'image/png', canvasItemId: id, isLoading: true }];
      });
      try {
        let base64Data = '';
        let mimeType = 'image/png';
        if (src.startsWith('data:')) {
          const parts = src.split(',');
          base64Data = parts[1];
          mimeType = parts[0].split(':')[1].split(';')[0];
        } else {
          const res = await fetch(src);
          const blob = await res.blob();
          mimeType = blob.type;
          base64Data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(blob);
          });
        }
        setPendingImages(prev => prev.map(img => 
          img.canvasItemId === id ? { ...img, base64: base64Data, type: mimeType, isLoading: false } : img
        ));
      } catch (err) {
        setPendingImages(prev => prev.filter(img => img.canvasItemId !== id));
      }
    };
    window.addEventListener('add-image-to-chat', handleAddImage);
    return () => window.removeEventListener('add-image-to-chat', handleAddImage);
  }, []);

  const saveSettings = () => {
    localStorage.setItem('external_api_key', externalKey);
    localStorage.setItem('external_base_url', externalBaseUrl);
    localStorage.setItem('chat_model', chatModel);
    setIsSettingsOpen(false);
  };

  const selectChatModel = (modelId: string) => {
    setChatModel(modelId);
    localStorage.setItem('chat_model', modelId);
    setIsModelMenuOpen(false);
  };

  const handleTranslate = async () => {
    if (!input.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const response = await fetch(`${externalBaseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${externalKey}` 
        },
        body: JSON.stringify({
          model: chatModel,
          messages: [{ role: 'user', content: `Translate this to English if Chinese, or Chinese if English. Output ONLY raw translation: ${input}` }]
        })
      });
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) setInput(text.trim());
    } catch (err) { 
        console.error(err); 
    } finally { 
        setIsTranslating(false); 
    }
  };

  const callComfyUI = async (params: any, model: 'flux' | 'sdxl'): Promise<string> => {
    setStatusText(`${model.toUpperCase()}: Init...`);
    const url = ensureHttps(COMFY_SERVER_URL);
    const clientId = generateClientId();
    let workflow = model === 'flux' ? generateFluxWorkflow(params.prompt, 1024, 1024, 9, useLora) : generateSdxlWorkflow(params.prompt, "bad quality", 1024, 1024, 12, 3.5);
    const promptId = await queuePrompt(url, workflow, clientId);
    return new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const history = await getHistory(url, promptId);
          if (history[promptId] && history[promptId].status.completed) {
            clearInterval(poll);
            const outputs = history[promptId].outputs;
            for (const k in outputs) {
              if (outputs[k].images?.length > 0) {
                const img = outputs[k].images[0];
                resolve(getImageUrl(url, img.filename, img.subfolder, img.type));
                return;
              }
            }
          }
        } catch (e) { clearInterval(poll); reject(e); }
      }, 1500);
    });
  };

  const callExternalDrawAPI = async (params: any, model: DrawModel) => {
    setStatusText(`${model.toUpperCase()}: Processing...`);
    const payload = { 
        model: model, 
        prompt: params.prompt, 
        aspectRatio: "auto", 
        imageSize: "1K",
        urls: params.images && params.images.length > 0 ? params.images : undefined
    };

    const res = await fetch(`${externalBaseUrl.replace(/\/$/, '')}/v1/draw/nano-banana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${externalKey}` },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
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
          if (!line.trim().startsWith('data:')) continue;
          const jsonStr = line.trim().replace('data:', '').trim();
          if (jsonStr === '[DONE]') break;
          try {
            const data = JSON.parse(jsonStr);
            if (data.progress) setStatusText(`${model.toUpperCase()}: ${data.progress}%`);
            if (data.results?.[0]?.url) finalImageUrl = data.results[0].url;
          } catch (e) {}
        }
      }
    }
    return finalImageUrl;
  };

  const handleSend = async () => {
    if (!input.trim() && pendingImages.length === 0) return;
    if (isTyping) return;

    const userText = input;
    const currentImages = [...pendingImages];
    const canvasRefIds = currentImages.filter(img => img.canvasItemId).map(img => img.canvasItemId!);
    
    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(i => ({ url: i.url })) }]);
    setIsTyping(true);
    setStatusText('Consulting...');

    try {
      const contentParts: any[] = [];
      if (userText) contentParts.push({ type: 'text', text: userText });
      currentImages.forEach(img => {
        contentParts.push({ type: 'image_url', image_url: { url: `data:${img.type};base64,${img.base64}` } });
      });

      const response = await fetch(`${externalBaseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${externalKey}` 
        },
        body: JSON.stringify({
          model: chatModel,
          messages: [
              { role: 'system', content: "You are the Studio Architectural Agent. Professional, precise. You can help users generate images by responding with a special JSON tag like [DRAW: your prompt here] if they ask for a new image." },
              { role: 'user', content: contentParts }
          ]
        })
      });

      if (!response.ok) throw new Error(`External API Error: ${response.status}`);
      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || "";

      // Logic to check for [DRAW: ...] pattern for auto-orchestration
      const drawMatch = reply.match(/\[DRAW:\s*(.+?)\]/i);
      if (drawMatch) {
          const drawPrompt = drawMatch[1];
          let url = "";
          if (selectedDrawModel === 'flux' || selectedDrawModel === 'sdxl') {
            url = await callComfyUI({ prompt: drawPrompt }, selectedDrawModel);
          } else {
            url = await callExternalDrawAPI({ prompt: drawPrompt, images: currentImages.map(i => i.base64) }, selectedDrawModel);
          }
          setMessages(prev => [...prev, { role: 'assistant', text: reply.replace(/\[DRAW:.+?\]/gi, 'Deploying visualized concept to canvas.'), images: [{ url }], modelUsed: chatModel.toUpperCase() }]);
          window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: drawPrompt, parentIds: canvasRefIds } }));
      } else {
          setMessages(prev => [...prev, { role: 'assistant', text: reply, modelUsed: chatModel.toUpperCase() }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Connection Interrupted: ${error.message}`, isError: true }]);
    } finally { 
        setIsTyping(false); 
        setStatusText(''); 
    }
  };

  const currentModelObj = GEMINI_MODELS.find(m => m.id === chatModel) || GEMINI_MODELS[0];

  return (
    <>
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-6 top-6 w-12 h-12 bg-white/90 backdrop-blur-xl border border-white rounded-2xl shadow-premium flex items-center justify-center text-slate-400 transition-all hover:scale-110 z-[100] hover:text-slate-950 active:scale-95 group">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white animate-pulse" />
        </button>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-2xl" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-[340px] bg-white rounded-[40px] shadow-2xl border border-white p-10 animate-fade-in">
            <h2 className="text-[11px] font-black text-slate-950 tracking-[0.3em] uppercase mb-8">Neural Protocol</h2>
            <div className="space-y-6">
              <div>
                <label className="text-[9px] font-black text-slate-300 uppercase tracking-widest block mb-2 px-1">Access Key</label>
                <input type="password" value={externalKey} onChange={e => setExternalKey(e.target.value)} placeholder="••••••••" className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-mono font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/5 transition-all" />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-300 uppercase tracking-widest block mb-2 px-1">Endpoint</label>
                <input type="text" value={externalBaseUrl} onChange={e => setExternalBaseUrl(e.target.value)} placeholder="https://api.provider.com" className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-mono font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/5 transition-all" />
              </div>
              <button onClick={saveSettings} className="w-full py-4.5 bg-slate-950 text-white rounded-2xl text-[10px] font-black tracking-[0.3em] uppercase shadow-premium hover:bg-black active:scale-[0.98] transition-all mt-4">Sync Config</button>
            </div>
          </div>
        </div>
      )}

      <div className={`fixed right-6 top-6 bottom-6 w-[360px] z-[100] transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[420px] opacity-0'}`}>
        <div className="w-full h-full glass-panel rounded-[40px] shadow-premium flex flex-col relative overflow-hidden border border-white bg-white/70 backdrop-blur-[80px]">
          {/* Header */}
          <div className="px-8 py-8 border-b border-slate-100/30 flex flex-col gap-6 bg-white/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 bg-slate-950 rounded-2xl flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                <div>
                  <h3 className="text-[14px] font-black text-slate-950 uppercase tracking-[0.1em] leading-none">Studio Agent</h3>
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.5em] mt-3 block leading-none">Neural Hub</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsSettingsOpen(true)} className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-300 hover:bg-white hover:text-slate-950 hover:shadow-premium transition-all"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                <button onClick={() => setIsOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-all active:scale-90"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="flex bg-slate-50/70 p-1.5 rounded-2xl gap-1.5 border border-slate-100/50 shadow-inner overflow-x-auto no-scrollbar">
                {(['flux', 'sdxl', 'nano-banana-pro', 'nano-banana-fast'] as DrawModel[]).map(dm => (
                  <button key={dm} onClick={() => setSelectedDrawModel(dm)} className={`flex-1 min-w-[70px] py-2 rounded-xl text-[8px] font-black uppercase tracking-tight transition-all duration-300 ${selectedDrawModel === dm ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-300 hover:text-slate-600'}`}>{dm.replace('nano-banana-', '').toUpperCase()}</button>
                ))}
              </div>
              
              {selectedDrawModel === 'flux' && (
                <div className="flex items-center justify-between px-2 animate-fade-in">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.3em]">Artistic Refinement (LoRA)</span>
                  <button 
                    onClick={() => setUseLora(!useLora)}
                    className={`relative w-9 h-5 rounded-full transition-all duration-500 ${useLora ? 'bg-blue-600 shadow-[0_0_12px_rgba(37,99,235,0.3)]' : 'bg-slate-200'}`}
                  >
                    <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-500 ${useLora ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-8 space-y-8">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                <div className={`max-w-[90%] p-5 rounded-[24px] text-[13px] font-bold leading-relaxed relative shadow-glass border transition-all duration-500 ${msg.role === 'user' ? 'bg-slate-950 text-white border-transparent shadow-xl' : 'bg-white/80 border-slate-100 text-slate-900'}`}>
                  {msg.modelUsed && <span className="absolute -top-5 left-0 text-[7px] font-black uppercase text-slate-300 tracking-[0.4em]">{msg.modelUsed}</span>}
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                  {msg.images?.map((img, idx) => (
                    <div key={idx} className="mt-5 rounded-2xl overflow-hidden border border-slate-50 shadow-soft group/img cursor-pointer relative">
                        <img src={img.url} className="w-full object-cover max-h-[300px] transition-transform duration-700 group-hover/img:scale-105" alt="synthesis result" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex flex-col gap-3 ml-2">
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.2s]" />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.4s]" />
                </div>
                {statusText && <span className="text-[8px] font-black text-slate-300 uppercase tracking-[0.4em] leading-none animate-pulse">{statusText}</span>}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="px-8 pb-10 pt-6 bg-white/30 border-t border-slate-100/20">
            {pendingImages.length > 0 && (
              <div className="flex gap-4 mb-5 overflow-x-auto no-scrollbar py-2">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative shrink-0 group/pending">
                    <img src={img.url} className={`w-14 h-14 rounded-2xl object-cover border border-white shadow-premium transition-all ${img.isLoading ? 'opacity-30' : 'group-hover/pending:scale-110'}`} alt="pending" />
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center border-2 border-white shadow-xl opacity-0 group-hover/pending:opacity-100 transition-opacity"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex items-end gap-3 bg-white/90 backdrop-blur-2xl border border-slate-100 p-2 rounded-[28px] shadow-premium focus-within:shadow-2xl transition-all duration-700 relative">
              {/* Model Selector Pill */}
              <div className="flex flex-col" ref={modelMenuRef}>
                <button 
                  onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                  className="w-11 h-11 flex items-center justify-center bg-slate-50 text-slate-900 rounded-2xl text-[8px] font-black uppercase tracking-tighter hover:bg-slate-100 transition-all border border-slate-100 active:scale-95 shrink-0"
                >
                  <div className="flex flex-col items-center leading-tight">
                    <span>{currentModelObj.short.split(' ')[0]}</span>
                    {currentModelObj.short.split(' ')[1] && <span className="text-blue-500">{currentModelObj.short.split(' ')[1]}</span>}
                  </div>
                </button>
                
                {isModelMenuOpen && (
                  <div className="absolute bottom-full left-2 mb-4 w-48 bg-white/95 backdrop-blur-3xl rounded-[24px] border border-white shadow-2xl p-2 z-[200] animate-fade-in">
                    <div className="px-4 py-3 border-b border-slate-50 mb-1">
                      <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Select Intelligence</span>
                    </div>
                    {GEMINI_MODELS.map(model => (
                      <button 
                        key={model.id}
                        onClick={() => selectChatModel(model.id)}
                        className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center justify-between group ${chatModel === model.id ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
                      >
                        <span className="text-[10px] font-bold">{model.label}</span>
                        {chatModel === model.id && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => fileInputRef.current?.click()} className="w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-950 transition-all rounded-2xl hover:bg-slate-50 shrink-0"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
              
              <textarea ref={textareaRef} placeholder="Instruct the agent..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} className="flex-1 bg-transparent border-none focus:outline-none text-[14px] font-bold text-slate-950 placeholder:text-slate-200 resize-none py-3 leading-snug tracking-tight no-scrollbar" style={{ maxHeight: '160px', minHeight: '44px' }} />
              
              <div className="flex flex-col gap-3 shrink-0">
                {input.trim() && (
                  <button onClick={handleTranslate} className={`w-11 h-11 flex items-center justify-center transition-all rounded-2xl ${isTranslating ? 'text-blue-500' : 'text-slate-200 hover:text-blue-600 hover:bg-blue-50'}`}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={isTranslating ? 'animate-spin' : ''}><path d="M5 8l6 6M4 14l10-10M2 5h12M7 2h1M22 22l-5-10-5 10M12.8 18h8.4" /></svg></button>
                )}
                <button onClick={handleSend} disabled={isTyping || (!input.trim() && pendingImages.length === 0)} className="w-11 h-11 bg-slate-950 rounded-2xl flex items-center justify-center text-white shadow-premium transition-all hover:scale-105 hover:bg-black active:scale-[0.94] disabled:opacity-10">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M5 12l7-7 7 7M12 19V5"/></svg>
                </button>
              </div>
            </div>
            
            <input type="file" ref={fileInputRef} className="hidden" multiple onChange={e => {
                const fs = Array.from(e.target.files || []) as File[];
                fs.forEach(f => {
                  const r = new FileReader();
                  r.onload = (ev) => {
                    const b64 = (ev.target?.result as string).split(',')[1];
                    setPendingImages(prev => [...prev, { url: ev.target?.result as string, base64: b64, type: f.type, isLoading: false }]);
                  };
                  r.readAsDataURL(f);
                });
              }} 
            />
            <div className="mt-8 text-center">
                <span className="text-[8px] font-black text-slate-100 uppercase tracking-[1em]">Secure Neural Sequence Active</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeminiChat;

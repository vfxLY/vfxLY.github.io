
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
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
  role: 'user' | 'model';
  text: string;
  images?: ChatImage[];
  isError?: boolean;
  modelUsed?: string;
}

type ModelMode = 'auto' | 'pro' | 'vision';
type DrawModel = 'nano-banana-pro' | 'nano-banana-fast' | 'flux' | 'sdxl';

const GeminiChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModelMode, setSelectedModelMode] = useState<ModelMode>('auto');
  const [selectedDrawModel, setSelectedDrawModel] = useState<DrawModel>('flux');
  const [useLora, setUseLora] = useState(true);
  
  const [externalKey, setExternalKey] = useState<string>(localStorage.getItem('external_api_key') || '');
  const [externalBaseUrl, setExternalBaseUrl] = useState<string>(localStorage.getItem('external_base_url') || 'https://api.grsai.com');

  const [input, setInput] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: 'Greeting. Studio Agent online.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [hasAistudio, setHasAistudio] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const COMFY_SERVER_URL = "https://17610400098.top";

  useEffect(() => {
    if (window.aistudio) setHasAistudio(true);
  }, []);

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
    setIsSettingsOpen(false);
  };

  const ensureApiKey = async () => {
    const key = process.env.API_KEY;
    if (key && key.trim() !== '') return true;
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return true;
      }
      return true;
    }
    return false;
  };

  const handleTranslate = async () => {
    if (!input.trim() || isTranslating) return;
    const keyReady = await ensureApiKey();
    if (!keyReady) return;
    setIsTranslating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Translate the following text to English (if Chinese) or Chinese (if English). Return raw translation ONLY: ${input}`,
        config: { systemInstruction: "Professional bidirectional translator." }
      });
      if (response.text) setInput(response.text.trim());
    } catch (err) { console.error(err); } finally { setIsTranslating(false); }
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
    const apiKey = localStorage.getItem('external_api_key') || '';
    const baseUrl = localStorage.getItem('external_base_url') || 'https://api.grsai.com';
    setStatusText(`${model.toUpperCase()}: Deploying...`);
    
    const payload = { 
        model: model, 
        prompt: params.prompt, 
        aspectRatio: "auto", 
        imageSize: "1K",
        urls: params.images && params.images.length > 0 ? params.images : undefined
    };

    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/draw/nano-banana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
    const keyReady = await ensureApiKey();
    if (!keyReady) return;

    const userText = input;
    const currentImages = [...pendingImages];
    const canvasRefIds = currentImages.filter(img => img.canvasItemId).map(img => img.canvasItemId!);
    
    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(i => ({ url: i.url })) }]);
    setIsTyping(true);
    setStatusText('Routing...');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const userParts: any[] = currentImages.map(img => ({ inlineData: { mimeType: img.type, data: img.base64 } }));
      userParts.push({ text: userText });

      let primaryModel = selectedModelMode === 'pro' ? 'gemini-3-pro-preview' : (selectedModelMode === 'vision' ? 'gemini-2.5-flash-image' : 'gemini-3-flash-preview');

      if (selectedModelMode === 'vision') {
        const response = await ai.models.generateContent({ model: primaryModel, contents: [{ role: 'user', parts: userParts }] });
        setMessages(prev => [...prev, { role: 'model', text: response.text || "Analysis complete.", modelUsed: 'VISION' }]);
        return;
      }

      const response = await ai.models.generateContent({
        model: primaryModel,
        contents: [{ role: 'user', parts: userParts }],
        config: {
          systemInstruction: "You are the Studio Agent. Precise and professional. Trigger tools only if asked to draw/create.",
          tools: [{ functionDeclarations: [
            { name: 'generate_image', description: 'Create new visuals.', parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING } }, required: ['prompt'] } }
          ]}]
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const fc of response.functionCalls) {
          const args = fc.args as any;
          let url = "";
          if (selectedDrawModel === 'flux' || selectedDrawModel === 'sdxl') {
            url = await callComfyUI(args, selectedDrawModel);
          } else {
            url = await callExternalDrawAPI({ ...args, images: currentImages.map(i => i.base64) }, selectedDrawModel);
          }
          setMessages(prev => [...prev, { role: 'model', text: `Synthesis finalized.`, images: [{ url }], modelUsed: selectedModelMode.toUpperCase() }]);
          window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: args.prompt, parentIds: canvasRefIds } }));
        }
      } else {
        setMessages(prev => [...prev, { role: 'model', text: response.text || "...", modelUsed: selectedModelMode.toUpperCase() }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'model', text: `Error: ${error.message}`, isError: true }]);
    } finally { setIsTyping(false); setStatusText(''); }
  };

  return (
    <>
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-6 top-6 w-11 h-11 bg-white border border-slate-100 rounded-xl shadow-premium flex items-center justify-center text-slate-400 transition-all hover:scale-105 z-[100] hover:text-slate-950 active:scale-95">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-blue-500 rounded-full border-2 border-white" />
        </button>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-xl" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-[320px] bg-white rounded-[32px] shadow-2xl border border-slate-100 p-8 animate-fade-in">
            <h2 className="text-[10px] font-black text-slate-950 tracking-[0.2em] uppercase mb-6">Protocol Settings</h2>
            <div className="space-y-6">
              <input type="password" value={externalKey} onChange={e => setExternalKey(e.target.value)} placeholder="API KEY" className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-mono font-bold text-slate-950 focus:outline-none" />
              <input type="text" value={externalBaseUrl} onChange={e => setExternalBaseUrl(e.target.value)} placeholder="ENDPOINT" className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-mono font-bold text-slate-950 focus:outline-none" />
              <button onClick={saveSettings} className="w-full py-3.5 bg-slate-950 text-white rounded-xl text-[9px] font-black tracking-[0.2em] uppercase shadow-premium active:scale-95 transition-all">Save Config</button>
            </div>
          </div>
        </div>
      )}

      <div className={`fixed right-6 top-6 bottom-6 w-[340px] z-[100] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[400px] opacity-0'}`}>
        <div className="w-full h-full glass-panel rounded-[32px] shadow-premium flex flex-col relative overflow-hidden border border-white/40 bg-white/70 backdrop-blur-[60px]">
          {/* Header */}
          <div className="px-6 py-6 border-b border-slate-100/20 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-950 rounded-xl flex items-center justify-center shadow-lg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                <div>
                  <h3 className="text-[12px] font-black text-slate-950 uppercase tracking-[0.1em] leading-none">Studio Agent</h3>
                  <span className="text-[8px] font-black text-slate-300 uppercase tracking-[0.4em] mt-2 block leading-none">Neural Hub</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setIsSettingsOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-white hover:text-slate-950 transition-all"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-white hover:text-slate-950 transition-all"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>
            </div>
            
            <div className="flex flex-col gap-3">
              <div className="flex bg-slate-50/50 p-1 rounded-xl gap-1 border border-slate-100/50">
                {(['auto', 'pro', 'vision'] as ModelMode[]).map(m => (
                  <button key={m} onClick={() => setSelectedModelMode(m)} className={`flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${selectedModelMode === m ? 'bg-white text-slate-950 shadow-sm border border-slate-100/50' : 'text-slate-300 hover:text-slate-500'}`}>{m}</button>
                ))}
              </div>
              <div className="flex bg-slate-50/50 p-1 rounded-xl gap-1 border border-slate-100/50 overflow-x-auto no-scrollbar">
                {(['flux', 'sdxl', 'nano-banana-pro', 'nano-banana-fast'] as DrawModel[]).map(dm => (
                  <button key={dm} onClick={() => setSelectedDrawModel(dm)} className={`flex-1 min-w-[60px] py-1.5 rounded-lg text-[7px] font-black uppercase tracking-tighter transition-all ${selectedDrawModel === dm ? 'bg-slate-950 text-white' : 'text-slate-300 hover:text-slate-500'}`}>{dm.replace('nano-banana-', '').toUpperCase()}</button>
                ))}
              </div>
              
              {selectedDrawModel === 'flux' && (
                <div className="flex items-center justify-between px-1 animate-fade-in mt-1">
                  <span className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em]">Cartoon Engine (LoRA)</span>
                  <button 
                    onClick={() => setUseLora(!useLora)}
                    className={`relative w-7 h-4 rounded-full transition-all duration-300 ${useLora ? 'bg-slate-950' : 'bg-slate-200'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-300 ${useLora ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                <div className={`max-w-[90%] p-4 rounded-2xl text-[12px] font-bold leading-relaxed relative shadow-sm border ${msg.role === 'user' ? 'bg-slate-950 text-white border-transparent' : 'bg-white border-slate-100 text-slate-800'}`}>
                  {msg.modelUsed && <span className="absolute -top-4 left-0 text-[6px] font-black uppercase text-slate-200 tracking-[0.3em]">{msg.modelUsed}</span>}
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                  {msg.images?.map((img, idx) => (
                    <div key={idx} className="mt-4 rounded-xl overflow-hidden border border-slate-50 shadow-sm">
                        <img src={img.url} className="w-full object-cover max-h-[260px]" alt="preview" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex flex-col gap-2 ml-1">
                <div className="flex gap-1.5">
                  <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" />
                  <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.2s]" />
                  <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.4s]" />
                </div>
                {statusText && <span className="text-[7px] font-black text-slate-300 uppercase tracking-[0.3em] leading-none animate-pulse">{statusText}</span>}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="px-6 pb-8 pt-4 bg-white/20 border-t border-slate-100/10">
            {pendingImages.length > 0 && (
              <div className="flex gap-3 mb-4 overflow-x-auto no-scrollbar py-1">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative shrink-0">
                    <img src={img.url} className={`w-12 h-12 rounded-xl object-cover border border-white shadow-md ${img.isLoading ? 'opacity-40' : ''}`} alt="pending" />
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 bg-slate-950 text-white rounded-full w-4 h-4 flex items-center justify-center border border-white shadow-lg"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex items-end gap-3 bg-white border border-slate-100 p-1.5 rounded-2xl shadow-premium focus-within:shadow-xl transition-all duration-300">
              <button onClick={() => fileInputRef.current?.click()} className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-slate-950 transition-all rounded-lg hover:bg-slate-50 shrink-0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
              
              <textarea ref={textareaRef} placeholder="Enter command..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} className="flex-1 bg-transparent border-none focus:outline-none text-[13px] font-bold text-slate-950 placeholder:text-slate-200 resize-none py-2.5 leading-snug tracking-tight no-scrollbar" style={{ maxHeight: '120px', minHeight: '40px' }} />
              
              <div className="flex flex-col gap-2 shrink-0">
                {input.trim() && (
                  <button onClick={handleTranslate} className="w-9 h-9 flex items-center justify-center text-slate-200 hover:text-blue-500 transition-all hover:bg-blue-50 rounded-lg"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 8l6 6M4 14l10-10M2 5h12M7 2h1M22 22l-5-10-5 10M12.8 18h8.4" /></svg></button>
                )}
                <button onClick={handleSend} disabled={isTyping || (!input.trim() && pendingImages.length === 0)} className="w-9 h-9 bg-slate-950 rounded-lg flex items-center justify-center text-white shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-20">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M5 12l7-7 7 7M12 19V5"/></svg>
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
            <div className="mt-6 text-center">
                <span className="text-[7px] font-black text-slate-100 uppercase tracking-[0.8em]">Neural Session Active</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeminiChat;

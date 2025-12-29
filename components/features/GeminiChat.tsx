import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { ensureHttps, queuePrompt, getHistory, getImageUrl, generateClientId } from '../../services/api';
import { generateFluxWorkflow, generateSdxlWorkflow } from '../../services/workflows';

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
    { role: 'model', text: 'Hello. I am your Studio Agent. I can assist with conceptual orchestration, synthesis instructions, and visual analysis.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const COMFY_SERVER_URL = "https://17610400098.top";

  // 高度逻辑优化：13px * 1.5 = 19.5px 每行。 py-3 (12px * 2) = 24px 边距。
  // 3行: 19.5 * 3 + 24 = ~83px
  // 8行: 19.5 * 8 + 24 = ~180px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const targetHeight = Math.min(Math.max(scrollHeight, 83), 180);
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
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });
        setPendingImages(prev => {
          if (prev.some(p => p.canvasItemId === id)) return prev;
          return [...prev, { url: src, base64, type: blob.type, canvasItemId: id }];
        });
      } catch (err) {
        console.error("Failed to process canvas image for chat", err);
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

  const handleTranslate = async () => {
    if (!input.trim() || isTranslating) return;
    setIsTranslating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Translate the following text. If the input is in Chinese, translate it to English. If the input is in English, translate it to Chinese. Do not enhance or modify the content style: ${input}`,
        config: { 
          systemInstruction: "You are a professional bidirectional translator (Chinese <-> English). Output ONLY the translated text string." 
        }
      });
      if (response.text) setInput(response.text.trim());
    } catch (err) {
      console.error("Translation failed:", err);
    } finally {
      setIsTranslating(false);
    }
  };

  const generateImageTool: FunctionDeclaration = {
    name: 'generate_image',
    description: 'Call this when user wants to create, draw, or synthesize a new image.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: 'High-detail descriptive prompt.' },
        aspect_ratio: { type: Type.STRING, enum: ['1:1', '16:9', '9:16'], description: 'Image ratio.' }
      },
      required: ['prompt']
    }
  };

  const editImageTool: FunctionDeclaration = {
    name: 'edit_image',
    description: 'Call this when user wants to modify or refine an existing image.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: 'Specific modification instruction.' },
        image_index: { type: Type.NUMBER, description: 'Index of image to modify.' }
      },
      required: ['prompt']
    }
  };

  const callComfyUI = async (params: any, model: 'flux' | 'sdxl'): Promise<string> => {
    setStatusText(`Routing ${model.toUpperCase()}...`);
    const url = ensureHttps(COMFY_SERVER_URL);
    const clientId = generateClientId();
    let workflow;
    if (model === 'flux') workflow = generateFluxWorkflow(params.prompt, 1024, 1024, 9, useLora);
    else workflow = generateSdxlWorkflow(params.prompt, "lowres, bad quality", 1024, 1024, 12, 3.5);
    const promptId = await queuePrompt(url, workflow, clientId);
    return new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const history = await getHistory(url, promptId);
          if (history[promptId]) {
            const result = history[promptId];
            if (result.status.status_str === 'success') {
              clearInterval(poll);
              for (const key in result.outputs) {
                if (result.outputs[key].images?.length > 0) {
                  const img = result.outputs[key].images[0];
                  resolve(getImageUrl(url, img.filename, img.subfolder, img.type));
                  return;
                }
              }
              reject(new Error("No image data"));
            } else if (result.status.status_str === 'error') {
              clearInterval(poll);
              reject(new Error("Server error"));
            }
          }
        } catch (e) {
          clearInterval(poll);
          reject(e);
        }
      }, 1500);
    });
  };

  const callGrsaiEngine = async (params: any) => {
    if (!externalKey) throw new Error("API Key required");
    const baseUrl = externalBaseUrl.replace(/\/$/, '');
    setStatusText(`Syncing ${selectedDrawModel.toUpperCase()}...`);
    const response = await fetch(`${baseUrl}/v1/draw/nano-banana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${externalKey}` },
      body: JSON.stringify({
        model: selectedDrawModel,
        prompt: params.prompt,
        aspectRatio: params.aspect_ratio || "1:1",
        urls: params.images || undefined
      })
    });
    if (!response.ok) throw new Error(`Hub Error (${response.status})`);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let finalUrl = "";
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
            if (data.results?.[0]?.url) finalUrl = data.results[0].url;
          } catch (e) {}
        }
      }
    }
    return finalUrl;
  };

  const handleSend = async () => {
    if (!input.trim() && pendingImages.length === 0) return;
    if (isTyping) return;
    const userText = input;
    const currentImages = [...pendingImages];
    const canvasRefIds = currentImages.filter(img => img.canvasItemId).map(img => img.canvasItemId!);
    let primaryModel = selectedModelMode === 'pro' ? 'gemini-3-pro-preview' : (selectedModelMode === 'vision' ? 'gemini-2.5-flash-image' : 'gemini-3-flash-preview');
    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(i => ({ url: i.url })) }]);
    setIsTyping(true);
    setStatusText('Processing...');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const userParts: any[] = currentImages.map(img => ({ inlineData: { mimeType: img.type, data: img.base64 } }));
      userParts.push({ text: userText });
      if (selectedModelMode === 'vision') {
        const response = await ai.models.generateContent({ model: primaryModel, contents: [{ role: 'user', parts: userParts }] });
        let imageUrl = "";
        for (const part of response.candidates?.[0]?.content?.parts || []) if (part.inlineData) imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        setMessages(prev => [...prev, { role: 'model', text: response.text || "Completed.", images: imageUrl ? [{ url: imageUrl }] : undefined, modelUsed: 'VISION' }]);
        if (imageUrl) window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: imageUrl, prompt: userText, parentIds: canvasRefIds } }));
        return;
      }
      const response = await ai.models.generateContent({
        model: primaryModel,
        contents: [{ role: 'user', parts: userParts }],
        config: {
          systemInstruction: "High-end Studio Orchestrator. Respond or call tools for imagery. Be precise.",
          tools: [{ functionDeclarations: [generateImageTool, editImageTool] }]
        }
      });
      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const fc of response.functionCalls) {
          const args = fc.args as any;
          const url = (selectedDrawModel === 'flux' || selectedDrawModel === 'sdxl') ? await callComfyUI(args, selectedDrawModel) : await callGrsaiEngine(args);
          setMessages(prev => [...prev, { role: 'model', text: `Synthesis finalized via ${selectedDrawModel.toUpperCase()}.`, images: [{ url }], modelUsed: selectedModelMode.toUpperCase() }]);
          window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: args.prompt, parentIds: canvasRefIds } }));
        }
      } else setMessages(prev => [...prev, { role: 'model', text: response.text || "Acknowledged.", modelUsed: selectedModelMode.toUpperCase() }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'model', text: `Exception: ${error.message}`, isError: true }]);
    } finally { setIsTyping(false); setStatusText(''); }
  };

  return (
    <>
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-3 top-3 w-11 h-11 bg-white border border-slate-100 rounded-xl shadow-premium flex items-center justify-center text-slate-400 transition-all hover:scale-105 z-[100] group hover:text-slate-950 active:scale-95">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse border-[2px] border-white" />
        </button>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-xl" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-[340px] bg-white rounded-2xl shadow-premium overflow-hidden animate-fade-in border border-slate-100 p-6">
            <h2 className="text-[11px] font-black text-slate-950 tracking-tighter mb-5 uppercase">Configuration</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-[8px] font-black text-slate-300 uppercase tracking-widest mb-2">Auth Key</label>
                <input type="password" value={externalKey} onChange={e => setExternalKey(e.target.value)} placeholder="sk-..." className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-mono font-bold text-slate-950 focus:outline-none" />
              </div>
              <button onClick={saveSettings} className="w-full py-3 bg-slate-950 text-white rounded-xl text-[9px] font-black tracking-widest uppercase hover:bg-black transition-all">Save Hub Params</button>
            </div>
          </div>
        </div>
      )}

      <div className={`fixed right-3 top-3 bottom-3 w-[340px] z-[100] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[380px] opacity-0'}`}>
        <div className="w-full h-full glass-panel rounded-[24px] shadow-premium flex flex-col relative overflow-hidden border border-white/60 bg-white/75 backdrop-blur-3xl">
          <div className="p-4 border-b border-slate-100/50 flex flex-col gap-4 bg-white/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-950 rounded-xl flex items-center justify-center shadow-soft">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-950 uppercase tracking-widest leading-none">Agent</h3>
                  <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest mt-1 block leading-none">Cognitive Unit</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setIsSettingsOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-white hover:text-slate-950 transition-all"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-white hover:text-slate-950 transition-all"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex bg-slate-100/50 p-1 rounded-xl gap-1 border border-slate-100 shadow-inner">
                {(['auto', 'pro', 'vision'] as ModelMode[]).map(mode => (
                  <button key={mode} onClick={() => setSelectedModelMode(mode)} className={`flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all ${selectedModelMode === mode ? 'bg-white text-slate-950 shadow-soft border border-slate-100/50' : 'text-slate-300 hover:text-slate-500'}`}>{mode}</button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest">Synthesis Core</span>
                  {selectedDrawModel === 'flux' && (
                    <button 
                      onClick={() => setUseLora(!useLora)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all border ${useLora ? 'bg-blue-50 text-blue-600 border-blue-100 shadow-sm' : 'text-slate-300 hover:text-slate-400 border-transparent'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full border ${useLora ? 'bg-blue-600 border-blue-600' : 'border-slate-200'}`} />
                      <span className="text-[7px] font-black uppercase tracking-tighter">LoRA</span>
                    </button>
                  )}
                </div>
                <div className="flex bg-slate-100/50 p-1 rounded-xl gap-1 border border-slate-100 shadow-inner">
                  {(['flux', 'sdxl', 'nano-banana-pro', 'nano-banana-fast'] as DrawModel[]).map(dm => (
                    <button key={dm} onClick={() => setSelectedDrawModel(dm)} className={`flex-1 py-1.5 rounded-lg text-[7px] font-black uppercase tracking-tighter transition-all ${selectedDrawModel === dm ? 'bg-slate-950 text-white shadow-soft' : 'text-slate-300 hover:text-slate-500'}`}>{dm.replace('nano-banana-', '').toUpperCase()}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                <div className={`max-w-[94%] p-3.5 rounded-2xl text-[12px] font-semibold leading-relaxed relative ${msg.role === 'user' ? 'bg-slate-950 text-white shadow-soft' : 'bg-white/80 border border-white text-slate-700 shadow-soft backdrop-blur-sm'}`}>
                  {msg.modelUsed && <span className="absolute -top-3.5 left-0 text-[7px] font-black uppercase text-slate-300 tracking-widest">{msg.modelUsed}</span>}
                  <div className="whitespace-pre-wrap tracking-tight">{msg.text}</div>
                  {msg.images?.map((img, idx) => <img key={idx} src={img.url} className="mt-3 rounded-xl border border-white shadow-soft w-full object-cover max-h-[260px] hover:scale-[1.01] transition-transform duration-500" alt="content" />)}
                </div>
              </div>
            ))}
            {isTyping && <div className="flex gap-1 ml-1"><div className="w-1 h-1 bg-slate-200 rounded-full animate-bounce" /><div className="w-1 h-1 bg-slate-200 rounded-full animate-bounce [animation-delay:-0.15s]" /><div className="w-1 h-1 bg-slate-200 rounded-full animate-bounce [animation-delay:-0.3s]" /></div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-5 pb-6 pt-3 bg-white/50 border-t border-slate-100/20 backdrop-blur-xl">
            {pendingImages.length > 0 && (
              <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar py-1">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative shrink-0 group">
                    <img src={img.url} className="w-12 h-12 rounded-xl object-cover border border-white shadow-soft transition-transform hover:scale-105" alt="pending" />
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 bg-slate-950 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg border-2 border-white scale-75 group-hover:scale-90 transition-all"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 bg-white/90 border border-slate-100/40 rounded-[20px] p-1.5 shadow-premium backdrop-blur-2xl">
              <button onClick={() => fileInputRef.current?.click()} className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-slate-950 transition-all rounded-full mb-0.5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
              <textarea ref={textareaRef} placeholder="Instruct orchestrator..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} className="flex-1 bg-transparent border-none focus:outline-none text-[12px] font-bold text-slate-950 placeholder:text-slate-200 resize-none py-3 leading-normal tracking-tight" style={{ maxHeight: '180px', minHeight: '83px' }} />
              <div className="flex flex-col gap-1 mb-0.5">
                <button onClick={handleTranslate} disabled={!input.trim()} className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-blue-500 transition-all active:scale-90 disabled:opacity-5"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 8l6 6M4 14l10-10M2 5h12M7 2h1M22 22l-5-10-5 10M12.8 18h8.4" /></svg></button>
                <button onClick={handleSend} disabled={isTyping || (!input.trim() && pendingImages.length === 0)} className="w-9 h-9 bg-slate-950 rounded-full flex items-center justify-center text-white shadow-soft transition-all hover:scale-105 active:scale-95 disabled:opacity-5 disabled:scale-100"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M5 12l7-7 7 7M12 19V5"/></svg></button>
              </div>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" multiple onChange={e => {
                const files = Array.from(e.target.files || []) as File[];
                files.forEach(f => {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const base64 = (ev.target?.result as string).split(',')[1];
                    setPendingImages(prev => [...prev, { url: ev.target?.result as string, base64, type: f.type }]);
                  };
                  reader.readAsDataURL(f);
                });
              }} 
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default GeminiChat;
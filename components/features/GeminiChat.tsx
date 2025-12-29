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
  const [selectedDrawModel, setSelectedDrawModel] = useState<DrawModel>('nano-banana-pro');
  
  const [externalKey, setExternalKey] = useState<string>(localStorage.getItem('external_api_key') || '');
  const [externalBaseUrl, setExternalBaseUrl] = useState<string>(localStorage.getItem('external_base_url') || 'https://api.grsai.com');

  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: 'Hello. I am your Studio Agent. I can assist with conceptual orchestration, synthesis instructions, and visual analysis. You can adjust model modes and drawing engines in the configuration hub.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const COMFY_SERVER_URL = "https://17610400098.top";

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
        image_index: { type: Type.NUMBER, description: 'Index of image to modify (starts at 0 if multiple images provided).' }
      },
      required: ['prompt']
    }
  };

  const callComfyUI = async (params: any, model: 'flux' | 'sdxl'): Promise<string> => {
    setStatusText(`Orchestrating ${model.toUpperCase()} via Studio Server...`);
    const url = ensureHttps(COMFY_SERVER_URL);
    const clientId = generateClientId();
    let workflow;
    
    if (model === 'flux') {
      workflow = generateFluxWorkflow(params.prompt, 1024, 1024, 9, true);
    } else {
      workflow = generateSdxlWorkflow(params.prompt, "lowres, bad quality", 1024, 1024, 12, 3.5);
    }

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
              reject(new Error("No image data in server response"));
            } else if (result.status.status_str === 'error') {
              clearInterval(poll);
              reject(new Error("Studio Server workflow failure"));
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
    if (!externalKey) throw new Error("API Key is required for Nano Banana engine. Configure in Hub settings.");
    const baseUrl = externalBaseUrl.replace(/\/$/, '');
    setStatusText(`Routing ${selectedDrawModel.toUpperCase()} to External Hub...`);
    
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

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `External Hub Error (${response.status})`);
    }

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
    // Collect all unique canvas item IDs as parents for orchestration linkage
    const canvasRefIds = currentImages.filter(img => img.canvasItemId).map(img => img.canvasItemId!);

    let primaryModel = 'gemini-3-flash-preview';
    if (selectedModelMode === 'pro') primaryModel = 'gemini-3-pro-preview';
    if (selectedModelMode === 'vision') primaryModel = 'gemini-2.5-flash-image';

    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(i => ({ url: i.url })) }]);
    setIsTyping(true);
    setStatusText('Processing context...');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const userParts: any[] = currentImages.map(img => ({ inlineData: { mimeType: img.type, data: img.base64 } }));
      userParts.push({ text: userText });

      if (selectedModelMode === 'vision') {
        const response = await ai.models.generateContent({ model: primaryModel, contents: [{ role: 'user', parts: userParts }] });
        let imageUrl = "";
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        setMessages(prev => [...prev, { role: 'model', text: response.text || "Vision sequence completed.", images: imageUrl ? [{ url: imageUrl }] : undefined, modelUsed: 'VISION' }]);
        if (imageUrl) window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: imageUrl, prompt: userText, parentIds: canvasRefIds } }));
        return;
      }

      const response = await ai.models.generateContent({
        model: primaryModel,
        contents: [{ role: 'user', parts: userParts }],
        config: {
          systemInstruction: "You are a high-end Studio Orchestrator. Decide whether to respond conversationally or call tools to generate or edit imagery based on provided context. Be sophisticated and precise.",
          tools: [{ functionDeclarations: [generateImageTool, editImageTool] }]
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const fc of response.functionCalls) {
          const args = fc.args as any;
          if (fc.name === 'generate_image') {
            let url = "";
            if (selectedDrawModel === 'flux' || selectedDrawModel === 'sdxl') {
              url = await callComfyUI(args, selectedDrawModel);
            } else {
              url = await callGrsaiEngine(args);
            }
            setMessages(prev => [...prev, { role: 'model', text: `Synthesis finalized via ${selectedDrawModel.toUpperCase()}. Logic attached to workspace.`, images: [{ url }], modelUsed: selectedModelMode.toUpperCase() }]);
            window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: args.prompt, parentIds: canvasRefIds } }));
          } 
          else if (fc.name === 'edit_image') {
            const idx = args.image_index || 0;
            const target = currentImages[idx] || currentImages[0];
            if (!target) throw new Error("Reference image required for edit tool.");
            
            let url = "";
            const engineParams = { ...args, images: [`data:${target.type};base64,${target.base64}`] };
            
            if (selectedDrawModel === 'flux' || selectedDrawModel === 'sdxl') {
                url = await callGrsaiEngine(engineParams);
            } else {
                url = await callGrsaiEngine(engineParams);
            }
            
            setMessages(prev => [...prev, { role: 'model', text: `Refinement implemented via ${selectedDrawModel.toUpperCase()}. Result synchronized to workspace.`, images: [{ url }], modelUsed: selectedModelMode.toUpperCase() }]);
            window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: args.prompt, parentIds: canvasRefIds } }));
          }
        }
      } else {
        setMessages(prev => [...prev, { role: 'model', text: response.text || "Orchestration acknowledged.", modelUsed: selectedModelMode.toUpperCase() }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'model', text: `Agent Exception: ${error.message}`, isError: true }]);
    } finally {
      setIsTyping(false);
      setStatusText('');
    }
  };

  return (
    <>
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-12 top-12 w-20 h-20 bg-white border border-slate-100 rounded-3xl shadow-premium flex items-center justify-center text-slate-400 transition-all hover:scale-110 z-[100] group hover:text-slate-950 active:scale-95">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full animate-pulse border-4 border-white" />
        </button>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-8">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-3xl" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-[500px] bg-white rounded-[60px] shadow-premium overflow-hidden animate-fade-in border border-white p-12">
            <div className="flex items-center justify-between mb-12">
              <h2 className="text-2xl font-black text-slate-950 tracking-tighter">Hub Configuration</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="w-12 h-12 flex items-center justify-center rounded-2xl text-slate-300 hover:text-slate-950 transition-colors bg-slate-50">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="space-y-10">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-4 ml-1">API Authentication Key</label>
                <input type="password" value={externalKey} onChange={e => setExternalKey(e.target.value)} placeholder="sk-..." className="w-full px-8 py-5 bg-slate-50 border border-slate-100 rounded-[28px] text-xs font-mono font-bold text-slate-950 focus:outline-none focus:ring-8 focus:ring-blue-500/5 transition-all" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-4 ml-1">Orchestration Endpoint</label>
                <input type="text" value={externalBaseUrl} onChange={e => setExternalBaseUrl(e.target.value)} className="w-full px-8 py-5 bg-slate-50 border border-slate-100 rounded-[28px] text-xs font-mono font-bold text-slate-950 focus:outline-none focus:ring-8 focus:ring-blue-500/5 transition-all" />
              </div>
              <button onClick={saveSettings} className="w-full py-6 bg-slate-950 text-white rounded-[32px] text-[11px] font-black tracking-widest uppercase shadow-premium hover:bg-black transition-all active:scale-95 mt-6">Apply Studio Hub Parameters</button>
            </div>
          </div>
        </div>
      )}

      <div className={`fixed right-10 top-10 bottom-10 w-[540px] z-[100] transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[650px] opacity-0'}`}>
        <div className="w-full h-full glass-panel rounded-[64px] shadow-premium flex flex-col relative overflow-hidden border border-white/60 bg-white/75 backdrop-blur-3xl">
          
          <div className="p-12 border-b border-slate-100/50 flex flex-col gap-10 bg-white/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 bg-slate-950 rounded-[22px] flex items-center justify-center shadow-premium group">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="group-hover:rotate-180 transition-transform duration-1000"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                <div>
                  <h3 className="text-[16px] font-black text-slate-950 uppercase tracking-widest leading-none">Studio Agent</h3>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2 block">Cognitive Logic Unit</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setIsSettingsOpen(true)} className="w-12 h-12 flex items-center justify-center rounded-2xl text-slate-400 hover:bg-white hover:text-slate-950 transition-all border border-transparent hover:border-slate-100">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button onClick={() => setIsOpen(false)} className="w-12 h-12 flex items-center justify-center rounded-2xl text-slate-400 hover:bg-white hover:text-slate-950 transition-all border border-transparent hover:border-slate-100">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-3">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] ml-1">Logic Core</span>
                    <div className="flex bg-slate-100/50 p-1.5 rounded-[24px] gap-1 border border-slate-100 shadow-inner overflow-hidden">
                        {(['auto', 'pro', 'vision'] as ModelMode[]).map(mode => (
                            <button key={mode} onClick={() => setSelectedModelMode(mode)} className={`flex-1 py-3 rounded-[20px] text-[10px] font-black uppercase tracking-widest transition-all duration-700 ${selectedModelMode === mode ? 'bg-white text-slate-950 shadow-soft border border-slate-100' : 'text-slate-300 hover:text-slate-500'}`}> {mode} </button>
                        ))}
                    </div>
                </div>
                
                <div className="flex flex-col gap-3">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] ml-1">Synthesis Core</span>
                    <div className="flex bg-slate-100/50 p-1.5 rounded-[24px] gap-1 border border-slate-100 shadow-inner overflow-hidden">
                        {(['nano-banana-pro', 'nano-banana-fast', 'flux', 'sdxl'] as DrawModel[]).map(dm => (
                            <button key={dm} onClick={() => setSelectedDrawModel(dm)} className={`flex-1 py-3 rounded-[20px] text-[9px] font-black uppercase tracking-widest transition-all duration-700 ${selectedDrawModel === dm ? 'bg-slate-950 text-white shadow-soft' : 'text-slate-300 hover:text-slate-500'}`}> 
                                {dm === 'nano-banana-pro' ? 'PRO' : dm === 'nano-banana-fast' ? 'FAST' : dm.toUpperCase()} 
                            </button>
                        ))}
                    </div>
                </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-12 space-y-12">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                <div className={`max-w-[94%] p-9 rounded-[40px] text-[15px] font-semibold leading-[1.7] relative ${msg.role === 'user' ? 'bg-slate-950 text-white shadow-premium' : msg.isError ? 'bg-rose-50 border border-rose-100 text-rose-500' : 'bg-white/80 border border-white text-slate-800 shadow-soft backdrop-blur-sm'}`}>
                  {msg.modelUsed && ( <span className="absolute -top-7 left-2 text-[9px] font-black uppercase text-slate-300 tracking-[0.3em]">{msg.modelUsed} SEQUENCE</span> )}
                  <div className="whitespace-pre-wrap tracking-tight">{msg.text}</div>
                  {msg.images && (
                    <div className="mt-8 flex flex-col gap-6">
                        {msg.images.map((img, idx) => (
                            <img key={idx} src={img.url} className="rounded-[32px] border border-white shadow-premium w-full object-cover max-h-[400px] hover:scale-[1.02] transition-transform duration-700" />
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex flex-col gap-5 ml-4">
                <div className="flex gap-2.5">
                  <div className="w-2 h-2 bg-slate-200 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-slate-200 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-2 h-2 bg-slate-200 rounded-full animate-bounce" />
                </div>
                {statusText && <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] ml-1">{statusText}</span>}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-12 bg-white/50 border-t border-slate-100/30 backdrop-blur-xl">
            {pendingImages.length > 0 && (
              <div className="flex gap-5 mb-10 overflow-x-auto no-scrollbar py-2 px-1">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative group shrink-0">
                    <img src={img.url} className="w-24 h-24 rounded-3xl object-cover border-4 border-white shadow-premium transition-transform hover:scale-110 duration-700" />
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-3 -right-3 bg-slate-950 text-white rounded-full w-8 h-8 flex items-center justify-center shadow-lg hover:bg-rose-500 transition-all scale-90 group-hover:scale-100 border-2 border-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-6 bg-white border border-slate-100 rounded-[48px] p-6 focus-within:ring-[12px] focus-within:ring-slate-950/[0.03] transition-all shadow-premium border-white/90">
              <button onClick={() => fileInputRef.current?.click()} className="p-4 text-slate-300 hover:text-slate-950 transition-colors shrink-0 bg-slate-50 rounded-3xl"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
              <textarea rows={1} placeholder={selectedModelMode === 'vision' ? "Analyze visual asset..." : "Define conceptual synthesis..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} className="flex-1 bg-transparent border-none focus:outline-none text-[16px] font-bold text-slate-950 placeholder:text-slate-200 resize-none py-4" />
              <button onClick={handleSend} disabled={isTyping || (!input.trim() && pendingImages.length === 0)} className="w-16 h-16 bg-slate-950 rounded-[28px] flex items-center justify-center text-white shadow-premium hover:scale-105 active:scale-95 transition-all disabled:opacity-10 disabled:scale-100 shrink-0"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M5 12l7-7 7 7M12 19V5"/></svg></button>
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
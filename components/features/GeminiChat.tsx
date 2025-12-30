
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
    { role: 'model', text: 'Hello. I am your Studio Agent. I can assist with conceptual orchestration, synthesis instructions, and visual analysis.' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [hasAistudio, setHasAistudio] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const COMFY_SERVER_URL = "https://17610400098.top";

  useEffect(() => {
    if (window.aistudio) {
      setHasAistudio(true);
    }
  }, []);

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
        console.error("Failed to process canvas image for chat", err);
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

  const handleSelectApiKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
    }
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
        contents: `Translate the following text. If the input is in Chinese, translate it to English. If the input is in English, translate it to Chinese. Do not enhance or modify the content style: ${input}`,
        config: { systemInstruction: "You are a professional bidirectional translator (Chinese <-> English). Output ONLY the translated text string." }
      });
      if (response.text) setInput(response.text.trim());
    } catch (err: any) {
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
    setStatusText(`${model.toUpperCase()} Engine: Initializing...`);
    const url = ensureHttps(COMFY_SERVER_URL);
    const clientId = generateClientId();
    let workflow;
    if (model === 'flux') workflow = generateFluxWorkflow(params.prompt, 1024, 1024, 9, useLora);
    else workflow = generateSdxlWorkflow(params.prompt, "lowres, bad quality", 1024, 1024, 12, 3.5);
    const promptId = await queuePrompt(url, workflow, clientId);
    let progressCounter = 0;
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
          } else {
            progressCounter = Math.min(progressCounter + 2, 98);
            setStatusText(`${model.toUpperCase()} Engine: Synthesizing... ${progressCounter}%`);
          }
        } catch (e) {
          clearInterval(poll);
          reject(e);
        }
      }, 1500);
    });
  };

  const callGeminiImageEngine = async (params: any) => {
    const keyReady = await ensureApiKey();
    if (!keyReady) throw new Error("API Key required");
    setStatusText(`${selectedDrawModel.toUpperCase()} Core: Routing...`);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const modelName = selectedDrawModel === 'nano-banana-pro' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
    const parts: any[] = [{ text: params.prompt }];
    if (params.images && params.images.length > 0) {
        for (const imgBase of params.images) {
            const data = imgBase.includes(',') ? imgBase.split(',')[1] : imgBase;
            const mime = imgBase.includes(',') ? imgBase.split(';')[0].split(':')[1] : 'image/png';
            parts.push({ inlineData: { data, mimeType: mime } });
        }
    }
    const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config: {
            imageConfig: {
                aspectRatio: params.aspect_ratio || "1:1",
                imageSize: modelName === 'gemini-3-pro-image-preview' ? '1K' : undefined
            }
        }
    });
    let finalImageUrl = "";
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            finalImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
        }
    }
    return finalImageUrl;
  };

  const handleSend = async () => {
    if (!input.trim() && pendingImages.length === 0) return;
    if (isTyping) return;
    if (pendingImages.some(img => img.isLoading)) {
      setStatusText("System: Preparing attachments...");
      return;
    }

    const keyReady = await ensureApiKey();
    if (!keyReady) return;

    const userText = input;
    const currentImages = [...pendingImages];
    const canvasRefIds = currentImages.filter(img => img.canvasItemId).map(img => img.canvasItemId!);
    let primaryModel = selectedModelMode === 'pro' ? 'gemini-3-pro-preview' : (selectedModelMode === 'vision' ? 'gemini-2.5-flash-image' : 'gemini-3-flash-preview');
    
    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(i => ({ url: i.url })) }]);
    setIsTyping(true);
    setStatusText('Logic Engine: Reasoning...');
    
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
          const url = (selectedDrawModel === 'flux' || selectedDrawModel === 'sdxl') ? await callComfyUI(args, selectedDrawModel) : await callGeminiImageEngine({ ...args, images: currentImages.map(i => i.base64) });
          setMessages(prev => [...prev, { role: 'model', text: `Synthesis finalized via ${selectedDrawModel.toUpperCase()}.`, images: [{ url }], modelUsed: selectedModelMode.toUpperCase() }]);
          window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: args.prompt, parentIds: canvasRefIds } }));
        }
      } else {
        setMessages(prev => [...prev, { role: 'model', text: response.text || "Acknowledged.", modelUsed: selectedModelMode.toUpperCase() }]);
      }
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      setMessages(prev => [...prev, { role: 'model', text: `Exception: ${error.message}`, isError: true }]);
    } finally { 
        setIsTyping(false); 
        setStatusText(''); 
    }
  };

  return (
    <>
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-6 top-6 w-12 h-12 bg-white border border-slate-100 rounded-2xl shadow-premium flex items-center justify-center text-slate-400 transition-all hover:scale-105 z-[100] group hover:text-slate-950 active:scale-95">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse border-[2.5px] border-white" />
        </button>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-xl" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-[340px] bg-white rounded-[32px] shadow-premium overflow-hidden animate-fade-in border border-slate-100 p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-[12px] font-black text-slate-950 tracking-widest uppercase">Configuration</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-300 hover:text-slate-950 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="space-y-8">
              {hasAistudio && (
                <div className="pb-6 border-b border-slate-100">
                  <label className="block text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] mb-4">Gemini API Access</label>
                  <button onClick={handleSelectApiKey} className="w-full flex items-center justify-center gap-3 py-4 bg-blue-50 text-blue-600 border border-blue-100 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition-all active:scale-[0.98]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3-3.5 3.5z"/></svg>
                    Link Neural API
                  </button>
                </div>
              )}
              <div>
                <label className="block text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] mb-3">Workspace Access</label>
                <div className="flex flex-col gap-3">
                    <input type="password" value={externalKey} onChange={e => setExternalKey(e.target.value)} placeholder="API KEY" className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-mono font-bold text-slate-950 focus:outline-none placeholder:text-slate-200" />
                    <input type="text" value={externalBaseUrl} onChange={e => setExternalBaseUrl(e.target.value)} placeholder="ENDPOINT" className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-mono font-bold text-slate-950 focus:outline-none placeholder:text-slate-200" />
                </div>
              </div>
              <button onClick={saveSettings} className="w-full py-4 bg-slate-950 text-white rounded-2xl text-[10px] font-black tracking-[0.3em] uppercase hover:bg-black transition-all active:scale-[0.98] shadow-premium">Commit Settings</button>
            </div>
          </div>
        </div>
      )}

      <div className={`fixed right-6 top-6 bottom-6 w-[360px] z-[100] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[400px] opacity-0'}`}>
        <div className="w-full h-full glass-panel rounded-[32px] shadow-premium flex flex-col relative overflow-hidden border border-white bg-white/80 backdrop-blur-[80px]">
          <div className="p-8 border-b border-slate-100/30 flex flex-col gap-6 bg-white/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-slate-950 rounded-2xl flex items-center justify-center shadow-premium transform rotate-0 group-hover:rotate-6 transition-transform">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                </div>
                <div>
                  <h3 className="text-[13px] font-black text-slate-950 uppercase tracking-[0.2em] leading-none">Agent</h3>
                  <span className="text-[8px] font-black text-slate-300 uppercase tracking-[0.4em] mt-2 block leading-none">Cognitive Unit</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsSettingsOpen(true)} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-300 hover:bg-white hover:text-slate-950 transition-all border border-transparent hover:border-slate-100"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                <button onClick={() => setIsOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-300 hover:bg-white hover:text-slate-950 transition-all border border-transparent hover:border-slate-100"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="flex bg-slate-100/60 p-1 rounded-2xl gap-1 border border-slate-100/50 shadow-inner">
                {(['auto', 'pro', 'vision'] as ModelMode[]).map(mode => (
                  <button key={mode} onClick={() => setSelectedModelMode(mode)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all ${selectedModelMode === mode ? 'bg-white text-slate-950 shadow-soft border border-white' : 'text-slate-300 hover:text-slate-500'}`}>{mode}</button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex bg-slate-100/60 p-1 rounded-2xl gap-1 border border-slate-100/50 shadow-inner">
                  {(['flux', 'sdxl', 'nano-banana-pro', 'nano-banana-fast'] as DrawModel[]).map(dm => (
                    <button key={dm} onClick={() => setSelectedDrawModel(dm)} className={`flex-1 py-2 rounded-xl text-[8px] font-black uppercase tracking-tighter transition-all ${selectedDrawModel === dm ? 'bg-slate-950 text-white shadow-soft' : 'text-slate-300 hover:text-slate-500'}`}>{dm.replace('nano-banana-', '').toUpperCase()}</button>
                  ))}
                </div>
                {selectedDrawModel === 'flux' && (
                  <div className="flex justify-end px-1 -mt-1">
                    <button 
                      onClick={() => setUseLora(!useLora)} 
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all border ${useLora ? 'bg-blue-50/50 border-blue-100 text-blue-600' : 'bg-slate-50 border-slate-100 text-slate-300'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${useLora ? 'bg-blue-600 animate-pulse' : 'bg-slate-200'}`} />
                      <span className="text-[7px] font-black uppercase tracking-widest">LoRA {useLora ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6 space-y-8 bg-slate-50/10">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                <div className={`max-w-[95%] p-5 rounded-[24px] text-[13px] font-bold leading-relaxed relative shadow-premium ${msg.role === 'user' ? 'bg-slate-950 text-white' : 'bg-white border border-white text-slate-800'}`}>
                  {msg.modelUsed && <span className="absolute -top-5 left-0 text-[8px] font-black uppercase text-slate-300 tracking-[0.3em]">{msg.modelUsed}</span>}
                  <div className="whitespace-pre-wrap tracking-tight">{msg.text}</div>
                  {msg.images?.map((img, idx) => (
                    <div key={idx} className="mt-4 relative group/msgimg overflow-hidden rounded-2xl border border-slate-100 shadow-soft">
                        <img src={img.url} className="w-full object-cover max-h-[300px] transition-transform duration-1000 group-hover/msgimg:scale-110" alt="content" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex flex-col gap-2 ml-1">
                <div className="flex gap-1.5">
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                </div>
                {statusText && <span className="text-[8px] font-black text-slate-300 uppercase tracking-[0.4em] leading-none animate-pulse">{statusText}</span>}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-8 bg-white/40 border-t border-slate-100/30 backdrop-blur-3xl">
            {pendingImages.length > 0 && (
              <div className="flex gap-3 mb-5 overflow-x-auto no-scrollbar py-2">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative shrink-0 group">
                    <img src={img.url} className={`w-14 h-14 rounded-2xl object-cover border border-white shadow-premium transition-all ${img.isLoading ? 'opacity-50 blur-[2px]' : ''}`} alt="pending" />
                    {img.isLoading && (
                      <div className="absolute inset-0 flex items-center justify-center">
                         <div className="w-4 h-4 border-2 border-slate-950/20 border-t-slate-950 rounded-full animate-spin"></div>
                      </div>
                    )}
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 bg-slate-950 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-xl border-2 border-white scale-90 group-hover:scale-100 transition-all"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex items-end gap-3 bg-white border border-slate-100 p-2 rounded-[28px] shadow-premium hover:shadow-premium-hover transition-all duration-500">
              <button onClick={() => fileInputRef.current?.click()} className="w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-950 transition-all rounded-full mb-0.5 hover:bg-slate-50"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
              
              <textarea 
                ref={textareaRef} 
                placeholder="Orchestrate workspace..." 
                value={input} 
                onChange={e => setInput(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} 
                className="flex-1 bg-transparent border-none focus:outline-none text-[13px] font-bold text-slate-950 placeholder:text-slate-200 resize-none py-4 leading-relaxed tracking-tight" 
                style={{ maxHeight: '180px', minHeight: '52px' }} 
              />
              
              <div className="flex flex-col gap-2 mb-0.5">
                <button onClick={handleTranslate} disabled={!input.trim()} className="w-11 h-11 flex items-center justify-center text-slate-300 hover:text-blue-500 transition-all active:scale-90 disabled:opacity-5 hover:bg-blue-50 rounded-full"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 8l6 6M4 14l10-10M2 5h12M7 2h1M22 22l-5-10-5 10M12.8 18h8.4" /></svg></button>
                <button onClick={handleSend} disabled={isTyping || (!input.trim() && pendingImages.length === 0)} className="w-11 h-11 bg-slate-950 rounded-full flex items-center justify-center text-white shadow-premium transition-all hover:bg-black hover:scale-105 active:scale-95 disabled:opacity-5">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M5 12l7-7 7 7M12 19V5"/></svg>
                </button>
              </div>
            </div>
            
            <input type="file" ref={fileInputRef} className="hidden" multiple onChange={e => {
                const files = Array.from(e.target.files || []) as File[];
                files.forEach(f => {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const base64 = (ev.target?.result as string).split(',')[1];
                    setPendingImages(prev => [...prev, { url: ev.target?.result as string, base64, type: f.type, isLoading: false }]);
                  };
                  reader.readAsDataURL(f);
                });
              }} 
            />
            <div className="mt-6 text-center">
                <span className="text-[8px] font-black text-slate-200 uppercase tracking-[0.8em]">Neural Network Active</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeminiChat;

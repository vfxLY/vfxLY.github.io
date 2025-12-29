import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

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

const GeminiChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // 外部 API 配置状态（从 localStorage 读取）
  const [externalKey, setExternalKey] = useState<string>(localStorage.getItem('external_api_key') || '');
  const [externalBaseUrl, setExternalBaseUrl] = useState<string>(localStorage.getItem('external_base_url') || 'https://api.grsai.com');

  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: '您好，我是您的 Studio 智能助手。请在配置中心设置您的 Nano Banana 密钥以开启创作。' }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [statusText, setStatusText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const saveSettings = () => {
    localStorage.setItem('external_api_key', externalKey);
    localStorage.setItem('external_base_url', externalBaseUrl);
    setIsSettingsOpen(false);
  };

  // 工具定义
  const generateImageTool: FunctionDeclaration = {
    name: 'generate_image',
    description: '当用户要求创建、画、生成新图像时调用。使用外部 Nano Banana 引擎。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: '详细的绘图提示词。' },
        aspect_ratio: { type: Type.STRING, enum: ['1:1', '16:9', '9:16'], description: '图像比例。' }
      },
      required: ['prompt']
    }
  };

  const callExternalNanoBanana = async (params: any) => {
    if (!externalKey) throw new Error("请先在配置中心设置 GRSAI API KEY");
    
    const baseUrl = externalBaseUrl.replace(/\/$/, '');
    setStatusText('驱动 Nano Banana 引擎中...');
    
    const response = await fetch(`${baseUrl}/v1/draw/nano-banana`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${externalKey}`
      },
      body: JSON.stringify({
        model: 'nano-banana-pro',
        prompt: params.prompt,
        aspectRatio: params.aspect_ratio || "1:1",
        urls: params.images || undefined
      })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "外部引擎响应异常");
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
    const geminiKey = process.env.API_KEY || ''; 

    setInput('');
    setPendingImages([]);
    setMessages(prev => [...prev, { role: 'user', text: userText, images: currentImages.map(i => ({ url: i.url })) }]);
    setIsTyping(true);
    setStatusText('智能体思考中...');

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const userParts: any[] = currentImages.map(img => ({ 
        inlineData: { mimeType: img.type, data: img.base64 } 
      }));
      userParts.push({ text: userText });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: userParts }],
        config: {
          systemInstruction: "你是一个高级艺术创作管家。你可以通过调用工具 'generate_image' 来使用外部引擎。",
          tools: [{ functionDeclarations: [generateImageTool] }]
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const fc of response.functionCalls) {
          const args = fc.args as any;
          if (fc.name === 'generate_image') {
            const url = await callExternalNanoBanana(args);
            setMessages(prev => [...prev, { role: 'model', text: `生成完毕。`, images: [{ url }] }]);
            window.dispatchEvent(new CustomEvent('add-image-to-canvas', { detail: { src: url, prompt: args.prompt } }));
          } 
        }
      } else {
        setMessages(prev => [...prev, { role: 'model', text: response.text || "已处理。" }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'model', text: `错误: ${error.message}`, isError: true }]);
    } finally {
      setIsTyping(false);
      setStatusText('');
    }
  };

  return (
    <>
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} className="fixed right-8 top-8 w-14 h-14 bg-white border border-slate-200 rounded-2xl shadow-xl flex items-center justify-center text-slate-600 transition-all hover:scale-110 z-[100] group active:scale-95">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
        </button>
      )}

      {/* 高端白色配置中心 */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-md" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-[420px] bg-white rounded-[32px] shadow-[0_50px_100px_rgba(0,0,0,0.1)] overflow-hidden animate-fade-in border border-slate-100">
            <div className="p-8 pb-4 flex items-center justify-between">
              <h2 className="text-2xl font-black text-slate-900">配置中心</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-300 hover:text-slate-900 transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="p-8 pt-6 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">GRSAI API KEY</label>
                <input 
                  type="password" 
                  value={externalKey} 
                  onChange={e => setExternalKey(e.target.value)}
                  placeholder="sk-..." 
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-slate-300"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">BASE URL (代理地址)</label>
                <input 
                  type="text" 
                  value={externalBaseUrl} 
                  onChange={e => setExternalBaseUrl(e.target.value)}
                  placeholder="https://api.grsai.com" 
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-slate-300"
                />
              </div>
              <button onClick={saveSettings} className="w-full py-5 bg-slate-950 text-white rounded-[20px] text-sm font-black shadow-xl hover:bg-black transition-all active:scale-95 mt-4">
                保存并应用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 高端白色对话框 */}
      <div className={`fixed right-6 top-6 bottom-6 w-[440px] z-[100] transition-all duration-700 ease-[cubic-bezier(0.2,1,0.2,1)] transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-[500px] opacity-0'}`}>
        <div className="w-full h-full glass-panel rounded-[40px] shadow-[0_40px_80px_rgba(0,0,0,0.08)] flex flex-col relative overflow-hidden border border-white bg-white/80 backdrop-blur-3xl">
          
          <div className="p-8 border-b border-slate-100/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Studio Agent</h3>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Nano Pro Service</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setIsSettingsOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-all">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
              </button>
              <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-all">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                <div className={`max-w-[90%] p-5 rounded-[24px] text-xs font-bold leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : msg.isError ? 'bg-rose-50 border border-rose-100 text-rose-500' : 'bg-white border border-slate-100 text-slate-800 shadow-sm'}`}>
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                  {msg.images && msg.images.map((img, idx) => (
                    <img key={idx} src={img.url} className="mt-4 rounded-xl border border-slate-100 shadow-md w-full" />
                  ))}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex flex-col gap-2 ml-2">
                <div className="flex gap-1.5">
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                </div>
                {statusText && <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{statusText}</span>}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-8 bg-slate-50/50 border-t border-slate-100">
            {pendingImages.length > 0 && (
              <div className="flex gap-2 mb-4">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative group shrink-0">
                    <img src={img.url} className="w-12 h-12 rounded-lg object-cover border border-white shadow-sm" />
                    <button onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-3 bg-white border border-slate-200 rounded-[24px] p-3 focus-within:border-blue-500/30 transition-all shadow-sm">
              <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-slate-900 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
              <textarea 
                rows={1} 
                placeholder="在此输入您的创意指令..." 
                value={input} 
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                className="flex-1 bg-transparent border-none focus:outline-none text-xs font-bold text-slate-800 placeholder:text-slate-300 resize-none py-2" 
              />
              <button onClick={handleSend} disabled={isTyping} className="w-10 h-10 bg-slate-950 rounded-xl flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-20"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l7-7 7 7M12 19V5"/></svg></button>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              onChange={e => {
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
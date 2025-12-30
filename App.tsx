
import React, { useState } from 'react';
import InfiniteCanvasTab from './components/features/InfiniteCanvasTab';
import GeminiChat from './components/features/GeminiChat';

const App = () => {
  const [serverUrl, setServerUrl] = useState('https://17610400098.top');

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#FFFFFF] relative selection:bg-slate-950 selection:text-white">
      {/* High-End Architectural Ambient Layer */}
      <div className="absolute top-[-30%] right-[-15%] w-[1400px] h-[1400px] rounded-full bg-slate-100/40 blur-[200px] pointer-events-none mix-blend-multiply z-0 animate-float" />
      <div className="absolute bottom-[-20%] left-[-5%] w-[1000px] h-[1000px] rounded-full bg-blue-50/20 blur-[180px] pointer-events-none mix-blend-multiply z-0" />
      <div className="absolute inset-0 architectural-grid opacity-80 z-0 pointer-events-none" />
      
      {/* Main Canvas Layer */}
      <InfiniteCanvasTab serverUrl={serverUrl} setServerUrl={setServerUrl} />
      
      {/* AI Assistant Overlay */}
      <GeminiChat />
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.99) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export default App;

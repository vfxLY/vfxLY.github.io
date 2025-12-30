
import React, { useState } from 'react';
import InfiniteCanvasTab from './components/features/InfiniteCanvasTab';
import GeminiChat from './components/features/GeminiChat';

const App = () => {
  const [serverUrl, setServerUrl] = useState('https://17610400098.top');

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#FFFFFF] relative selection:bg-slate-950 selection:text-white">
      {/* High-End Architectural Ambient Layer */}
      <div className="absolute top-[-30%] right-[-20%] w-[1200px] h-[1200px] rounded-full bg-slate-100/40 blur-[180px] pointer-events-none mix-blend-multiply z-0 animate-float" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] rounded-full bg-blue-50/30 blur-[150px] pointer-events-none mix-blend-multiply z-0" />
      <div className="absolute inset-0 architectural-grid opacity-60 z-0 pointer-events-none" />
      
      {/* Main Canvas Layer */}
      <InfiniteCanvasTab serverUrl={serverUrl} setServerUrl={setServerUrl} />
      
      {/* AI Assistant Overlay */}
      <GeminiChat />
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.99) translateY(15px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export default App;

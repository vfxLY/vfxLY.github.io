
import React, { useState } from 'react';
import InfiniteCanvasTab from './components/features/InfiniteCanvasTab';
import GeminiChat from './components/features/GeminiChat';

const App = () => {
  const [serverUrl, setServerUrl] = useState('https://17610400098.top');

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f8fafc] relative selection:bg-slate-900 selection:text-white">
      {/* Premium Ambient Background Mesh */}
      <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] rounded-full bg-blue-100/30 blur-[120px] pointer-events-none mix-blend-multiply z-0" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-100/30 blur-[100px] pointer-events-none mix-blend-multiply z-0" />
      
      {/* Main Canvas Layer */}
      <InfiniteCanvasTab serverUrl={serverUrl} setServerUrl={setServerUrl} />
      
      {/* AI Assistant Overlay */}
      <GeminiChat />
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export default App;

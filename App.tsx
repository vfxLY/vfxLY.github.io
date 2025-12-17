import React, { useState } from 'react';
import InfiniteCanvasTab from './components/features/InfiniteCanvasTab';

const App = () => {
  const [serverUrl, setServerUrl] = useState('https://17610400098.top');

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f8fafc] relative">
      {/* Premium Ambient Background Mesh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] right-[-5%] w-[800px] h-[800px] rounded-full bg-blue-100/40 blur-[120px] mix-blend-multiply animate-blob" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[100px] mix-blend-multiply animate-blob animation-delay-2000" />
          <div className="absolute top-[30%] left-[20%] w-[500px] h-[500px] rounded-full bg-purple-50/50 blur-[80px] mix-blend-multiply animate-blob animation-delay-4000" />
      </div>
      
      <InfiniteCanvasTab serverUrl={serverUrl} setServerUrl={setServerUrl} />
      
      <style>{`
        .animation-delay-2000 {
            animation-delay: 2s;
        }
        .animation-delay-4000 {
            animation-delay: 4s;
        }
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
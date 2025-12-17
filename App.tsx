import React, { useState } from 'react';
import InfiniteCanvasTab from './components/features/InfiniteCanvasTab';

const App = () => {
  const [serverUrl, setServerUrl] = useState('https://17610400098.top');

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f8fafc] relative">
      {/* Premium Ambient Background Mesh */}
      <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] rounded-full bg-blue-100/40 blur-[120px] pointer-events-none mix-blend-multiply" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[100px] pointer-events-none mix-blend-multiply" />
      <div className="absolute top-[40%] left-[30%] w-[400px] h-[400px] rounded-full bg-purple-50/50 blur-[80px] pointer-events-none mix-blend-multiply" />
      
      <InfiniteCanvasTab serverUrl={serverUrl} setServerUrl={setServerUrl} />
      
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
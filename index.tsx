
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 为外部环境运行提供基础的安全垫，防止 process 未定义导致的崩溃
// Fix: Use type casting for window to resolve property 'process' existence error
if (typeof window !== 'undefined' && !(window as any).process) {
  // @ts-ignore
  (window as any).process = { env: {} };
}

console.log("Starting Application...");

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Fix: Explicitly declare props and state as class properties to ensure they are recognized by TypeScript
  public props: ErrorBoundaryProps;
  public state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    // State is now initialized as a class property above
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    // Fix: Accessing state on the instance
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: '#ef4444', fontFamily: 'sans-serif', textAlign: 'center', marginTop: '50px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Studio Runtime Exception</h1>
          <p style={{ background: '#fee2e2', padding: '15px', borderRadius: '12px', display: 'inline-block', marginTop: '10px', maxWidth: '80%' }}>
            {this.state.error?.message}
          </p>
          <div style={{ marginTop: '20px', fontSize: '12px', color: '#94a3b8' }}>
            Ensure your environment is correctly configured or select an API key.
          </div>
          <br/>
          <button 
            onClick={() => window.location.reload()} 
            style={{ marginTop: '20px', padding: '10px 24px', cursor: 'pointer', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}
          >
            Reload Studio
          </button>
        </div>
      );
    }

    // Fix: Accessing props on the instance
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error("CRITICAL: Could not find root element to mount to");
  throw new Error("Could not find root element to mount to");
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  console.log("Application mounted successfully.");
} catch (e) {
  console.error("Failed to mount application:", e);
}

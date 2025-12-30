import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 为外部环境运行提供基础的安全垫，防止 process 未定义导致的崩溃
if (typeof window !== 'undefined' && !(window as any).process) {
  (window as any).process = { env: {} };
}

console.log("Starting Application...");

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Fix: Explicitly inherit from Component with generics and declare state to resolve "Property does not exist" errors
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Fix: Explicitly declare state to resolve "Property 'state' does not exist" error
  public state: ErrorBoundaryState = { hasError: false, error: null };

  // Fix: Explicitly declare props to resolve "Property 'props' does not exist" error on line 63
  public props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    // Fix: Initialize the declared props property
    this.props = props;
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    // Fix: Use declared state property
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', color: '#0f172a', fontFamily: "'Plus Jakarta Sans', sans-serif", textAlign: 'center', marginTop: '100px' }}>
          <div style={{ width: '80px', height: '80px', background: '#fee2e2', borderRadius: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.02em' }}>Neural Runtime Interruption</h1>
          <p style={{ background: '#f8fafc', padding: '24px', borderRadius: '24px', display: 'inline-block', marginTop: '20px', maxWidth: '500px', fontSize: '14px', lineHeight: '1.6', color: '#64748b', border: '1px solid #f1f5f9' }}>
            {this.state.error?.message}
          </p>
          <div style={{ marginTop: '32px' }}>
            <button 
              onClick={() => window.location.reload()} 
              style={{ padding: '14px 32px', cursor: 'pointer', background: '#0f172a', color: 'white', border: 'none', borderRadius: '16px', fontWeight: '800', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}
            >
              Restart Session
            </button>
          </div>
        </div>
      );
    }

    // Fix: Use declared props property
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
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
} catch (e) {
  console.error("Failed to mount application:", e);
}

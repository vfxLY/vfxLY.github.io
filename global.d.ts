
declare global {
  // Fix: Define AIStudio interface to match the global type name used by the environment
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    // Fixed: Subsequent property declarations must have the same type. 
    // Property 'aistudio' must be of type 'AIStudio'.
    aistudio?: AIStudio;
  }

  namespace NodeJS {
    interface ProcessEnv {
      API_KEY: string;
    }
  }

  // Fix: Define Process interface to match the global type name used by the environment
  interface Process {
    env: {
      API_KEY?: string;
      [key: string]: string | undefined;
    };
  }

  // Use 'any' or a safe object for process to prevent build errors in non-node environments
  // Fixed: Subsequent variable declarations must have the same type. 
  // Variable 'process' must be of type 'Process'.
  var process: Process;
}

export {};

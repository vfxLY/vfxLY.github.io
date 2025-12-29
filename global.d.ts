
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
    // Fix: Explicitly add process property to Window interface for environment safety checks
    process?: any;
  }

  // Augment the NodeJS namespace to ensure process.env.API_KEY is correctly typed.
  // This is the standard approach and avoids conflicts with existing global declarations of 'process'.
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY: string;
      [key: string]: string;
    }
  }

  // Removed redundant 'interface Process' and 'var process' declarations
  // which were causing "Subsequent variable declarations must have the same type" errors.
}

export {};

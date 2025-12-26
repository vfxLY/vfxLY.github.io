
declare global {
  interface Window {
    /**
     * The aistudio object is injected into the window context by the platform.
     * Inlined the members to avoid potential duplicate identifier conflicts with global AIStudio declarations.
     */
    aistudio?: {
      /**
       * Checks if the user has already selected an API key.
       */
      hasSelectedApiKey: () => Promise<boolean>;
      /**
       * Opens the dialog for the user to select an API key.
       */
      openSelectKey: () => Promise<void>;
    };
  }

  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The API key used for Google GenAI calls, injected by the environment.
       */
      API_KEY: string;
    }
  }

  /**
   * Declares process as a global variable to satisfy TypeScript when accessing process.env.
   * Fixed: Reference the existing 'Process' type to resolve type conflict with environment-provided types.
   */
  var process: Process;
}

// Exporting an empty object ensures this file is treated as a module.
export {};

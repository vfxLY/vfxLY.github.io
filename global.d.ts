
declare global {
  /**
   * Define the AIStudio interface to provide type information for the
   * globally available aistudio object. This interface will merge with
   * any existing definitions in the environment, resolving type mismatch errors.
   */
  interface AIStudio {
    hasSelectedApiKey(): Promise<boolean>;
    openSelectKey(): Promise<void>;
  }

  interface Window {
    /**
     * Note: 'aistudio' is already declared on the Window interface as 'AIStudio' 
     * by the environment. Re-declaring it here with different modifiers or 
     * an inline object type causes compilation errors.
     */
  }

  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The API key is automatically injected by the environment.
       */
      API_KEY: string;
    }
  }
}

// Ensure this file is treated as a module
export {};

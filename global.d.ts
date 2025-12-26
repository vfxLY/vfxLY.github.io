
declare global {
  /**
   * AIStudio interface is merged with the existing platform definition.
   * Redundant method declarations are removed to resolve "Duplicate identifier" errors
   * as they are already provided by the ambient environment.
   */
  interface AIStudio {
  }

  interface Window {
    /**
     * Platform-injected objects like aistudio are typically optional on the Window interface.
     * Adding the '?' modifier ensures compatibility with existing global declarations
     * and fixes the "All declarations of 'aistudio' must have identical modifiers" error.
     */
    aistudio?: AIStudio;
  }

  namespace NodeJS {
    interface ProcessEnv {
      /**
       * Injected API key used for Gemini API calls.
       */
      API_KEY: string;
    }
    interface Process {
      env: ProcessEnv;
    }
  }

  /**
   * Declares the process variable in the global scope to support process.env.API_KEY usage
   * throughout the application.
   */
  var process: NodeJS.Process;
}

export {};

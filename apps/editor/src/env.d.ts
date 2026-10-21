interface ImportMetaEnv {
  /** Base URL of the ATS service, such as http://localhost:8000. */
  readonly VITE_ATS_SERVICE_URL?: string;
  /**
   * The Supabase project's address, such as the local stack's http://127.0.0.1:54321 (milestone 4).
   * With it or the key unset, the editor has no accounts and shows no way to sign in.
   */
  readonly VITE_SUPABASE_URL?: string;
  /** The Supabase project's publishable key, a public key meant for the browser. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

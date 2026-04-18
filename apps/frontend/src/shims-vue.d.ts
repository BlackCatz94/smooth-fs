/**
 * Vue Single-File Component module shim.
 *
 * `vue-tsc` (Volar) normally resolves `.vue` imports via its own virtual
 * module system, but that resolution is environment-dependent — it can
 * silently stop working when the type-checker runs in a clean Docker
 * build without a warmed `.tsbuildinfo` / language-service cache.
 *
 * Declaring the ambient module here is the canonical, environment-
 * independent fallback used by Vite's own project template. It only
 * kicks in when Volar's virtual resolution misses, so it never masks
 * real prop/emit typing produced by `defineComponent`.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}

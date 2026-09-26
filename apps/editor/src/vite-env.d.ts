/**
 * The shape of `import.meta.env` for the editor page, declared rather than taken from
 * `vite/client`, whose `any`-typed index signature would put an implicit `any` on the one value this
 * page reads. Same arrangement, and the same reason, as `apps/runtime/src/vite-env.d.ts`.
 */

interface ImportMetaEnv {
  /**
   * The relay's MQTT-over-WebSockets URL, e.g. `ws://localhost:53123`, set by `tools/dev-stack.mjs`
   * to the port the relay reported binding. Unset means no relay: the preview shows sample data.
   */
  readonly PERCH_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

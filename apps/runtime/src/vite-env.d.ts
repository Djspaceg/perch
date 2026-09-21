/**
 * The shape of `import.meta.env` for this page — declared here rather than pulled in from
 * `vite/client`.
 *
 * Two reasons, and the first is the standing rule. `vite/client`'s `ImportMetaEnv` carries an
 * index signature typed `any`, so `import.meta.env.ANYTHING_AT_ALL` type-checks and arrives as
 * `any`: one `/// <reference types="vite/client" />` would put an implicit `any` on the exact
 * value the mock/MQTT decision is made from. Declaring the one variable this page reads keeps the
 * value `string | undefined`, which is what it actually is, and makes a typo a compile error
 * instead of a silent `undefined` that quietly selects the mock.
 *
 * Second, it documents the contract. `PERCH_BROKER_URL` only reaches the browser because
 * `vite.config.ts` widens `envPrefix` to accept `PERCH_`; without that, Vite exposes nothing but
 * `VITE_*` and this would be `undefined` however the shell was set up. The declaration and the
 * config are two halves of one mechanism.
 */

interface ImportMetaEnv {
  /**
   * The relay's MQTT-over-WebSockets URL, e.g. `ws://localhost:9001`.
   *
   * Optional, and its absence is meaningful rather than a misconfiguration: unset means "no
   * hardware here, use the mock", which is what `npm run dev` on a machine with the sensor host
   * powered off has to keep doing. See the seam in `main.tsx`.
   */
  readonly PERCH_BROKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

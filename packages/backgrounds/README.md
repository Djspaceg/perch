# `@perch/backgrounds`

Thermalright's hosted video backgrounds: the static catalogue, the rule that picks a hosted size
for a layout's target, and a Node download cache with a ranged file server over it. The spec is
[docs/backgrounds.md](../../docs/backgrounds.md).

- `@perch/backgrounds`: browser-safe. Categories, ids, labels ("Gallery 42"), `pickHostedSize`.
- `@perch/backgrounds/node`: `createBackgroundCache` (inject `fetch` and `urlFor`) and
  `serveCachedFile`. No Electron: the desktop main process and the Vite dev servers both use it.

The content is Thermalright's. It is fetched at run time into a cache and never committed,
bundled or packaged.

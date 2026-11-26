/**
 * Paths, besides `/`, that the app is served on.
 *
 * Adding a path here lets the service worker serve the cached app for it
 * (see `navigateFallbackAllowlist` in vite.config.mts). The host must serve
 * the app for it too, or the path is a 404: add a matching rewrite to
 * `/index.html` in the root vercel.json (tests/appRoutes.test.ts checks it).
 */
// flowapi: the Excalidraw+ export route is removed (see REMOVED.md)
export const APP_ROUTES = {} as const;

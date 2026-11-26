# Removed upstream features

This fork (FlowAPI) removes Excalidraw features that do not fit a local-first project-design tool. Each removal is one commit, so it can be reviewed or restored on its own with `git revert <commit>` (or by cherry-picking the upstream files back).

Rules:

- One feature per commit, with the commit subject `remove(<feature>): ...`.
- Add a section here in the same commit.
- Library code in `packages/excalidraw` is changed only where the app cannot turn a feature off from outside. Such edits are marked `// flowapi:`.
- Translation keys stay in the locale files, so upstream merges stay simple.

## Excalidraw+ (promos, export, sign up)

- **Why:** paid upstream service; the app must not point users to it or send scenes to it.
- **What went:** the top-right "Try Excalidraw+" banner, menu and welcome screen "Excalidraw+" / "Sign up" links, command palette entries, "Export to Excalidraw+" in the export dialog and overwrite dialog, the `/excalidraw-plus-export` iframe route, the comments and presentation promo tabs in the sidebar (and their images), the Excalidraw+ auto-redirect in `index.html`, the sign-in cookie check, and the `VITE_APP_PLUS_APP` / `VITE_APP_PLUS_EXPORT_PUBLIC_KEY` settings.
- **Files:** `excalidraw-app/components/ExportToExcalidrawPlus.tsx`, `ExcalidrawPlusPromoBanner.tsx`, `AppSidebar.tsx`, `AppSidebar.scss`, `excalidraw-app/ExcalidrawPlusIframeExport.tsx`, `public/sidebar-*-promo-*.jpg` deleted; `App.tsx`, `AppMainMenu.tsx`, `AppWelcomeScreen.tsx`, `AppFooter.tsx`, `app_constants.ts`, `app_routes.ts`, `vercel.json`, `index.html`, `index.scss`, `.env.*` edited.
- **Left for later:** the "Excalidraw+ blog" link in the library Help dialog.

## AI (text to diagram, wireframe to code)

- **Why:** no AI features for now (decided 2026-11-25); they also send drawings to an upstream backend.
- **What went:** the Text to diagram dialog and its chat history store, the Wireframe to code (diagram-to-code) frame tool, the toolbar and command palette entries for both, and the `VITE_APP_AI_BACKEND` / `VITE_APP_PLUS_LP` settings. The app passes `aiEnabled={false}` to the editor, which hides every AI entry point in the library.
- **Side effect:** the library's Mermaid to Excalidraw tab lives in the same dialog, so it is hidden too. FlowAPI reads Mermaid itself, so nothing is lost; the tab can come back without AI if we want it.
- **Files:** `excalidraw-app/components/AI.tsx` and `data/TTDStorage.ts` deleted (`data/cacheMermaidChunks.ts` stays, the build uses it); `App.tsx`, `vite-env.d.ts`, `.env.*` edited.

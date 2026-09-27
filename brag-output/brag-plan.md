# /brag plan — Renz

**What it is:** An AI app builder: describe an app, Renz's LLM backend streams the code file by file, and a WebContainer runs the generated React/Node project with a live preview — all in the browser.
**Who it's for:** Builders who want to go from an idea to a running prototype without setting up a local environment.
**What sets it apart:** Code + live preview in one tab — template → streamed files → Monaco editor → WebContainer dev server, then keep iterating by chat.
**Most impressive claim:** "Idea to app in seconds."
**Visual hook:** The real landing typewriter — "Build a SaaS dashboard".
**Tone:** default — punchy, dark, amber-to-red.
**Share caption:** "Idea to app in seconds."

## Visual identity (from the code)
- Background `#06060a`, panels `#0c0c12`, zinc borders, amber → orange → red gradient (`Frontend/src/pages/LandingPage.tsx`, `CodeView.tsx`)
- Landing copy, badge, rotating words and "Try an idea" examples from `LandingPage.tsx` (captured from the running Vite app for reference)
- Build view layout from `CodeView.tsx`: chat sidebar, File Explorer, Code / Preview tabs; preview statuses ("Booting WebContainer…", "Mounting project files…", "Installing dependencies…", "Starting dev server…", "Preview ready") from `components/PreviewFrame.tsx`
- File tree = the real React template in `Backend/src/defaults/react.ts` + generated components
- Inter substitutes for the system font stack the app uses
- The generated Kanban app in the preview is illustrative of the "Create a Kanban board like Trello" example prompt

## Storyboard (21s, 1920×1080 @ 30fps)
| # | Time | Scene | On screen |
|---|------|-------|-----------|
| 1 | 0.0–3.6 | **Hook** | "Build a SaaS dashboard" → "a task manager" typewriter |
| 2 | 3.6–6.8 | **Prompt** | "Create a Kanban board like Trello" typed, send |
| 3 | 6.8–11.9 | **Generate** | Steps tick off, files appear, Board.tsx streams into the editor — "It writes the code — file by file." |
| 4 | 11.9–15.8 | **Run** | Preview tab: WebContainer boot + npm install/dev → the Kanban app; a card is dragged across — "Then runs it — right in your browser." |
| 5 | 15.8–18.4 | **Iterate** | "Keep chatting. It keeps building." + tech chips |
| 6 | 18.4–21.0 | **Outro** | Logo + "Idea to app in seconds." + renzai.vercel.app |

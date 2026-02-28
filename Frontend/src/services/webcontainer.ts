/**
 * WebContainer service
 *
 * Manages an in-browser Node.js runtime (StackBlitz WebContainers API)
 * that can mount LLM-generated files, install packages, run a dev
 * server, and expose a URL for iframe preview.
 */

import { WebContainer, FileSystemTree } from "@webcontainer/api";
import { FileStructure } from "../Types";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface TerminalOutput {
  type: "stdout" | "stderr" | "info" | "error";
  text: string;
}

export type OutputCallback = (output: TerminalOutput) => void;
export type UrlCallback = (url: string) => void;

// ────────────────────────────────────────────
// Singleton
// ────────────────────────────────────────────

let _instance: WebContainer | null = null;
let _booting: Promise<WebContainer> | null = null;

/**
 * Returns the singleton WebContainer instance.
 * Boots one if it doesn't exist yet.
 */
export async function getWebContainer(): Promise<WebContainer> {
  if (_instance) return _instance;

  if (!_booting) {
    _booting = WebContainer.boot().then((wc) => {
      _instance = wc;
      return wc;
    });
  }

  return _booting;
}

// ────────────────────────────────────────────
// File tree conversion
// ────────────────────────────────────────────

/**
 * Converts the app's FileStructure (nested string | object map)
 * into the WebContainer FileSystemTree format.
 */
export function toFileSystemTree(structure: FileStructure): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [name, value] of Object.entries(structure)) {
    if (typeof value === "string") {
      tree[name] = {
        file: { contents: value },
      };
    } else {
      tree[name] = {
        directory: toFileSystemTree(value as FileStructure),
      };
    }
  }

  return tree;
}

// ────────────────────────────────────────────
// High-level helpers
// ────────────────────────────────────────────

/**
 * Mount files into the WebContainer, wiping previous contents.
 */
export async function mountFiles(
  structure: FileStructure,
  onOutput?: OutputCallback,
): Promise<void> {
  const wc = await getWebContainer();
  const tree = toFileSystemTree(structure);
  onOutput?.({ type: "info", text: "📂 Mounting files…" });
  await wc.mount(tree);
  onOutput?.({ type: "info", text: "✅ Files mounted." });
}

/**
 * Run `npm install` inside the WebContainer.
 * Streams terminal output via the callback.
 * Returns exit code.
 */
export async function installDependencies(
  onOutput?: OutputCallback,
): Promise<number> {
  const wc = await getWebContainer();
  onOutput?.({ type: "info", text: "📦 Installing dependencies…" });

  const proc = await wc.spawn("npm", ["install"]);

  proc.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput?.({ type: "stdout", text: data });
      },
    }),
  );

  const exitCode = await proc.exit;
  if (exitCode !== 0) {
    onOutput?.({
      type: "error",
      text: `npm install failed (exit ${exitCode})`,
    });
  } else {
    onOutput?.({ type: "info", text: "✅ Dependencies installed." });
  }
  return exitCode;
}

/**
 * Start the dev server (`npm run dev`) and listen for the
 * server-ready URL.  Returns a teardown function.
 */
export async function startDevServer(
  onOutput?: OutputCallback,
  onUrl?: UrlCallback,
): Promise<() => void> {
  const wc = await getWebContainer();
  onOutput?.({ type: "info", text: "🚀 Starting dev server…" });

  const proc = await wc.spawn("npm", ["run", "dev"]);

  proc.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput?.({ type: "stdout", text: data });
      },
    }),
  );

  // WebContainer fires this when the server starts listening
  wc.on("server-ready", (_port: number, url: string) => {
    onOutput?.({ type: "info", text: `🌐 Server ready at ${url}` });
    onUrl?.(url);
  });

  // Return teardown
  return () => {
    proc.kill();
  };
}

/**
 * One-shot: mount → install → dev server.
 * Returns { url (Promise), teardown }.
 */
export async function runProject(
  fileStructure: FileStructure,
  onOutput?: OutputCallback,
): Promise<{ urlPromise: Promise<string>; teardown: () => void }> {
  // 1. Mount
  await mountFiles(fileStructure, onOutput);

  // 2. Install
  const exitCode = await installDependencies(onOutput);
  if (exitCode !== 0) {
    throw new Error("npm install failed");
  }

  // 3. Dev server
  let resolveUrl: (url: string) => void;
  const urlPromise = new Promise<string>((resolve) => {
    resolveUrl = resolve;
  });

  const teardown = await startDevServer(onOutput, (url) => {
    resolveUrl!(url);
  });

  return { urlPromise, teardown };
}

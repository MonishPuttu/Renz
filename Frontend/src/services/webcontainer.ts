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
// Constants
// ────────────────────────────────────────────

const INSTALL_TIMEOUT_MS = 120_000; // 2 minutes for npm install
const SERVER_READY_TIMEOUT_MS = 30_000; // 30 seconds for dev server to start

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
// Helpers
// ────────────────────────────────────────────

/** Create a timeout promise that rejects after `ms` milliseconds */
function timeoutPromise<T>(
  ms: number,
  label: string,
): { promise: Promise<T>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  const cancel = () => clearTimeout(timer);
  return { promise, cancel };
}

/**
 * Consume a process's output stream using a manual reader.
 * This avoids the pipeTo() deadlock that can occur in WebContainer
 * where proc.exit won't resolve until the output stream is fully consumed.
 * Errors are caught and logged rather than propagated.
 */
function consumeOutput(
  output: ReadableStream<string>,
  onOutput?: OutputCallback,
  type: "stdout" | "stderr" = "stdout",
): Promise<void> {
  const reader = output.getReader();

  async function pump(): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          onOutput?.({ type, text: value });
        }
      }
    } catch (err) {
      // Stream may be cancelled during teardown — that's expected
      const msg = String(err);
      if (
        msg.includes("aborted") ||
        msg.includes("cancel") ||
        msg.includes("locked")
      )
        return;
      console.warn(`Stream read error (${type}):`, err);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
  }

  return pump();
}

/** Try to extract a URL from stdout text (fallback if server-ready event doesn't fire) */
function extractUrlFromText(text: string): string | null {
  // Match common Vite/dev server URL patterns
  const urlMatch =
    text.match(
      /(?:Local|Network|ready at|listening on)[:\s]+(https?:\/\/[^\s]+)/i,
    ) || text.match(/(https?:\/\/localhost[:\d]*\/?)/i);
  return urlMatch ? urlMatch[1] : null;
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
  onOutput?.({ type: "info", text: "[mount] Mounting files..." });
  await wc.mount(tree);
  onOutput?.({ type: "info", text: "[mount] Files mounted." });
}

/**
 * Run `npm install` inside the WebContainer.
 * Streams terminal output via the callback.
 * Returns exit code, or throws on timeout.
 */
export async function installDependencies(
  onOutput?: OutputCallback,
): Promise<number> {
  const wc = await getWebContainer();
  onOutput?.({ type: "info", text: "[npm] Installing dependencies..." });

  const proc = await wc.spawn("npm", [
    "install",
    "--no-audit",
    "--no-fund",
    "--no-progress",
  ]);

  // Start reading output in background (must happen so proc.exit can resolve)
  const outputDone = consumeOutput(proc.output, onOutput, "stdout");

  // Race exit vs timeout — both run concurrently with output consumption
  const { promise: timeout, cancel: cancelTimeout } = timeoutPromise<number>(
    INSTALL_TIMEOUT_MS,
    "npm install",
  );

  let exitCode: number;
  try {
    exitCode = await Promise.race([proc.exit, timeout]);
    cancelTimeout();
  } catch (err) {
    cancelTimeout();
    try {
      proc.kill();
    } catch {
      /* process may have already exited */
    }
    onOutput?.({
      type: "error",
      text: `[timeout] npm install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`,
    });
    throw err;
  }

  // Give output a short window to flush, then move on regardless
  await Promise.race([outputDone, new Promise((r) => setTimeout(r, 2000))]);

  if (exitCode !== 0) {
    onOutput?.({
      type: "error",
      text: `npm install failed (exit ${exitCode})`,
    });
  } else {
    onOutput?.({ type: "info", text: "[npm] Dependencies installed." });
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
  onOutput?.({ type: "info", text: "[dev] Starting dev server..." });

  const proc = await wc.spawn("npm", ["run", "dev"]);

  let urlResolved = false;

  // Consume output — also try to extract URL from stdout as a fallback
  consumeOutput(
    proc.output,
    (output) => {
      onOutput?.(output);
      // Fallback: try to extract URL from stdout in case server-ready doesn't fire
      if (!urlResolved) {
        const url = extractUrlFromText(output.text);
        if (url) {
          urlResolved = true;
          onOutput?.({ type: "info", text: `[dev] Server detected at ${url}` });
          onUrl?.(url);
        }
      }
    },
    "stdout",
  );

  // Primary: WebContainer fires this when the server starts listening
  const serverReadyHandler = (_port: number, url: string) => {
    if (urlResolved) return;
    urlResolved = true;
    onOutput?.({ type: "info", text: `[dev] Server ready at ${url}` });
    onUrl?.(url);
  };

  wc.on("server-ready", serverReadyHandler);

  // Return teardown
  return () => {
    proc.kill();
    // Note: WebContainer API doesn't expose off(), but killing the process
    // is sufficient — the handler becomes a no-op because urlResolved is true.
    urlResolved = true;
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
    throw new Error("npm install failed — check terminal for details");
  }

  // 3. Dev server
  let resolveUrl: (url: string) => void;
  let rejectUrl: (err: Error) => void;
  const urlPromise = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });

  const teardown = await startDevServer(onOutput, (url) => {
    resolveUrl!(url);
  });

  // Timeout for server-ready — don't hang forever
  const serverTimeout = setTimeout(() => {
    rejectUrl!(
      new Error(
        `Dev server did not start within ${SERVER_READY_TIMEOUT_MS / 1000}s`,
      ),
    );
  }, SERVER_READY_TIMEOUT_MS);

  // Clear timeout once URL resolves
  urlPromise
    .then(() => clearTimeout(serverTimeout))
    .catch(() => clearTimeout(serverTimeout));

  return { urlPromise, teardown };
}

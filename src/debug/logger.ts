import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Debug Mode's log format — designed to be read by whoever is diagnosing a report the
 * user attaches this file to, not by the app itself:
 *
 *   2026-08-01T12:34:56.789Z [ERROR] [uncaught] TypeError: x is undefined | data={"stack":"..."}
 *
 * One line per event: an ISO-8601 timestamp (sortable, unambiguous across timezones), a
 * level, a short category tag (grep target — "sketch", "rebuild", "uncaught", ...), a
 * human-readable message, and an optional `| data=<json>` suffix for anything structured
 * worth keeping (an error's stack, a feature's parameters, ...). Plain newline-delimited
 * text rather than one-JSON-object-per-line or an NDJSON log: still greppable, but also
 * directly readable without a formatter.
 */
type LogLevel = "INFO" | "WARN" | "ERROR";

let buffer: string[] = [];
let resolvedPath: string | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let installed = false;

function formatLine(level: LogLevel, category: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const suffix = data === undefined ? "" : ` | data=${safeStringify(data)}`;
  return `${timestamp} [${level}] [${category}] ${message}${suffix}`;
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/** Records one log line. Always echoed to the console (useful during development
 * regardless of Debug Mode); only buffered for the on-disk file while Debug Mode is on
 * and running under Tauri, where `flush()` actually has somewhere to write it. */
export function logDebug(category: string, message: string, data?: unknown): void {
  const line = formatLine("INFO", category, message, data);
  console.debug(line);
  if (installed) buffer.push(line);
}

function logInternal(level: LogLevel, category: string, message: string, data?: unknown): void {
  const line = formatLine(level, category, message, data);
  if (installed) buffer.push(line);
}

async function flush(): Promise<void> {
  if (buffer.length === 0 || !isTauri()) return;
  const contents = buffer.join("\n") + "\n";
  buffer = [];

  try {
    resolvedPath = await invoke<string>("append_debug_log", { contents });
  } catch (error) {
    // Losing a batch of debug log lines is not worth surfacing to the user — the whole
    // point of this feature is to stay out of the way. Put it back in the console at
    // least, since that's still visible in a dev session.
    console.error("[debug-log] flush failed:", error);
  }
}

/** Resolves and returns the log file's path (without writing anything), for Settings to
 * display once Debug Mode is switched on. Returns `null` outside Tauri (browser preview
 * has no filesystem to write to). */
export async function resolveDebugLogPath(): Promise<string | null> {
  if (!isTauri()) return null;
  if (resolvedPath) return resolvedPath;

  try {
    resolvedPath = await invoke<string>("get_debug_log_path");
    return resolvedPath;
  } catch {
    return null;
  }
}

/**
 * Turns Debug Mode on: captures uncaught exceptions, unhandled promise rejections, and
 * `console.error`/`console.warn` calls into the log buffer, and starts the periodic
 * flush that actually writes it to disk. Idempotent — calling this while already
 * installed does nothing, so the settings toggle's effect can just call it unconditionally.
 */
export function installDebugLogging(): void {
  if (installed) return;
  installed = true;

  logInternal("INFO", "app", "Debug Mode enabled");

  window.addEventListener("error", handleWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  const nativeConsoleError = console.error;
  const nativeConsoleWarn = console.warn;
  originalConsoleError = nativeConsoleError;
  originalConsoleWarn = nativeConsoleWarn;
  console.error = (...args: unknown[]) => {
    nativeConsoleError(...args);
    logInternal("ERROR", "console", args.map(describeArg).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    nativeConsoleWarn(...args);
    logInternal("WARN", "console", args.map(describeArg).join(" "));
  };

  flushTimer = setInterval(() => void flush(), 3000);
}

/** Turns Debug Mode off: flushes whatever is buffered, restores the patched console
 * methods, and removes the error listeners. */
export function uninstallDebugLogging(): void {
  if (!installed) return;

  logInternal("INFO", "app", "Debug Mode disabled");
  void flush();

  window.removeEventListener("error", handleWindowError);
  window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  if (originalConsoleError) console.error = originalConsoleError;
  if (originalConsoleWarn) console.warn = originalConsoleWarn;
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  installed = false;
}

let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

function describeArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  return safeStringify(arg);
}

function handleWindowError(event: ErrorEvent): void {
  logInternal("ERROR", "uncaught", event.message, {
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  logInternal("ERROR", "unhandled-rejection", describeArg(reason), {
    stack: reason instanceof Error ? reason.stack : undefined,
  });
}

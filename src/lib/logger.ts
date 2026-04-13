type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function safeStringify(context: unknown): string | undefined {
  if (context === undefined) return undefined;
  try {
    return JSON.stringify(context);
  } catch {
    return JSON.stringify({ _serializationError: "circular or non-serializable context" });
  }
}

function emit(level: LogLevel, msg: string, context?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    level,
    ts: new Date().toISOString(),
    msg,
  };
  if (context !== undefined) {
    const serialized = safeStringify(context);
    entry.context = serialized ? JSON.parse(serialized) : context;
  }

  const line = JSON.stringify(entry);

  if (LEVEL_ORDER[level] >= LEVEL_ORDER.error) {
    console.error(line);
  } else if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, context?: Record<string, unknown>) => emit("debug", msg, context),
  info: (msg: string, context?: Record<string, unknown>) => emit("info", msg, context),
  warn: (msg: string, context?: Record<string, unknown>) => emit("warn", msg, context),
  error: (msg: string, context?: Record<string, unknown>) => emit("error", msg, context),
} as const;

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function readLocalStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {}
  return null;
}

function getGlobalLevel(): LogLevel {
  const fromLs = (readLocalStorage('logLevel') || '').toLowerCase();
  // Prefer localStorage override; fallback to env; default to 'warn' to keep console clean
  if (fromLs === 'debug' || fromLs === 'info' || fromLs === 'warn' || fromLs === 'error' || fromLs === 'silent') {
    return fromLs;
  }
  // @ts-ignore - import.meta.env may not exist in some tooling, guarded by try/catch
  try {
    // Vite-style env var
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const envLevel = (import.meta?.env?.VITE_LOG_LEVEL || '').toLowerCase();
    if (envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error' || envLevel === 'silent') {
      return envLevel;
    }
  } catch {}
  return 'warn';
}

function namespaceAllowed(ns: string): boolean {
  const nsSetting = readLocalStorage('logNamespaces');
  if (!nsSetting || nsSetting.trim() === '' || nsSetting.trim() === '*') return true;
  const parts = nsSetting
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  // Simple positive-only matching; exact or wildcard suffix (e.g., "core:*")
  return parts.some((p) => {
    if (p === ns) return true;
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1);
      return ns.startsWith(prefix);
    }
    return false;
  });
}

export function createLogger(namespace: string) {
  const level = () => getGlobalLevel();

  const shouldLog = (lvl: LogLevel) => LEVEL_ORDER[level()] <= LEVEL_ORDER[lvl] && namespaceAllowed(namespace);

  return {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        // Use console.debug to keep it grouped and hideable in devtools
        // eslint-disable-next-line no-console
        console.debug(`[${namespace}]`, ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        // eslint-disable-next-line no-console
        console.info(`[${namespace}]`, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        // eslint-disable-next-line no-console
        console.warn(`[${namespace}]`, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        // eslint-disable-next-line no-console
        console.error(`[${namespace}]`, ...args);
      }
    },
  } as const;
}

export type Logger = ReturnType<typeof createLogger>;

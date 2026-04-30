const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  debug: (...args: unknown[]) => { if (isDev) console.debug('[DEBUG]', ...args); },
};

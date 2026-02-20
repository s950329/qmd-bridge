import { homedir } from 'node:os';
import { join } from 'node:path';

// Allowed qmd subcommands (whitelist)
export const ALLOWED_COMMANDS = ['search', 'vsearch', 'query'];

// Server defaults
export const DEFAULT_PORT = 3333;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_EXECUTION_TIMEOUT = 30_000; // 30 seconds
export const DEFAULT_MAX_CONCURRENT = 0; // 0 = unlimited
export const MAX_QUERY_LENGTH = 1000;
export const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

// Graceful shutdown
export const GRACEFUL_SHUTDOWN_TIMEOUT = 10_000; // 10 seconds

// Paths
export const CONFIG_DIR = join(homedir(), '.config', 'qmd-bridge');
export const PID_FILE = join(CONFIG_DIR, 'qmd-bridge.pid');
export const LOG_DIR = join(CONFIG_DIR, 'logs');

// Token prefix
export const TOKEN_PREFIX = 'qmd_sk_';

// Dangerous paths that cannot be used as tenant paths
export const DANGEROUS_PATHS = ['/', homedir()];

// Indexing strategies
export const INDEXING_STRATEGIES = ['manual', 'periodic', 'watch'];
export const DEFAULT_INDEXING_STRATEGY = 'manual';
export const DEFAULT_PERIODIC_INTERVAL = 3600; // seconds
export const DEFAULT_WATCH_DEBOUNCE = 5;        // seconds
export const MAX_INDEX_TIMEOUT = 300_000;        // 5 min

// Version
export const VERSION = '1.1.0';

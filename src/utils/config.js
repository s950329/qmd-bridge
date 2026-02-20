import Conf from 'conf';
import {
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_EXECUTION_TIMEOUT,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_INDEXING_STRATEGY,
  DEFAULT_PERIODIC_INTERVAL,
  DEFAULT_WATCH_DEBOUNCE,
  CONFIG_DIR,
} from '../constants.js';
import { mkdirSync } from 'node:fs';

const schema = {
  server: {
    type: 'object',
    default: {},
    properties: {
      port: { type: 'number', default: DEFAULT_PORT },
      host: { type: 'string', default: DEFAULT_HOST },
      executionTimeout: { type: 'number', default: DEFAULT_EXECUTION_TIMEOUT },
      maxConcurrent: { type: 'number', default: DEFAULT_MAX_CONCURRENT },
    },
  },
  qmdPath: { type: 'string', default: '' },
  tenants: { type: 'object', default: {} },
  indexing: {
    type: 'object',
    default: {},
    properties: {
      strategy: { type: 'string', default: DEFAULT_INDEXING_STRATEGY },
      periodicInterval: { type: 'number', default: DEFAULT_PERIODIC_INTERVAL },
      watchDebounce: { type: 'number', default: DEFAULT_WATCH_DEBOUNCE },
    },
  },
};

let configInstance = null;

/**
 * Get the singleton config instance.
 * @returns {Conf} The config instance
 */
export function getConfig() {
  if (!configInstance) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    configInstance = new Conf({
      projectName: 'qmd-bridge',
      cwd: CONFIG_DIR,
      schema,
    });
  }
  return configInstance;
}

/**
 * Get server config.
 * @returns {object} Server configuration
 */
export function getServerConfig() {
  const config = getConfig();
  return {
    port: config.get('server.port') ?? DEFAULT_PORT,
    host: config.get('server.host') ?? DEFAULT_HOST,
    executionTimeout: config.get('server.executionTimeout') ?? DEFAULT_EXECUTION_TIMEOUT,
    maxConcurrent: config.get('server.maxConcurrent') ?? DEFAULT_MAX_CONCURRENT,
  };
}

/**
 * Get all tenants.
 * @returns {object} All tenants keyed by label
 */
export function getTenants() {
  const config = getConfig();
  return config.get('tenants') || {};
}

/**
 * Get a single tenant by label.
 * @param {string} label - Tenant label
 * @returns {object|null} Tenant data or null
 */
export function getTenant(label) {
  const tenants = getTenants();
  return tenants[label] || null;
}

/**
 * Get a tenant by its token.
 * @param {string} token - Bearer token
 * @returns {object|null} Tenant data or null
 */
export function getTenantByToken(token) {
  const tenants = getTenants();
  for (const tenant of Object.values(tenants)) {
    if (tenant.token === token) {
      return tenant;
    }
  }
  return null;
}

/**
 * Save a tenant.
 * @param {string} label - Tenant label
 * @param {object} data - Tenant data
 */
export function saveTenant(label, data) {
  const config = getConfig();
  config.set(`tenants.${label}`, data);
}

/**
 * Delete a tenant.
 * @param {string} label - Tenant label
 */
export function deleteTenant(label) {
  const config = getConfig();
  const tenants = config.get('tenants') || {};
  delete tenants[label];
  config.set('tenants', tenants);
}

/**
 * Get indexing config.
 * @returns {object} Indexing configuration
 */
export function getIndexingConfig() {
  const config = getConfig();
  return {
    strategy: config.get('indexing.strategy') ?? DEFAULT_INDEXING_STRATEGY,
    periodicInterval: config.get('indexing.periodicInterval') ?? DEFAULT_PERIODIC_INTERVAL,
    watchDebounce: config.get('indexing.watchDebounce') ?? DEFAULT_WATCH_DEBOUNCE,
  };
}

/**
 * Save indexing config.
 * @param {object} updates - Partial indexing config to save
 */
export function saveIndexingConfig(updates) {
  const config = getConfig();
  const current = getIndexingConfig();
  config.set('indexing', { ...current, ...updates });
}

/**
 * Get the qmd executable path.
 * @returns {string} Path to qmd or 'qmd' if not set
 */
export function getQmdPath() {
  const config = getConfig();
  const qmdPath = config.get('qmdPath');
  return qmdPath || 'qmd';
}

import Conf from 'conf';
import {
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_EXECUTION_TIMEOUT,
  DEFAULT_MAX_CONCURRENT,
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
 * Get the qmd executable path.
 * @returns {string} Path to qmd or 'qmd' if not set
 */
export function getQmdPath() {
  const config = getConfig();
  const qmdPath = config.get('qmdPath');
  return qmdPath || 'qmd';
}

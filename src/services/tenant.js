import { existsSync, statSync, chmodSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  getTenants,
  getTenant,
  getTenantByToken,
  saveTenant,
  deleteTenant,
  getConfig,
} from '../utils/config.js';
import { generateToken } from '../utils/token.js';
import { DANGEROUS_PATHS } from '../constants.js';

/**
 * Validate a tenant path.
 * Must be absolute, exist, be a directory, and not be a dangerous path.
 * @param {string} path - Path to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTenantPath(path) {
  if (!isAbsolute(path)) {
    return { valid: false, error: 'Path must be an absolute path.' };
  }

  if (DANGEROUS_PATHS.includes(path)) {
    return { valid: false, error: 'Cannot use root directory or home directory as tenant path.' };
  }

  if (!existsSync(path)) {
    return { valid: false, error: 'Path does not exist.' };
  }

  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return { valid: false, error: 'Path must be a directory.' };
  }

  return { valid: true };
}

/**
 * List all tenants.
 * @returns {object} All tenants keyed by label
 */
export function listTenants() {
  return getTenants();
}

/**
 * Add a new tenant.
 * @param {object} options
 * @param {string} options.label - Unique label (also used as qmd collection name)
 * @param {string} options.displayName - Display name
 * @param {string} options.path - Host absolute path to the documents directory
 * @param {string} [options.collection] - qmd collection name (defaults to label)
 * @returns {{ success: boolean, token?: string, error?: string }}
 */
export function addTenant({ label, displayName, path, collection }) {
  // Check if label already exists
  if (getTenant(label)) {
    return { success: false, error: `Tenant "${label}" already exists.` };
  }

  // Validate path
  const validation = validateTenantPath(path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const token = generateToken();
  const tenantData = {
    label,
    displayName,
    path,
    collection: collection || label,
    token,
    createdAt: new Date().toISOString(),
  };

  saveTenant(label, tenantData);

  // Ensure config file permissions are 600
  try {
    const config = getConfig();
    chmodSync(config.path, 0o600);
  } catch {
    // Ignore permission errors (may happen on some systems)
  }

  return { success: true, token };
}

/**
 * Remove a tenant.
 * @param {string} label - Tenant label
 * @returns {{ success: boolean, error?: string }}
 */
export function removeTenant(label) {
  if (!getTenant(label)) {
    return { success: false, error: `Tenant "${label}" not found.` };
  }

  deleteTenant(label);
  return { success: true };
}

/**
 * Edit a tenant.
 * @param {string} currentLabel - Current tenant label
 * @param {object} updates - Fields to update
 * @param {string} [updates.label] - New label
 * @param {string} [updates.displayName] - New display name
 * @param {string} [updates.path] - New path
 * @param {string} [updates.collection] - New collection name
 * @returns {{ success: boolean, error?: string }}
 */
export function editTenant(currentLabel, updates) {
  const tenant = getTenant(currentLabel);
  if (!tenant) {
    return { success: false, error: `Tenant "${currentLabel}" not found.` };
  }

  // If changing label, check new label doesn't exist
  if (updates.label && updates.label !== currentLabel) {
    if (getTenant(updates.label)) {
      return { success: false, error: `Tenant "${updates.label}" already exists.` };
    }
  }

  // If changing path, validate it
  if (updates.path && updates.path !== tenant.path) {
    const validation = validateTenantPath(updates.path);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
  }

  const updatedTenant = {
    ...tenant,
    ...(updates.label && { label: updates.label }),
    ...(updates.displayName && { displayName: updates.displayName }),
    ...(updates.path && { path: updates.path }),
    ...(updates.collection && { collection: updates.collection }),
  };

  // If label changed, delete old and save new
  if (updates.label && updates.label !== currentLabel) {
    deleteTenant(currentLabel);
    saveTenant(updates.label, updatedTenant);
  } else {
    saveTenant(currentLabel, updatedTenant);
  }

  return { success: true };
}

/**
 * Rotate a tenant's token.
 * @param {string} label - Tenant label
 * @returns {{ success: boolean, token?: string, error?: string }}
 */
export function rotateTenantToken(label) {
  const tenant = getTenant(label);
  if (!tenant) {
    return { success: false, error: `Tenant "${label}" not found.` };
  }

  const newToken = generateToken();
  tenant.token = newToken;
  saveTenant(label, tenant);

  return { success: true, token: newToken };
}

// Re-export for convenience
export { getTenantByToken, getTenant };

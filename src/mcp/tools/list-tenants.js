import { listTenants } from '../../services/tenant.js';

/**
 * Register the qmd_list_tenants tool on the given MCP server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerListTenantsTool(server) {
  server.registerTool(
    'qmd_list_tenants',
    {
      title: 'List QMD Tenants',
      description: `List all configured tenants in the qmd-bridge system.

Returns tenant metadata (label, display name, collection, path, creation date).
Token values are NOT included in the response for security.

This tool does not require authentication and is useful for discovering available
tenants before making search queries.

Returns:
  JSON array of tenant objects with fields: label, displayName, collection, path, createdAt.
  Returns an empty array if no tenants are configured.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const tenants = listTenants();
      const entries = Object.values(tenants).map((t) => ({
        label: t.label,
        displayName: t.displayName,
        collection: t.collection || t.label,
        path: t.path,
        createdAt: t.createdAt,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ tenants: entries, total: entries.length }, null, 2),
          },
        ],
      };
    },
  );
}

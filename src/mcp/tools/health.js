import { VERSION } from '../../constants.js';
import { getActiveCount } from '../../services/executor.js';

const startTime = Date.now();

/**
 * Register the qmd_health tool on the given MCP server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerHealthTool(server) {
  server.registerTool(
    'qmd_health',
    {
      title: 'QMD Bridge Health Check',
      description: `Check the health status of the qmd-bridge server.

Returns the server version, uptime in seconds, and the number of currently
active qmd executions. Does not require authentication.

Returns:
  JSON object with fields: status, version, uptime (seconds), activeExecutions.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const health = {
        status: 'ok',
        version: VERSION,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        activeExecutions: getActiveCount(),
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(health, null, 2),
          },
        ],
      };
    },
  );
}

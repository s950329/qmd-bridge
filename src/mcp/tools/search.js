import { z } from 'zod';
import { executeQmd } from '../../services/executor.js';
import { getTenantByToken } from '../../services/tenant.js';
import { MAX_QUERY_LENGTH } from '../../constants.js';

/**
 * Register the qmd_search tool on the given MCP server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerSearchTool(server) {
  server.registerTool(
    'qmd_search',
    {
      title: 'QMD Search',
      description: `Execute a keyword search query against a qmd knowledge base.

Requires a valid tenant token for authentication. The search runs on the host machine
with GPU acceleration (Apple Silicon Metal) for fast results.

Args:
  - token (string): Bearer token for tenant authentication (format: qmd_sk_<hex>)
  - query (string): Search query string (max ${MAX_QUERY_LENGTH} chars)

Returns:
  The raw stdout output from qmd search, along with execution time in milliseconds.

Examples:
  - "Find docs about authentication" -> { token: "qmd_sk_...", query: "authentication" }
  - "Search for deployment guide" -> { token: "qmd_sk_...", query: "deployment guide" }

Error Handling:
  - Returns error if token is invalid or missing
  - Returns error if query exceeds max length
  - Returns error if max concurrent executions reached
  - Returns error if execution times out`,
      inputSchema: {
        token: z.string().describe('Bearer token for tenant authentication (format: qmd_sk_<hex>)'),
        query: z
          .string()
          .min(1, 'Query is required')
          .max(MAX_QUERY_LENGTH, `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`)
          .describe('Search query string'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ token, query }) => {
      const tenant = getTenantByToken(token);
      if (!tenant) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Error: Invalid or missing authentication token.' }],
        };
      }

      try {
        const { stdout, executionTime } = await executeQmd({
          command: 'search',
          query,
          collection: tenant.collection,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ data: stdout, executionTime }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: ${err.message}` }],
        };
      }
    },
  );
}

import { z } from 'zod';
import { executeQmd } from '../../services/executor.js';
import { getTenantByToken } from '../../services/tenant.js';
import { MAX_QUERY_LENGTH } from '../../constants.js';

/**
 * Register the qmd_query tool on the given MCP server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerQueryTool(server) {
  server.registerTool(
    'qmd_query',
    {
      title: 'QMD Query',
      description: `Execute a query with LLM reranking against a qmd knowledge base.

Combines search with LLM-based reranking for the most relevant results.
Requires a valid tenant token for authentication. The query runs on the host machine
with GPU acceleration (Apple Silicon Metal).

Args:
  - token (string): Bearer token for tenant authentication (format: qmd_sk_<hex>)
  - query (string): Query string (max ${MAX_QUERY_LENGTH} chars)

Returns:
  The raw stdout output from qmd query, along with execution time in milliseconds.

Examples:
  - "Ask about deployment" -> { token: "qmd_sk_...", query: "how to deploy to production" }

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
          .describe('Query string'),
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
          command: 'query',
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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerSearchTool } from './tools/search.js';
import { registerVsearchTool } from './tools/vsearch.js';
import { registerQueryTool } from './tools/query.js';
import { registerListTenantsTool } from './tools/list-tenants.js';
import { registerHealthTool } from './tools/health.js';

/**
 * Create and configure the MCP server with all tools registered.
 * @returns {McpServer}
 */
function createMcpServer() {
  const server = new McpServer({
    name: 'qmd-bridge-mcp-server',
    version: '1.0.0',
  });

  // Register all tools
  registerSearchTool(server);
  registerVsearchTool(server);
  registerQueryTool(server);
  registerListTenantsTool(server);
  registerHealthTool(server);

  return server;
}

/**
 * Create an Express request handler for the MCP endpoint.
 * Uses stateless StreamableHTTPServerTransport with JSON responses.
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>}
 */
export function createMcpHandler() {
  const server = createMcpServer();

  return async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/setup.js';

// In-memory tenant store
let tenantStore = {};

vi.mock('../../src/utils/config.js', () => ({
  getConfig: vi.fn(() => ({
    get: vi.fn((key) => {
      if (key === 'tenants') return tenantStore;
      const defaults = {
        'server.port': 3333,
        'server.host': '127.0.0.1',
        'server.executionTimeout': 30000,
        'server.maxConcurrent': 0,
        qmdPath: '',
      };
      return defaults[key];
    }),
    path: '/tmp/mock-config.json',
  })),
  getServerConfig: vi.fn(() => ({
    port: 3333,
    host: '127.0.0.1',
    executionTimeout: 30000,
    maxConcurrent: 0,
  })),
  getTenants: vi.fn(() => tenantStore),
  getTenant: vi.fn((label) => tenantStore[label] || null),
  getTenantByToken: vi.fn((token) => {
    for (const t of Object.values(tenantStore)) {
      if (t.token === token) return t;
    }
    return null;
  }),
  saveTenant: vi.fn(),
  deleteTenant: vi.fn(),
  getQmdPath: vi.fn(() => 'qmd'),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';

const TENANT = {
  label: 'mcp-test',
  displayName: 'MCP Test Project',
  path: '/test/mcp-project',
  collection: 'mcp-test',
  token: 'qmd_sk_00112233445566778899aabbccddeeff',
  createdAt: '2026-02-18T00:00:00Z',
};

/**
 * Helper: send an MCP JSON-RPC request to POST /mcp.
 * The MCP SDK requires Accept header to include both
 * application/json and text/event-stream.
 */
function mcpRequest(app, body) {
  return request(app)
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send(body);
}

describe('POST /mcp (MCP endpoint)', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantStore = { 'mcp-test': { ...TENANT } };
    app = createTestApp();
  });

  // ─── Initialize ──────────────────────────────────────────────

  it('should respond to initialize with server info', async () => {
    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.serverInfo.name).toBe('qmd-bridge-mcp-server');
    expect(res.body.result.capabilities.tools).toBeDefined();
  });

  // ─── Tools List ──────────────────────────────────────────────

  it('should list all 5 tools', async () => {
    // Initialize first
    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    expect(res.status).toBe(200);
    const tools = res.body.result.tools;
    expect(tools).toHaveLength(5);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('qmd_search');
    expect(toolNames).toContain('qmd_vsearch');
    expect(toolNames).toContain('qmd_query');
    expect(toolNames).toContain('qmd_list_tenants');
    expect(toolNames).toContain('qmd_health');
  });

  // ─── qmd_health tool ────────────────────────────────────────

  it('should return health info via qmd_health tool', async () => {
    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'qmd_health',
        arguments: {},
      },
    });

    expect(res.status).toBe(200);
    const content = res.body.result.content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');

    const health = JSON.parse(content[0].text);
    expect(health.status).toBe('ok');
    expect(health.version).toBeDefined();
    expect(typeof health.uptime).toBe('number');
    expect(typeof health.activeExecutions).toBe('number');
  });

  // ─── qmd_list_tenants tool ───────────────────────────────────

  it('should list tenants without exposing tokens', async () => {
    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'qmd_list_tenants',
        arguments: {},
      },
    });

    expect(res.status).toBe(200);
    const content = res.body.result.content;
    const data = JSON.parse(content[0].text);

    expect(data.total).toBe(1);
    expect(data.tenants[0].label).toBe('mcp-test');
    expect(data.tenants[0].displayName).toBe('MCP Test Project');
    // Token must NOT be included
    expect(data.tenants[0].token).toBeUndefined();
  });

  // ─── qmd_search tool (invalid token) ────────────────────────

  it('should return error for invalid token in qmd_search', async () => {
    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'qmd_search',
        arguments: {
          token: 'invalid_token',
          query: 'test query',
        },
      },
    });

    expect(res.status).toBe(200); // MCP always returns 200
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain('Invalid');
  });

  // ─── qmd_search tool (valid token, success) ─────────────────

  it('should return search results for valid token via qmd_search', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'mcp search results', '');
    });

    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'qmd_search',
        arguments: {
          token: TENANT.token,
          query: 'authentication',
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeUndefined();
    const content = res.body.result.content;
    const data = JSON.parse(content[0].text);
    expect(data.data).toBe('mcp search results');
    expect(typeof data.executionTime).toBe('number');

    // Verify correct collection was used
    const calledArgs = execFile.mock.calls[0][1];
    expect(calledArgs).toContain('mcp-test');
  });

  // ─── qmd_vsearch tool ────────────────────────────────────────

  it('should return vsearch results for valid token via qmd_vsearch', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'vsearch results', '');
    });

    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'qmd_vsearch',
        arguments: {
          token: TENANT.token,
          query: 'semantic search test',
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeUndefined();
    const data = JSON.parse(res.body.result.content[0].text);
    expect(data.data).toBe('vsearch results');
  });

  // ─── qmd_query tool ─────────────────────────────────────────

  it('should return query results for valid token via qmd_query', async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, 'query reranked results', '');
    });

    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'qmd_query',
        arguments: {
          token: TENANT.token,
          query: 'deployment guide',
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeUndefined();
    const data = JSON.parse(res.body.result.content[0].text);
    expect(data.data).toBe('query reranked results');
  });

  // ─── Tool annotations ───────────────────────────────────────

  it('should have correct annotations on search tools (readOnly, non-destructive)', async () => {
    await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const res = await mcpRequest(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const searchTool = res.body.result.tools.find((t) => t.name === 'qmd_search');
    expect(searchTool.annotations.readOnlyHint).toBe(true);
    expect(searchTool.annotations.destructiveHint).toBe(false);
  });
});

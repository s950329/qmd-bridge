# AGENTS.md — Coding Agent Guidelines for qmd-bridge

## Project Overview

qmd-bridge is a lightweight HTTP proxy service and CLI tool that bridges Docker containers to the host `qmd` executable for GPU-accelerated local knowledge base search on macOS. It uses the **Host-Process Proxy Pattern**: receive HTTP requests from containers, execute `qmd` on the host (with Metal GPU), and return results.

## Tech Stack

- **Runtime**: Node.js >= 18 LTS
- **Module System**: ESM (`"type": "module"` in `package.json`)
- **Server**: Express
- **CLI**: Commander
- **Validation**: Zod
- **Config**: `conf` (stored at `~/.config/qmd-bridge/config.json`)
- **Logging**: Pino (JSON structured logs)
- **Interactive UI**: Inquirer, Chalk, Ora, cli-table3

## Project Structure

```
qmd-bridge/
├── bin/
│   └── cli.js              # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── server.js            # Express HTTP server
│   ├── middleware/
│   │   └── auth.js          # Bearer Token auth middleware
│   ├── routes/
│   │   ├── qmd.js           # POST /qmd route
│   │   └── health.js        # GET /health route
│   ├── services/
│   │   ├── executor.js      # qmd execFile wrapper (timeout, maxBuffer)
│   │   ├── tenant.js        # Tenant CRUD logic
│   │   └── daemon.js        # Daemon start/stop/status logic
│   ├── utils/
│   │   ├── config.js        # Configuration read/write (conf wrapper)
│   │   ├── token.js         # Token generation
│   │   └── logger.js        # Pino logger initialization
│   └── constants.js         # Constants (whitelist, defaults)
├── specs/                   # Technical design documents
├── package.json
├── README.md
└── AGENTS.md
```

## Critical Security Rules

These rules are **non-negotiable**. Any code change must comply:

1. **NEVER use `exec()`** — Always use `child_process.execFile()` to prevent command injection. Arguments must be passed as an array, never interpolated into a shell string.
2. **Command Whitelist** — Only `search`, `vsearch`, and `query` are allowed as `qmd` subcommands. Defined in `src/constants.js`.
3. **No Path Traversal** — Tenant paths must be validated as existing absolute paths. Root `/` and home `~` directories must be rejected.
4. **No Sensitive Data in Responses** — API error responses must never expose host file paths or stack traces. Use standardized error codes only.
5. **Token Storage** — Config file must have `chmod 600` permissions. CLI commands that modify config must enforce this.

## Coding Conventions

### General

- Use **ESM** imports (`import`/`export`), not CommonJS (`require`).
- Use `node:` prefix for built-in modules (e.g., `import { execFile } from 'node:child_process'`).
- Prefer `const` over `let`. Never use `var`.
- Use **async/await** over raw Promises or callbacks.

### Error Handling

- All API error responses must follow the standard format:
  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "Human-readable message"
    }
  }
  ```
- Valid error codes: `INVALID_COMMAND`, `QUERY_TOO_LONG`, `INVALID_REQUEST`, `INVALID_TOKEN`, `EXECUTION_FAILED`, `TOO_MANY_REQUESTS`, `EXECUTION_TIMEOUT`.

### Configuration

- All config access goes through `src/utils/config.js`.
- Server settings live under `server.*` key.
- Tenant data lives under `tenants.<label>` key.
- PID file: `~/.config/qmd-bridge/qmd-bridge.pid`
- Logs directory: `~/.config/qmd-bridge/logs/`

### API Routes

- `POST /qmd` — Execute qmd query (requires Bearer token auth)
- `GET /health` — Health check (no auth required)
- All request validation uses Zod schemas.

### Process Execution

- `execFile()` calls must always set:
  - `cwd` to the tenant's configured path
  - `timeout` to `config.server.executionTimeout` (default 30s)
  - `maxBuffer` to `10 * 1024 * 1024` (10MB)

### Daemon Management

- Daemon uses `spawn` with `detached: true` + `child.unref()`.
- PID is managed via file at `~/.config/qmd-bridge/qmd-bridge.pid`.
- Graceful shutdown: stop accepting requests → wait up to 10s for in-flight queries → exit.

## Token Format

Tokens follow the pattern: `qmd_sk_<32-hex-chars>` (generated via `crypto.randomBytes(16).toString('hex')`).

## Testing Guidelines

- Integration tests should mock `execFile` to avoid requiring the actual `qmd` binary.
- Test multi-tenant isolation: verify that a token for tenant A cannot access tenant B's data.
- Test input validation: invalid commands, oversized queries, missing fields.
- Test concurrency limits when `maxConcurrent > 0`.

# Contributing to qmd-bridge

Thank you for your interest in contributing to **qmd-bridge**! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/s950329/qmd-bridge/issues) to avoid duplicates.

When filing a bug report, please include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Your environment (Node.js version, OS, qmd version)
- Relevant log output (run `qmd-bridge logs` to retrieve logs)

### Suggesting Features

Feature requests are welcome. Please open an [issue](https://github.com/s950329/qmd-bridge/issues) and include:

- A clear description of the proposed feature
- The motivation and use case
- Any alternative solutions you've considered

### Submitting Pull Requests

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: `npm install`
3. **Make your changes**, following the coding conventions below.
4. **Add or update tests** for any changed functionality.
5. **Run tests** to ensure they pass: `npm test`
6. **Commit your changes** with a clear, descriptive commit message.
7. **Push** to your fork and submit a pull request.

## Development Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/qmd-bridge.git
cd qmd-bridge

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Coding Conventions

This project follows specific conventions documented in [AGENTS.md](AGENTS.md). Key points:

- **ESM only** — Use `import`/`export`, not `require`.
- **Node.js built-in prefix** — Use `node:` prefix (e.g., `import { execFile } from 'node:child_process'`).
- **Prefer `const`** over `let`. Never use `var`.
- **Async/await** — Prefer over raw Promises or callbacks.
- **Security** — Never use `exec()`; always use `execFile()`. See the security rules in `AGENTS.md`.

## AI-Assisted Development

> The core logic of this project was primarily written with the assistance of AI.

When contributing, please be aware that AI coding agents may also be used to review and iterate on pull requests. Human oversight is always applied for architecture decisions, code review, and quality assurance.

## Project Structure

```
qmd-bridge/
├── bin/cli.js            # CLI entry point
├── src/
│   ├── server.js         # Express HTTP server
│   ├── mcp/              # MCP server and tools
│   ├── middleware/        # Auth middleware
│   ├── routes/            # API routes
│   ├── services/          # Business logic
│   ├── utils/             # Utilities
│   └── constants.js       # Constants
├── tests/                 # Test files
└── specs/                 # Technical design documents
```

## Questions?

If you have questions, feel free to open an [issue](https://github.com/s950329/qmd-bridge/issues) for discussion.

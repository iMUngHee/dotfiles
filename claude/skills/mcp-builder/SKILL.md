---
name: mcp-builder
description: "Guide for building MCP servers that connect LLMs to external services. Use when creating or modifying MCP servers in TypeScript or Python."
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch
effort: max
---

# MCP Server Development Guide

Build MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools.

## Phase 1: Research & Plan

### 1.1 Load Framework Docs

**MCP Protocol**: start from `https://modelcontextprotocol.io/sitemap.xml`, fetch pages with `.md` suffix.

**SDK docs** (fetch via WebFetch):
- TypeScript: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`

Reference: [MCP Best Practices](reference/mcp_best_practices.md)

### 1.2 Design Decisions

**API Coverage vs Workflow Tools**: balance comprehensive endpoint coverage with specialized workflow tools. When uncertain, prioritize comprehensive API coverage.

**Tool Naming**: consistent prefixes, action-oriented. e.g., `github_create_issue`, `github_list_repos`.

**Transport**: streamable HTTP for remote (stateless JSON), stdio for local.

**Language**: TypeScript recommended (better SDK support, static typing, broad execution compatibility).

### 1.3 Plan Implementation

1. Review the service's API docs — endpoints, auth, data models
2. List endpoints to implement, starting with most common operations
3. Define tool names, input schemas, output schemas

## Phase 2: Implement

### Project Setup

See language-specific guides:
- [TypeScript Guide](reference/node_mcp_server.md)
- [Python Guide](reference/python_mcp_server.md)

### Core Infrastructure

- API client with authentication
- Error handling with actionable messages (guide agents toward solutions)
- Response formatting (JSON for structured, Markdown for display)
- Pagination support

### Per-Tool Checklist

For each tool:

1. **Input Schema**: Zod (TS) or Pydantic (Python), with constraints and clear descriptions
2. **Output Schema**: define `outputSchema` where possible, use `structuredContent`
3. **Tool Description**: concise summary, parameter descriptions, return type
4. **Implementation**: async/await, proper error handling, pagination support
5. **Annotations**: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`

## Phase 3: Review & Test

### Quality Check

- No duplicated code (DRY)
- Consistent error handling
- Full type coverage
- Clear tool descriptions
- Concise responses (agents benefit from focused data)

### Build & Test

**TypeScript**: `npm run build` then `npx @modelcontextprotocol/inspector`
**Python**: `python -m py_compile your_server.py` then MCP Inspector

## Phase 4: Evaluations

After implementation, create 10 evaluation questions:

1. **Tool Inspection**: list available tools and capabilities
2. **Content Exploration**: use READ-ONLY operations to explore data
3. **Question Generation**: complex, realistic, multi-tool questions
4. **Answer Verification**: solve each yourself to verify

Each question must be: independent, read-only, complex, realistic, verifiable, stable.

Output as XML:
```xml
<evaluation>
  <qa_pair>
    <question>...</question>
    <answer>...</answer>
  </qa_pair>
</evaluation>
```

#!/usr/bin/env node
/**
 * Minimal spec-compliant MCP stdio server (JSON-RPC 2.0 over newline-delimited JSON)
 * used exclusively inside the isolated temp OMDSH_HOME during live omdsh promo capture.
 */
import readline from 'node:readline'

const mode = process.argv[2] || 'memory'

const TOOL_SETS = {
  github: [
    {
      name: 'get_pull_request',
      description: 'Read pull request metadata, status checks, and diff summary.',
      inputSchema: { type: 'object', properties: { number: { type: 'number' } }, required: ['number'] },
    },
    {
      name: 'list_issues',
      description: 'List open repository issues with label and assignee filters.',
      inputSchema: { type: 'object', properties: { state: { type: 'string' } } },
    },
    {
      name: 'search_code',
      description: 'Search source code across repositories.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'create_review_comment',
      description: 'Add an inline review comment on a pull request diff.',
      inputSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    },
  ],
  memory: [
    {
      name: 'read_graph',
      description: 'Read the full knowledge graph of entities and relations.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search_nodes',
      description: 'Search knowledge graph nodes by name or observation text.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'create_entities',
      description: 'Persist new architectural entities into local project memory.',
      inputSchema: { type: 'object', properties: { entities: { type: 'array' } }, required: ['entities'] },
    },
  ],
}

const tools = TOOL_SETS[mode] ?? TOOL_SETS.memory

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    return
  }
  if (req.id === undefined) return // notification

  switch (req.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: req.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: `mcp-${mode}`, version: '1.0.0' },
        },
      })
      break
    case 'ping':
      send({ jsonrpc: '2.0', id: req.id, result: {} })
      break
    case 'tools/list':
      send({ jsonrpc: '2.0', id: req.id, result: { tools } })
      break
    case 'resources/list':
      send({ jsonrpc: '2.0', id: req.id, result: { resources: [] } })
      break
    case 'prompts/list':
      send({ jsonrpc: '2.0', id: req.id, result: { prompts: [] } })
      break
    default:
      send({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      })
  }
})

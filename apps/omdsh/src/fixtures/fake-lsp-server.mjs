// Minimal LSP stdio server used by the language-server integration test:
// Content-Length framing, initialize, the four navigation methods, and
// shutdown. It is a fixture, not a general-purpose language server.

let buffer = Buffer.alloc(0)

function send(message) {
  const json = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
}

function range(line, character = 0) {
  return { start: { line, character }, end: { line, character: character + 1 } }
}

function handle(message) {
  const { id, method, params } = message
  if (id === undefined) return
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          capabilities: {
            textDocumentSync: { openClose: true, change: 1 },
            definitionProvider: true,
            referencesProvider: true,
            implementationProvider: true,
            hoverProvider: true,
          },
          serverInfo: { name: 'fake-lsp', version: '1.0.0' },
        },
      })
      return
    case 'shutdown':
      send({ jsonrpc: '2.0', id, result: null })
      return
    case 'textDocument/definition':
      send({ jsonrpc: '2.0', id, result: [{ uri: params.textDocument.uri, range: range(3, 2) }] })
      return
    case 'textDocument/references':
      send({
        jsonrpc: '2.0',
        id,
        result: [
          { uri: params.textDocument.uri, range: range(0, 0) },
          { uri: params.textDocument.uri, range: range(5, 4) },
        ],
      })
      return
    case 'textDocument/implementation':
      send({ jsonrpc: '2.0', id, result: [{ uri: params.textDocument.uri, range: range(7, 0) }] })
      return
    case 'textDocument/hover':
      send({
        jsonrpc: '2.0',
        id,
        result: { contents: { kind: 'markdown', value: '**fake hover**' }, range: range(0, 0) },
      })
      return
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unhandled ${method}` } })
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.subarray(0, headerEnd).toString('ascii')
    const length = Number(/Content-Length: (\d+)/iu.exec(header)?.[1])
    if (!Number.isFinite(length)) process.exit(2)
    if (buffer.length < headerEnd + 4 + length) return
    const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
    buffer = buffer.subarray(headerEnd + 4 + length)
    handle(JSON.parse(body))
  }
})

process.stdin.on('end', () => { process.exit(0) })

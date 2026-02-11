/**
 * Figmation MCP Client - Workaround for Claude Code HTTP MCP tool loading issue
 * https://github.com/anthropics/claude-code/issues/12164
 *
 * Usage:
 *   node figmation-mcp-client.js list-tools
 *   node figmation-mcp-client.js call <toolName> '<jsonArgs>'
 *
 * Examples:
 *   node figmation-mcp-client.js call Create_Design_from_SVG '{"Channel_ID":"default","SVG_Content":"<svg>...</svg>"}'
 *   node figmation-mcp-client.js call Get_Document_Info '{"Channel_ID":"default"}'
 */

const http = require('http');

const MCP_URL = 'http://localhost:5678/mcp/6bb43ca6-32e5-47f2-a9c9-6a519ca72a82';
const parsed = new URL(MCP_URL);

function mcpRequest(sessionId, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers
    };

    const req = http.request(options, (res) => {
      let body = '';
      const sid = res.headers['mcp-session-id'];
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ sessionId: sid, body, status: res.statusCode }));
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function parseSSE(raw) {
  const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
  if (!dataLine) return null;
  return JSON.parse(dataLine.replace(/^data:\s*/, ''));
}

async function createSession() {
  const init = await mcpRequest(null, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'figmation-mcp-client', version: '1.0' }
    }
  });
  const sid = init.sessionId;
  await mcpRequest(sid, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return sid;
}

async function listTools() {
  const sid = await createSession();
  const res = await mcpRequest(sid, {
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}
  });
  const json = parseSSE(res.body);
  if (json && json.result && json.result.tools) {
    const tools = json.result.tools;
    console.log(`Total tools: ${tools.length}\n`);
    tools.forEach(t => {
      const params = t.inputSchema && t.inputSchema.properties
        ? Object.keys(t.inputSchema.properties).join(', ')
        : 'none';
      console.log(`  ${t.name}`);
      console.log(`    ${t.description}`);
      console.log(`    Params: ${params}\n`);
    });
  } else {
    console.error('Failed to get tools:', res.body);
  }
}

async function callTool(toolName, args) {
  const sid = await createSession();
  const res = await mcpRequest(sid, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: toolName, arguments: args }
  });
  const json = parseSSE(res.body);
  if (json) {
    if (json.error) {
      console.error('MCP Error:', JSON.stringify(json.error, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(json.result, null, 2));
  } else {
    // Try parsing as plain JSON
    try {
      const plain = JSON.parse(res.body);
      console.log(JSON.stringify(plain, null, 2));
    } catch {
      console.log(res.body);
    }
  }
}

async function main() {
  const [,, command, ...rest] = process.argv;

  if (!command || command === 'help') {
    console.log('Usage:');
    console.log('  node figmation-mcp-client.js list-tools');
    console.log('  node figmation-mcp-client.js call <toolName> \'<jsonArgs>\'');
    process.exit(0);
  }

  if (command === 'list-tools') {
    await listTools();
  } else if (command === 'call') {
    const toolName = rest[0];
    const args = rest[1] ? JSON.parse(rest[1]) : {};
    if (!toolName) {
      console.error('Error: tool name required');
      process.exit(1);
    }
    await callTool(toolName, args);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });

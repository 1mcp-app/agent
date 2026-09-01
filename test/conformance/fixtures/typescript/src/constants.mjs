export const TOOL_NAME = 'fixture.acknowledge';
export const TOOL_INPUT_SENTINEL = 'fixture-input-must-not-leak';
export const TOOL_RESULT_SENTINEL = 'fixture-result-must-not-leak';

export const PACKAGE_PINS = Object.freeze({
  '@modelcontextprotocol/client': '2.0.0',
  '@modelcontextprotocol/node': '2.0.0',
  '@modelcontextprotocol/sdk': '1.30.0',
  '@modelcontextprotocol/server': '2.0.0',
  '@modelcontextprotocol/server-legacy': '2.0.0',
});

export const PROFILES = Object.freeze({
  v1: ['stdio', 'streamable-http', 'sse'],
  v2: ['stdio', 'streamable-http', 'sse'],
});

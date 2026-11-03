export const TOOL_NAME = 'fixture.acknowledge';
export const TOOL_INPUT_SENTINEL = 'fixture-input-must-not-leak';
export const TOOL_RESULT_SENTINEL = 'fixture-result-must-not-leak';

export const PROFILES = Object.freeze({
  v1: ['stdio', 'streamable-http', 'sse'],
  v2: ['stdio', 'streamable-http', 'sse'],
});

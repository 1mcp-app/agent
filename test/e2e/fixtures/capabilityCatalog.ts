export const capabilities = { tools: {}, prompts: {}, resources: {}, completions: {} };
export const metadata = {
  title: 'Fixture title',
  description: 'Fixture description',
  icons: [{ src: 'https://example.com/icon.png', mimeType: 'image/png' }],
  _meta: { 'example.com/opaque': { nested: [null, true, 7] } },
  'example.com/future': { enabled: true },
};
export const tool = { ...metadata, name: 'echo', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } };
export const prompt = { ...metadata, name: 'explain', arguments: [{ name: 'topic', required: true }] };
export const resource = { ...metadata, name: 'guide', uri: 'file:///guide', mimeType: 'text/plain', size: 5 };
export const template = { ...metadata, name: 'guides', uriTemplate: 'file:///{name}', mimeType: 'text/plain' };
export const results: Record<string, object> = {
  'tools/list': { tools: [tool] },
  'prompts/list': { prompts: [prompt] },
  'resources/list': { resources: [resource] },
  'resources/templates/list': { resourceTemplates: [{ name: 'malformed', uriTemplate: 'file:///{' }, template] },
  'tools/call': { content: [{ type: 'text', text: 'ok' }] },
  'prompts/get': { messages: [{ role: 'user', content: { type: 'text', text: 'Explain' } }] },
  'resources/read': { contents: [{ uri: resource.uri, text: 'Guide' }] },
  'completion/complete': { completion: { values: ['topic'] } },
};

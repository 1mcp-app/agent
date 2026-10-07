// Mechanically transpiled from modelcontextprotocol/conformance at c321dd32035556e6769d3724a8ee97d87c3faaac.
// See provenance.json, fixture.patch, and LICENSE for bounded scenario corrections.
import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  ElicitResultSchema,
  CreateMessageResultSchema,
  ResultSchema,
  ProgressNotificationSchema,
  LoggingMessageNotificationSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer as ModernMcpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import cors from "cors";
import { randomUUID, createHmac } from "crypto";
const resourceSubscriptions = /* @__PURE__ */ new Set();
let watchedResourceContent = "Watched resource content";
let watchedResourceRevision = 0;
const MRTR_STATE_SECRET = "conformance-mrtr-secret-" + randomUUID();
const CUSTOM_HEADER_TOOL_NAME = "test_custom_header";
const CUSTOM_HEADER_INPUT_SCHEMA = {
  type: "object",
  properties: {
    value: { type: "string", "x-mcp-header": "Value" }
  },
  required: ["value"],
  additionalProperties: false
};
const renderCustomHeader = ({ value }) => ({ content: [{ type: "text", text: value }] });
const customHeaderHandler = toNodeHandler(createMcpHandler(() => {
  const server = new ModernMcpServer({ name: "reference-custom-header", version: "1.0.0" });
  server.registerTool(CUSTOM_HEADER_TOOL_NAME, {
    description: "Echo a string after SDK custom-header decoding and validation",
    inputSchema: fromJsonSchema(CUSTOM_HEADER_INPUT_SCHEMA)
  }, renderCustomHeader);
  return server;
}, { legacy: "reject" }));
function signMrtState(payload) {
  const data = JSON.stringify(payload);
  const hmac = createHmac("sha256", MRTR_STATE_SECRET).update(data).digest("hex");
  return JSON.stringify({ data, hmac });
}
function verifyMrtState(raw) {
  try {
    const { data, hmac } = JSON.parse(raw);
    const expected = createHmac("sha256", MRTR_STATE_SECRET).update(data).digest("hex");
    if (hmac !== expected) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}
function getMrtInputText(inputResponse, field) {
  const content = inputResponse?.content;
  const value = content?.[field];
  return typeof value === "string" ? value : "unknown";
}
const interactiveToolDefinitions = new Map();
function createInteractiveToolHandler(name, request, resultSchema, render) {
  interactiveToolDefinitions.set(name, { request, resultSchema, render });
  return async (args, { sendRequest }) => {
    try {
      return render(await sendRequest(request(args), resultSchema));
    } catch (error) {
      return { content: [{ type: "text", text: `${name === "test_sampling" ? "Sampling" : "Elicitation"} not supported or error: ${error.message}` }] };
    }
  };
}
const transports = {};
const servers = {};
async function getStatelessDispatchClient() {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await server.connect(serverT);
  const client = new Client(
    { name: "stateless-dispatch", version: "1.0.0" },
    { capabilities: { sampling: {}, elicitation: {} } }
  );
  await client.connect(clientT);
  const buffer = [];
  const collect = async (n) => void buffer.push({ jsonrpc: "2.0", ...n });
  client.setNotificationHandler(ProgressNotificationSchema, collect);
  client.setNotificationHandler(LoggingMessageNotificationSchema, collect);
  client.fallbackNotificationHandler = collect;
  return {
    client,
    drainNotifications: () => buffer.splice(0, buffer.length),
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}
const eventStoreData = /* @__PURE__ */ new Map();
function createEventStore() {
  return {
    async storeEvent(streamId, message) {
      const eventId = `${streamId}::${Date.now()}_${randomUUID()}`;
      eventStoreData.set(eventId, { eventId, message, streamId });
      return eventId;
    },
    async replayEventsAfter(lastEventId, { send }) {
      const streamId = lastEventId.split("::")[0];
      const eventsToReplay = [];
      for (const [eventId, data] of eventStoreData.entries()) {
        if (data.streamId === streamId && eventId > lastEventId) {
          eventsToReplay.push([eventId, data]);
        }
      }
      eventsToReplay.sort(([a], [b]) => a.localeCompare(b));
      for (const [eventId, { message }] of eventsToReplay) {
        if (Object.keys(message).length > 0) {
          await send(eventId, message);
        }
      }
      return streamId;
    }
  };
}
const TEST_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const TEST_AUDIO_BASE64 = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA=";
const JSON_SCHEMA_2020_12_INPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  $defs: {
    address: {
      // SEP-2106: reference keyword ($anchor) must be preserved
      $anchor: "addressDef",
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" }
      }
    }
  },
  properties: {
    name: { type: "string" },
    address: { $ref: "#/$defs/address" },
    contactMethod: { type: "string", enum: ["phone", "email"] },
    phone: { type: "string" },
    email: { type: "string" }
  },
  // SEP-2106: the full JSON Schema 2020-12 vocabulary is permitted in
  // inputSchema (alongside the required root `type: "object"`). These keywords
  // exercise that SDKs preserve them through tools/list rather than stripping
  // them down to properties/required.
  //
  // Composition keywords (allOf / anyOf):
  allOf: [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }],
  // Conditional keywords (if / then / else):
  if: {
    properties: { contactMethod: { const: "phone" } },
    required: ["contactMethod"]
  },
  then: { required: ["phone"] },
  else: { required: ["email"] },
  additionalProperties: false
};
function createMcpServer() {
  const mcpServer = new McpServer(
    {
      name: "mcp-conformance-test-server",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {
          listChanged: true
        },
        resources: {
          subscribe: true,
          listChanged: true
        },
        prompts: {
          listChanged: true
        },
        logging: {},
        completions: {}
      }
    }
  );
  const originalSetRequestHandler = mcpServer.server.setRequestHandler.bind(
    mcpServer.server
  );
  mcpServer.registerTool(CUSTOM_HEADER_TOOL_NAME, {
    description: "Echo a string after SDK custom-header decoding and validation",
    inputSchema: { value: z.string() }
  }, renderCustomHeader);
  const listSchemasForCaching = /* @__PURE__ */ new Set([
    ListToolsRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema
  ]);
  mcpServer.server.setRequestHandler = ((schema, handler) => {
    if (listSchemasForCaching.has(schema)) {
      return originalSetRequestHandler(schema, async (...args) => {
        const result = await handler(...args);
        return { ...result, ttlMs: 3e5, cacheScope: "public" };
      });
    }
    return originalSetRequestHandler(schema, handler);
  });
  const registerResourceWithCacheHints = mcpServer.registerResource.bind(mcpServer);
  mcpServer.registerResource = ((name, uriOrTemplate, config, readCallback) => registerResourceWithCacheHints(
    name,
    uriOrTemplate,
    config,
    async (...args) => ({
      ...await readCallback(...args),
      ttlMs: 3e5,
      cacheScope: "private"
    })
  ));
  function sendLog(level, message, data) {
    mcpServer.server.notification({
      method: "notifications/message",
      params: {
        level,
        logger: "conformance-test-server",
        data: data || message
      }
    }).catch(() => {
    });
  }
  mcpServer.tool(
    "test_simple_text",
    "Tests simple text content response",
    {},
    async () => {
      return {
        content: [
          { type: "text", text: "This is a simple text response for testing." }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_image_content",
    {
      description: "Tests image content response"
    },
    async () => {
      return {
        content: [
          { type: "image", data: TEST_IMAGE_BASE64, mimeType: "image/png" }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_audio_content",
    {
      description: "Tests audio content response"
    },
    async () => {
      return {
        content: [
          { type: "audio", data: TEST_AUDIO_BASE64, mimeType: "audio/wav" }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_embedded_resource",
    {
      description: "Tests embedded resource content response"
    },
    async () => {
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: "test://embedded-resource",
              mimeType: "text/plain",
              text: "This is an embedded resource content."
            }
          }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_multiple_content_types",
    {
      description: "Tests response with multiple content types (text, image, resource)"
    },
    async () => {
      return {
        content: [
          { type: "text", text: "Multiple content types test:" },
          { type: "image", data: TEST_IMAGE_BASE64, mimeType: "image/png" },
          {
            type: "resource",
            resource: {
              uri: "test://mixed-content-resource",
              mimeType: "application/json",
              text: JSON.stringify({ test: "data", value: 123 })
            }
          }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_tool_with_logging",
    {
      description: "Tests tool that emits log messages during execution",
      inputSchema: {}
      // Empty schema so callback gets (args, extra) instead of just (extra)
    },
    async (_args, { sendNotification }) => {
      await sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          data: "Tool execution started"
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          data: "Tool processing data"
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          data: "Tool execution completed"
        }
      });
      return {
        content: [
          { type: "text", text: "Tool with logging executed successfully" }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_tool_with_progress",
    {
      description: "Tests tool that reports progress notifications",
      inputSchema: {}
      // Empty schema so callback gets (args, extra) instead of just (extra)
    },
    async (_args, { sendNotification, _meta }) => {
      const progressToken = _meta?.progressToken ?? 0;
      console.log("???? Progress token:", progressToken);
      await sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: 0,
          total: 100,
          message: `Completed step ${0} of ${100}`
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: 50,
          total: 100,
          message: `Completed step ${50} of ${100}`
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: 100,
          total: 100,
          message: `Completed step ${100} of ${100}`
        }
      });
      return {
        content: [{ type: "text", text: String(progressToken) }]
      };
    }
  );
  mcpServer.registerTool(
    "test_error_handling",
    {
      description: "Tests error response handling"
    },
    async () => {
      throw new Error("This tool intentionally returns an error for testing");
    }
  );
  mcpServer.registerTool(
    "test_reconnection",
    {
      description: "Tests SSE stream disconnection and client reconnection (SEP-1699). Server will close the stream mid-call and send the result after client reconnects.",
      inputSchema: {}
    },
    async (_args, { sessionId, requestId }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      console.log(`[${sessionId}] Starting test_reconnection tool...`);
      const transport = sessionId ? transports[sessionId] : void 0;
      if (transport && requestId) {
        console.log(
          `[${sessionId}] Closing SSE stream to trigger client polling...`
        );
        transport.closeSSEStream(requestId);
      }
      await sleep(100);
      console.log(`[${sessionId}] test_reconnection tool complete`);
      return {
        content: [
          {
            type: "text",
            text: "Reconnection test completed successfully. If you received this, the client properly reconnected after stream closure."
          }
        ]
      };
    }
  );
  mcpServer.registerTool(
    "test_sampling",
    {
      description: "Tests server-initiated sampling (LLM completion request)",
      inputSchema: {
        prompt: z.string().describe("The prompt to send to the LLM")
      }
    },
    createInteractiveToolHandler(
      "test_sampling",
      (args) => ({
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: args.prompt
                  }
                }
              ],
              maxTokens: 100
            }
          }),
      CreateMessageResultSchema,
      (result) => ({ content: [{ type: "text", text: `LLM response: ${result.content?.text || result.message?.content?.text || "No response"}` }] })
    )
  );
  mcpServer.registerTool(
    "test_elicitation",
    {
      description: "Tests server-initiated elicitation (user input request)",
      inputSchema: {
        message: z.string().describe("The message to show the user")
      }
    },
    createInteractiveToolHandler(
      "test_elicitation",
      (args) => ({
            method: "elicitation/create",
            params: {
              message: args.message,
              requestedSchema: {
                type: "object",
                properties: {
                  username: {
                    type: "string",
                    description: "User's response"
                  },
                  email: {
                    type: "string",
                    description: "User's email address"
                  }
                },
                required: ["username", "email"]
              }
            }
          }),
      ElicitResultSchema,
      (result) => ({ content: [{ type: "text", text: `User response: action=${result.action}, content=${JSON.stringify(result.content || {})}` }] })
    )
  );
  mcpServer.registerTool(
    "test_elicitation_sep1034_defaults",
    {
      description: "Tests elicitation with default values per SEP-1034",
      inputSchema: {}
    },
    createInteractiveToolHandler(
      "test_elicitation_sep1034_defaults",
      () => ({
            method: "elicitation/create",
            params: {
              message: "Please review and update the form fields with defaults",
              requestedSchema: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "User name",
                    default: "John Doe"
                  },
                  age: {
                    type: "integer",
                    description: "User age",
                    default: 30
                  },
                  score: {
                    type: "number",
                    description: "User score",
                    default: 95.5
                  },
                  status: {
                    type: "string",
                    description: "User status",
                    enum: ["active", "inactive", "pending"],
                    default: "active"
                  },
                  verified: {
                    type: "boolean",
                    description: "Verification status",
                    default: true
                  }
                },
                required: []
              }
            }
          }),
      ElicitResultSchema,
      (result) => ({ content: [{ type: "text", text: `Elicitation completed: action=${result.action}, content=${JSON.stringify(result.content || {})}` }] })
    )
  );
  mcpServer.registerTool(
    "test_elicitation_sep1330_enums",
    {
      description: "Tests elicitation with enum schema improvements per SEP-1330",
      inputSchema: {}
    },
    createInteractiveToolHandler(
      "test_elicitation_sep1330_enums",
      () => ({
            method: "elicitation/create",
            params: {
              message: "Please select options from the enum fields",
              requestedSchema: {
                type: "object",
                properties: {
                  // Untitled single-select enum (basic)
                  untitledSingle: {
                    type: "string",
                    description: "Select one option",
                    enum: ["option1", "option2", "option3"]
                  },
                  // Titled single-select enum (using oneOf with const/title)
                  titledSingle: {
                    type: "string",
                    description: "Select one option with titles",
                    oneOf: [
                      { const: "value1", title: "First Option" },
                      { const: "value2", title: "Second Option" },
                      { const: "value3", title: "Third Option" }
                    ]
                  },
                  // Legacy titled enum (using enumNames - deprecated)
                  legacyEnum: {
                    type: "string",
                    description: "Select one option (legacy)",
                    enum: ["opt1", "opt2", "opt3"],
                    enumNames: ["Option One", "Option Two", "Option Three"]
                  },
                  // Untitled multi-select enum
                  untitledMulti: {
                    type: "array",
                    description: "Select multiple options",
                    minItems: 1,
                    maxItems: 3,
                    items: {
                      type: "string",
                      enum: ["option1", "option2", "option3"]
                    }
                  },
                  // Titled multi-select enum (using anyOf with const/title)
                  titledMulti: {
                    type: "array",
                    description: "Select multiple options with titles",
                    minItems: 1,
                    maxItems: 3,
                    items: {
                      anyOf: [
                        { const: "value1", title: "First Choice" },
                        { const: "value2", title: "Second Choice" },
                        { const: "value3", title: "Third Choice" }
                      ]
                    }
                  }
                },
                required: []
              }
            }
          }),
      ElicitResultSchema,
      (result) => ({ content: [{ type: "text", text: `Elicitation completed: action=${result.action}, content=${JSON.stringify(result.content || {})}` }] })
    )
  );
  mcpServer.registerTool(
    "json_schema_2020_12_tool",
    {
      description: "Tool with JSON Schema 2020-12 features for conformance testing (SEP-1613)",
      inputSchema: {
        name: z.string().optional(),
        address: z.object({
          street: z.string().optional(),
          city: z.string().optional()
        }).optional()
      }
    },
    async (args) => {
      return {
        content: [
          {
            type: "text",
            text: `JSON Schema 2020-12 tool called with: ${JSON.stringify(args)}`
          }
        ]
      };
    }
  );
  mcpServer.registerResource(
    "static-text",
    "test://static-text",
    {
      title: "Static Text Resource",
      description: "A static text resource for testing",
      mimeType: "text/plain"
    },
    async () => {
      return {
        contents: [
          {
            uri: "test://static-text",
            mimeType: "text/plain",
            text: "This is the content of the static text resource."
          }
        ]
      };
    }
  );
  mcpServer.registerResource(
    "static-binary",
    "test://static-binary",
    {
      title: "Static Binary Resource",
      description: "A static binary resource (image) for testing",
      mimeType: "image/png"
    },
    async () => {
      return {
        contents: [
          {
            uri: "test://static-binary",
            mimeType: "image/png",
            blob: TEST_IMAGE_BASE64
          }
        ]
      };
    }
  );
  mcpServer.registerResource(
    "template",
    new ResourceTemplate("test://template/{id}/data", {
      list: void 0
    }),
    {
      title: "Resource Template",
      description: "A resource template with parameter substitution",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const id = variables.id;
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify({
              id,
              templateTest: true,
              data: `Data for ID: ${id}`
            })
          }
        ]
      };
    }
  );
  mcpServer.registerResource(
    "watched-resource",
    "test://watched-resource",
    {
      title: "Watched Resource",
      description: "A resource that auto-updates every 3 seconds",
      mimeType: "text/plain"
    },
    async () => {
      return {
        contents: [
          {
            uri: "test://watched-resource",
            mimeType: "text/plain",
            text: watchedResourceContent
          }
        ]
      };
    }
  );
  mcpServer.server.setRequestHandler(
    z.object({ method: z.literal("resources/subscribe") }).passthrough(),
    async (request) => {
      const uri = request.params.uri;
      resourceSubscriptions.add(uri);
      sendLog("info", `Subscribed to resource: ${uri}`);
      return {};
    }
  );
  mcpServer.server.setRequestHandler(
    z.object({ method: z.literal("resources/unsubscribe") }).passthrough(),
    async (request) => {
      const uri = request.params.uri;
      resourceSubscriptions.delete(uri);
      sendLog("info", `Unsubscribed from resource: ${uri}`);
      return {};
    }
  );
  mcpServer.registerPrompt(
    "test_simple_prompt",
    {
      title: "Simple Test Prompt",
      description: "A simple prompt without arguments"
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "This is a simple prompt for testing."
            }
          }
        ]
      };
    }
  );
  mcpServer.registerPrompt(
    "test_prompt_with_arguments",
    {
      title: "Prompt With Arguments",
      description: "A prompt with required arguments",
      argsSchema: {
        arg1: z.string().describe("First test argument"),
        arg2: z.string().describe("Second test argument")
      }
    },
    async (args) => {
      const { arg1, arg2 } = args;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Prompt with arguments: arg1='${arg1}', arg2='${arg2}'`
            }
          }
        ]
      };
    }
  );
  mcpServer.registerPrompt(
    "test_prompt_with_embedded_resource",
    {
      title: "Prompt With Embedded Resource",
      description: "A prompt that includes an embedded resource",
      argsSchema: {
        resourceUri: z.string().describe("URI of the resource to embed")
      }
    },
    async (args) => {
      const uri = args.resourceUri;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "resource",
              resource: {
                uri,
                mimeType: "text/plain",
                text: "Embedded resource content for testing."
              }
            }
          },
          {
            role: "user",
            content: {
              type: "text",
              text: "Please process the embedded resource above."
            }
          }
        ]
      };
    }
  );
  mcpServer.registerPrompt(
    "test_prompt_with_image",
    {
      title: "Prompt With Image",
      description: "A prompt that includes image content"
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "image",
              data: TEST_IMAGE_BASE64,
              mimeType: "image/png"
            }
          },
          {
            role: "user",
            content: { type: "text", text: "Please analyze the image above." }
          }
        ]
      };
    }
  );
  mcpServer.server.setRequestHandler(
    z.object({ method: z.literal("logging/setLevel") }).passthrough(),
    async (request) => {
      const level = request.params.level;
      sendLog("info", `Log level set to: ${level}`);
      return {};
    }
  );
  mcpServer.server.setRequestHandler(
    z.object({ method: z.literal("completion/complete") }).passthrough(),
    // eslint-disable-next-line no-unused-vars -- retain the upstream handler signature
    async (_request) => {
      return {
        completion: {
          values: [],
          total: 0,
          hasMore: false
        }
      };
    }
  );
  mcpServer.server.setRequestHandler(
    ListToolsRequestSchema,
    () => {
      const registeredTools = mcpServer._registeredTools;
      return {
        tools: Object.entries(registeredTools).filter(([, tool]) => tool.enabled).map(([name, tool]) => {
          if (name === CUSTOM_HEADER_TOOL_NAME) {
            return { name, description: tool.description, inputSchema: CUSTOM_HEADER_INPUT_SCHEMA };
          }
          if (name === "json_schema_2020_12_tool") {
            return {
              name,
              description: tool.description,
              inputSchema: JSON_SCHEMA_2020_12_INPUT_SCHEMA
            };
          }
          const inputSchema = tool.inputSchema ? toJsonSchemaCompat(tool.inputSchema, {
            strictUnions: true,
            pipeStrategy: "input"
          }) : { type: "object", properties: {} };
          return {
            name,
            title: tool.title,
            description: tool.description,
            inputSchema,
            annotations: tool.annotations,
            _meta: tool._meta
          };
        })
        // Note: SEP-2549 caching hints are added automatically by the
        // setRequestHandler wrapper above
      };
    }
  );
  return mcpServer;
}
function isInitializeRequest(body) {
  return body?.method === "initialize";
}
const app = createMcpExpressApp();
const activeListenStreams = [];
function notifyListenStreams(type, notificationMethod) {
  for (const stream of activeListenStreams) {
    const wants = type === "tools" ? stream.wantsTools : stream.wantsPrompts;
    if (!wants) continue;
    stream.res.write(
      "event: message\ndata: " + JSON.stringify({
        jsonrpc: "2.0",
        method: notificationMethod,
        params: {
          _meta: {
            "io.modelcontextprotocol/subscriptionId": stream.subscriptionId
          }
        }
      }) + "\n\n"
    );
  }
}
app.use(
  cors({
    origin: "*",
    // Allow all origins
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "last-event-id"]
  })
);
const LEGACY_SESSION_PROTOCOL_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25"
];
const STATELESS_CACHEABLE_METHODS = /* @__PURE__ */ new Set([
  "server/discover",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "resources/read"
]);
function sendStatelessJson(res, method, payload) {
  const result = payload.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    result.resultType ??= "complete";
    if (STATELESS_CACHEABLE_METHODS.has(method)) {
      result.ttlMs ??= 0;
      result.cacheScope ??= "private";
    }
  }
  return res.json(payload);
}
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const reqVersion = req.headers["mcp-protocol-version"];
  const body = req.body || {};
  const method = body.method;
  const id = body.id ?? null;
  const params = body.params || {};
  const meta = params._meta;
  const metaVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
  const isLegacySessionEraRequest = meta === void 0 && reqVersion !== void 0 && LEGACY_SESSION_PROTOCOL_VERSIONS.includes(reqVersion);
  if (!sessionId && (reqVersion || meta) && !isLegacySessionEraRequest) {
    if (!reqVersion) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: { code: -32020, message: "Missing MCP-Protocol-Version header" }
      });
    }
    if (!meta || !meta["io.modelcontextprotocol/protocolVersion"] || !meta["io.modelcontextprotocol/clientCapabilities"]) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "Invalid params: missing _meta or required fields"
        }
      });
    }
    if (reqVersion !== metaVersion) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32020,
          message: "Mismatched MCP-Protocol-Version header"
        }
      });
    }
    if (metaVersion !== "2026-07-28") {
      return res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32022,
          message: "UnsupportedProtocolVersionError",
          data: {
            supported: ["2026-07-28"],
            requested: String(metaVersion)
          }
        }
      });
    }
    if (method === "tools/call" && params.name === CUSTOM_HEADER_TOOL_NAME) {
      // The public SDK receives the original headers and parsed request. Its
      // registered schema validates custom headers before executing the echo.
      return customHeaderHandler(req, res, body);
    }
    if (method === "subscriptions/listen") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked"
      });
      const requestedNotifications = params.notifications || {};
      const trackingSubId = String(id ?? "sub-token-stateless-123");
      const wantsTools = requestedNotifications.toolsListChanged === true;
      const wantsPrompts = requestedNotifications.promptsListChanged === true;
      const watchedUris = Array.isArray(requestedNotifications.resourceSubscriptions)
        ? [...new Set(requestedNotifications.resourceSubscriptions.filter((uri) => uri === "test://watched-resource"))]
        : [];
      const ackFrame = {
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: {
          _meta: { "io.modelcontextprotocol/subscriptionId": trackingSubId },
          notifications: {
            ...wantsTools ? { toolsListChanged: true } : {},
            ...wantsPrompts ? { promptsListChanged: true } : {},
            ...watchedUris.length ? { resourceSubscriptions: watchedUris } : {}
          }
        }
      };
      res.write("event: message\ndata: " + JSON.stringify(ackFrame) + "\n\n");
      const stream = {
        res,
        subscriptionId: trackingSubId,
        wantsTools,
        wantsPrompts,
        watchedUris
      };
      activeListenStreams.push(stream);
      const updates = watchedUris.length ? setInterval(() => {
        watchedResourceContent = `Watched resource content revision ${++watchedResourceRevision}`;
        for (const uri of watchedUris) {
          res.write("event: message\ndata: " + JSON.stringify({
            jsonrpc: "2.0", method: "notifications/resources/updated",
            params: { uri, _meta: { "io.modelcontextprotocol/subscriptionId": trackingSubId } }
          }) + "\n\n");
        }
      }, 3000) : undefined;
      updates?.unref();
      res.on("close", () => {
        clearInterval(updates);
        const index = activeListenStreams.indexOf(stream);
        if (index !== -1) activeListenStreams.splice(index, 1);
      });
      return;
    }
    if (method === "server/discover") {
      return sendStatelessJson(res, method, {
        jsonrpc: "2.0",
        id,
        result: {
          supportedVersions: ["2026-07-28"],
          capabilities: {
            tools: { listChanged: true },
            // Explicitly announce dynamic capabilities matching Section 7 expectations
            prompts: { listChanged: true },
            // resources/list, resources/templates/list and resources/read are
            // served on this path, so the capability must be declared too.
            resources: { subscribe: true }
          },
          // Spec PR #3002: server identity lives in the result `_meta`.
          _meta: {
            "io.modelcontextprotocol/serverInfo": {
              name: "everything-stateless-server",
              version: "1.0.0"
            }
          }
        }
      });
    }
    if (method === "tools/list") {
      const dispatch = await getStatelessDispatchClient();
      try {
        const fromServer = await dispatch.client.request(
          { method: "tools/list", params: {} },
          ResultSchema
        );
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            ...fromServer,
            tools: [
              ...fromServer.tools,
              {
                name: "test_missing_capability",
                description: "Test tool requiring sampling",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_elicitation",
                description: "MRTR: returns InputRequiredResult with elicitation request",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_sampling",
                description: "MRTR: returns InputRequiredResult with sampling request",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_list_roots",
                description: "MRTR: returns InputRequiredResult with roots/list request",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_request_state",
                description: "MRTR: returns InputRequiredResult with requestState",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_multiple_inputs",
                description: "MRTR: returns InputRequiredResult with multiple input requests",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_multi_round",
                description: "MRTR: multi-round InputRequiredResult workflow",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_tampered_state",
                description: "MRTR: HMAC-signed requestState integrity test",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_input_required_result_capabilities",
                description: "MRTR: respects client capabilities in inputRequests",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_streaming_elicitation",
                description: "Diagnostic tool validating response progress streams",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "test_logging_tool",
                description: "Diagnostic logging validator tool",
                inputSchema: { type: "object", properties: {} }
              }
            ],
            // SEP-2549 caching hints are required on cacheable list results.
            ttlMs: 3e5,
            cacheScope: "public"
          }
        });
      } catch (e) {
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          error: { code: e.code ?? -32603, message: e.message, data: e.data }
        });
      } finally {
        await dispatch.close();
      }
    }
    if (method === "prompts/list") {
      const dispatch = await getStatelessDispatchClient();
      try {
        const fromServer = await dispatch.client.request(
          { method: "prompts/list", params: {} },
          ResultSchema
        );
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            ...fromServer,
            prompts: [
              ...fromServer.prompts,
              {
                name: "test_input_required_result_prompt",
                description: "MRTR: prompt that requires elicitation input"
              }
            ],
            ttlMs: 3e5,
            cacheScope: "public"
          }
        });
      } catch (e) {
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          error: { code: e.code ?? -32603, message: e.message, data: e.data }
        });
      } finally {
        await dispatch.close();
      }
    }
    if (method === "prompts/get") {
      if (params.name === "test_input_required_result_prompt") {
        const inputResponses = params.inputResponses;
        if (inputResponses?.["user_context"]) {
          const context = getMrtInputText(
            inputResponses["user_context"],
            "context"
          );
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: `Prompt with context: ${context}`
                  }
                }
              ]
            }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              user_context: {
                method: "elicitation/create",
                params: {
                  message: "What context should the prompt use?",
                  requestedSchema: {
                    type: "object",
                    properties: { context: { type: "string" } },
                    required: ["context"]
                  }
                }
              }
            }
          }
        });
      }
    }
    if (method === "resources/list") {
      const dispatch = await getStatelessDispatchClient();
      try {
        const fromServer = await dispatch.client.request(
          { method: "resources/list", params: {} },
          ResultSchema
        );
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            ...fromServer,
            resources: [
              ...fromServer.resources,
              {
                uri: "test://stateless-static-text",
                name: "Stateless Static Text",
                description: "A static text resource served on the draft path",
                mimeType: "text/plain"
              }
            ],
            ttlMs: 3e5,
            cacheScope: "public"
          }
        });
      } catch (e) {
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          error: { code: e.code ?? -32603, message: e.message, data: e.data }
        });
      } finally {
        await dispatch.close();
      }
    }
    if (method === "resources/templates/list") {
      const dispatch = await getStatelessDispatchClient();
      try {
        const fromServer = await dispatch.client.request(
          { method: "resources/templates/list", params: {} },
          ResultSchema
        );
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            ...fromServer,
            ttlMs: 3e5,
            cacheScope: "public"
          }
        });
      } catch (e) {
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          error: { code: e.code ?? -32603, message: e.message, data: e.data }
        });
      } finally {
        await dispatch.close();
      }
    }
    if (method === "resources/read") {
      const uri = params.uri;
      if (uri === "test://stateless-static-text") {
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "text/plain",
                text: "Static text content from the stateless draft path."
              }
            ],
            ttlMs: 3e5,
            cacheScope: "private"
          }
        });
      }
    }
    if (method === "tools/call") {
      const name = params.name;
      const inputResponses = params.inputResponses;
      const requestState = params.requestState;
      if (!interactiveToolDefinitions.size) createMcpServer();
      const interactive = interactiveToolDefinitions.get(name);
      if (interactive) {
        const args = params.arguments || {};
        const interaction = interactive.request(args);
        const capability = interaction.method === "sampling/createMessage" ? "sampling" : "elicitation";
        if (!meta["io.modelcontextprotocol/clientCapabilities"]?.[capability]) {
          return res.status(400).json({ jsonrpc: "2.0", id, error: {
            code: -32021, message: "Interaction capability required",
            data: { requiredCapabilities: { [capability]: {} } }
          } });
        }
        const binding = JSON.stringify({ name, args });
        if (inputResponses !== undefined || requestState !== undefined) {
          const state = verifyMrtState(requestState);
          const parsed = interactive.resultSchema.safeParse(inputResponses?.callback);
          if (state?.kind !== "legacy-callback" || state.binding !== binding || !parsed.success ||
              !inputResponses || Object.keys(inputResponses).length !== 1) {
            return res.status(400).json({ jsonrpc: "2.0", id,
              error: { code: -32602, message: "Invalid callback continuation" } });
          }
          return sendStatelessJson(res, method, { jsonrpc: "2.0", id, result: interactive.render(parsed.data) });
        }
        return sendStatelessJson(res, method, { jsonrpc: "2.0", id, result: {
          resultType: "input_required",
          inputRequests: { callback: {
            ...interaction,
            params: { ...interaction.params, ...(capability === "elicitation" ? { mode: "form" } : {}) }
          } },
          requestState: signMrtState({ kind: "legacy-callback", binding })
        } });
      }
      if (name === "test_missing_capability") {
        const clientCaps = meta["io.modelcontextprotocol/clientCapabilities"];
        if (!clientCaps?.sampling) {
          return res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32021,
              message: "MissingRequiredClientCapabilityError",
              // Per the schema, requiredCapabilities is a ClientCapabilities
              // object keyed by the missing capability, not an array of names.
              data: { requiredCapabilities: { sampling: {} } }
            }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: "Success" }] }
        });
      }
      if (name === "test_input_required_result_elicitation") {
        if (inputResponses !== undefined) {
          const parsed = z.record(z.string(), z.object({
            action: z.enum(["accept", "decline", "cancel"]),
            content: z.record(z.string(), z.unknown()).optional()
          })).safeParse(inputResponses);
          if (!parsed.success) {
            return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid inputResponses" } });
          }
        }
        if (inputResponses?.["user_name"]) {
          const userName = getMrtInputText(inputResponses["user_name"], "name");
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `Hello, ${userName}!` }] }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              user_name: {
                method: "elicitation/create",
                params: {
                  message: "What is your name?",
                  requestedSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                  }
                }
              }
            }
          }
        });
      }
      if (name === "test_input_required_result_sampling") {
        if (inputResponses?.["sample_request"]) {
          const sample = inputResponses["sample_request"];
          const content = sample.content;
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Sampling result: ${typeof content?.text === "string" ? content.text : "no response"}`
                }
              ]
            }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              sample_request: {
                method: "sampling/createMessage",
                params: {
                  messages: [
                    {
                      role: "user",
                      content: {
                        type: "text",
                        text: "What is the capital of France?"
                      }
                    }
                  ],
                  maxTokens: 100
                }
              }
            }
          }
        });
      }
      if (name === "test_input_required_result_list_roots") {
        if (inputResponses?.["roots_request"]) {
          const rootsResult = inputResponses["roots_request"];
          const roots = Array.isArray(rootsResult.roots) ? rootsResult.roots : [];
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Found ${roots.length} root(s)` }]
            }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              roots_request: { method: "roots/list", params: {} }
            }
          }
        });
      }
      if (name === "test_input_required_result_request_state") {
        if (requestState && inputResponses?.["confirm"]) {
          const state = JSON.parse(requestState);
          const ok = inputResponses["confirm"]?.content;
          if (state.kind === "request-state" && ok?.ok === true) {
            return sendStatelessJson(res, method, {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  { type: "text", text: "state-ok: requestState validated" }
                ]
              }
            });
          }
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              confirm: {
                method: "elicitation/create",
                params: {
                  message: "Please confirm",
                  requestedSchema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                    required: ["ok"]
                  }
                }
              }
            },
            requestState: JSON.stringify({
              kind: "request-state",
              nonce: randomUUID()
            })
          }
        });
      }
      if (name === "test_input_required_result_multiple_inputs") {
        if (requestState && inputResponses?.["user_name"] && inputResponses["greeting"] && inputResponses["client_roots"]) {
          const state = JSON.parse(requestState);
          if (state.kind === "multiple-inputs") {
            const userName = getMrtInputText(
              inputResponses["user_name"],
              "name"
            );
            const greetingContent = inputResponses["greeting"].content;
            const greeting = typeof greetingContent?.text === "string" ? greetingContent.text : "Hello there!";
            const rootsResult = inputResponses["client_roots"];
            const roots = Array.isArray(rootsResult.roots) ? rootsResult.roots : [];
            return sendStatelessJson(res, method, {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: `Name: ${userName}; Greeting: ${greeting}; Roots: ${roots.length}`
                  }
                ]
              }
            });
          }
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              user_name: {
                method: "elicitation/create",
                params: {
                  message: "What is your name?",
                  requestedSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                  }
                }
              },
              greeting: {
                method: "sampling/createMessage",
                params: {
                  messages: [
                    {
                      role: "user",
                      content: { type: "text", text: "Generate a greeting" }
                    }
                  ],
                  maxTokens: 50
                }
              },
              client_roots: { method: "roots/list", params: {} }
            },
            requestState: JSON.stringify({
              kind: "multiple-inputs",
              nonce: randomUUID()
            })
          }
        });
      }
      if (name === "test_input_required_result_multi_round") {
        if (!requestState) {
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              resultType: "input_required",
              inputRequests: {
                step1: {
                  method: "elicitation/create",
                  params: {
                    message: "Step 1: What is your name?",
                    requestedSchema: {
                      type: "object",
                      properties: { name: { type: "string" } },
                      required: ["name"]
                    }
                  }
                }
              },
              requestState: JSON.stringify({ round: 1, nonce: randomUUID() })
            }
          });
        }
        const state = JSON.parse(requestState);
        if (state.round === 1 && inputResponses?.["step1"]) {
          const userName = getMrtInputText(inputResponses["step1"], "name");
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              resultType: "input_required",
              inputRequests: {
                step2: {
                  method: "elicitation/create",
                  params: {
                    message: "Step 2: What is your favorite color?",
                    requestedSchema: {
                      type: "object",
                      properties: { color: { type: "string" } },
                      required: ["color"]
                    }
                  }
                }
              },
              requestState: JSON.stringify({
                round: 2,
                name: userName,
                nonce: randomUUID()
              })
            }
          });
        }
        if (state.round === 2 && inputResponses?.["step2"]) {
          const userName = typeof state.name === "string" ? state.name : "friend";
          const color = getMrtInputText(inputResponses["step2"], "color");
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Multi-round complete for ${userName} who likes ${color}`
                }
              ]
            }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              step1: {
                method: "elicitation/create",
                params: {
                  message: "Step 1: What is your name?",
                  requestedSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                  }
                }
              }
            },
            requestState: JSON.stringify({ round: 1, nonce: randomUUID() })
          }
        });
      }
      if (name === "test_input_required_result_tampered_state") {
        if (requestState) {
          const verified = verifyMrtState(requestState);
          if (!verified) {
            return sendStatelessJson(res, method, {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message: "requestState integrity check failed"
              }
            });
          }
          if (verified.kind === "tamper-test" && inputResponses?.["confirm"]) {
            return sendStatelessJson(res, method, {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  { type: "text", text: "integrity-ok: state verified" }
                ]
              }
            });
          }
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests: {
              confirm: {
                method: "elicitation/create",
                params: {
                  message: "Please confirm",
                  requestedSchema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                    required: ["ok"]
                  }
                }
              }
            },
            requestState: signMrtState({
              kind: "tamper-test",
              nonce: randomUUID()
            })
          }
        });
      }
      if (name === "test_input_required_result_capabilities") {
        const clientCaps = meta["io.modelcontextprotocol/clientCapabilities"];
        const inputRequests = {};
        if (clientCaps?.elicitation) {
          inputRequests["elicit_input"] = {
            method: "elicitation/create",
            params: {
              message: "Elicitation input",
              requestedSchema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"]
              }
            }
          };
        }
        if (clientCaps?.sampling) {
          inputRequests["sample_input"] = {
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "user",
                  content: { type: "text", text: "Sample request" }
                }
              ],
              maxTokens: 50
            }
          };
        }
        if (inputResponses && Object.keys(inputResponses).length > 0) {
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `capabilities-ok: received ${Object.keys(inputResponses).join(",")}`
                }
              ]
            }
          });
        }
        if (Object.keys(inputRequests).length === 0) {
          return sendStatelessJson(res, method, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: "No supported capabilities declared" }
              ]
            }
          });
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "input_required",
            inputRequests,
            requestState: signMrtState({
              kind: "capabilities-test",
              nonce: randomUUID()
            })
          }
        });
      }
      if (name === "test_streaming_elicitation") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache"
        });
        res.write(
          "event: message\ndata: " + JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: { progressToken: params._meta?.progressToken ?? "token-abc", total: 100, progress: 50 }
          }) + "\n\n"
        );
        return res.end(
          "event: message\ndata: " + JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { resultType: "complete", content: [{ type: "text", text: "Streaming complete" }] }
          }) + "\n\n"
        );
      }
      if (name === "test_logging_tool") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache"
        });
        if (meta && meta["io.modelcontextprotocol/logLevel"]) {
          res.write(
            "event: message\ndata: " + JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/message",
              params: {
                level: "info",
                data: "Diagnostic trace logging activated"
              }
            }) + "\n\n"
          );
        }
        return res.end(
          "event: message\ndata: " + JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { resultType: "complete", content: [{ type: "text", text: "Logging evaluated" }] }
          }) + "\n\n"
        );
      }
      if (name === "test_trigger_tool_change" || name === "test_trigger_prompt_change") {
        if (name === "test_trigger_tool_change") {
          notifyListenStreams("tools", "notifications/tools/list_changed");
        } else {
          notifyListenStreams("prompts", "notifications/prompts/list_changed");
        }
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: "Mutation triggered" }] }
        });
      }
    }
    if (method === "tools/call") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache"
      });
      const write = (msg) => res.write(`event: message
data: ${JSON.stringify(msg)}

`);
      const dispatch = await getStatelessDispatchClient();
      try {
        const result = await dispatch.client.request(
          { method, params },
          ResultSchema
        );
        for (const n of dispatch.drainNotifications()) write(n);
        write({ jsonrpc: "2.0", id, result: { ...result, resultType: "complete" } });
      } catch (e) {
        for (const n of dispatch.drainNotifications()) write(n);
        write({
          jsonrpc: "2.0",
          id,
          error: { code: e.code ?? -32603, message: e.message, data: e.data }
        });
      } finally {
        await dispatch.close();
      }
      return res.end();
    }
    if ([
      "resources/list",
      "resources/read",
      "resources/templates/list",
      "prompts/get",
      "completion/complete"
    ].includes(method)) {
      const dispatch = await getStatelessDispatchClient();
      try {
        const result = await dispatch.client.request(
          { method, params },
          ResultSchema
        );
        return sendStatelessJson(res, method, { jsonrpc: "2.0", id, result });
      } catch (e) {
        const data = e.data ?? (method === "resources/read" ? { uri: params.uri } : void 0);
        return sendStatelessJson(res, method, {
          jsonrpc: "2.0",
          id,
          error: { code: e.code ?? -32603, message: e.message, data }
        });
      } finally {
        await dispatch.close();
      }
    }
    if ([
      "initialize",
      "ping",
      "logging/setLevel",
      "resources/subscribe",
      "resources/unsubscribe"
    ].includes(method)) {
      return res.status(404).json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: "Method not found: removed stateful RPC"
        }
      });
    }
    return res.status(404).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" }
    });
  }
  try {
    let transport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const mcpServer = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore: createEventStore(),
        retryInterval: 5e3,
        // 5 second retry interval for SEP-1699
        onsessioninitialized: (newSessionId) => {
          transports[newSessionId] = transport;
          servers[newSessionId] = mcpServer;
          console.log(`Session initialized with ID: ${newSessionId}`);
        }
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
          if (servers[sid]) {
            servers[sid].close();
            delete servers[sid];
          }
          console.log(`Session ${sid} closed`);
        }
      };
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else if (sessionId) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Session not found"
        },
        id: null
      });
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32e3,
          message: "Invalid or missing session ID"
        },
        id: null
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const lastEventId = req.headers["last-event-id"];
  if (lastEventId) {
    console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.log(`Establishing SSE stream for session ${sessionId}`);
  }
  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling SSE stream:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing SSE stream");
    }
  }
});
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  if (!transports[sessionId]) {
    res.status(404).send("Session not found");
    return;
  }
  console.log(`Received session termination request for session ${sessionId}`);
  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});
const PORT = process.env.PORT || 3e3;
app.listen(PORT, "127.0.0.1", () => {
  console.log(
    `MCP Conformance Test Server running on http://localhost:${PORT}`
  );
  console.log(`  - MCP endpoint: http://localhost:${PORT}/mcp`);
});

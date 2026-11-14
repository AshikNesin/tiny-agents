/**
 * Rewrite step 3.1: a toolkit declares each tool once (`tool()` and
 * `defineToolkit()`), and that one declaration yields both the Capability
 * the app shows and the pi-durable extension the model runs. The toolkits
 * migrated so far must produce exactly what they produced when each tool
 * was declared twice: the inline snapshots were recorded from the old
 * declarations, before the migration, and must not change.
 */
import type { Extension } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import { gateHooksOf } from "../../../../packages/agent/src/approvals";
import { capabilityInfo, type Capability } from "../../../../packages/agent/src/capabilities";
import { createTasksToolkit } from "../../../../packages/agent/src/toolkits/tasks";
import { createWebToolkit } from "../../../../packages/agent/src/toolkits/web";

const stub = {} as never;

/** What pi-durable and the model see of an extension, plus which tools carry a gate plan. */
function extensionShape(extension: Extension) {
  return {
    name: extension.name,
    tools: (extension.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      // The JSON schema the model is offered.
      parameters: JSON.parse(JSON.stringify(tool.parameters)) as unknown,
      replay: tool.replay,
      gated: gateHooksOf(tool) !== undefined,
      fields: Object.keys(tool)
        .filter((key) => key !== "gate")
        .sort(),
    })),
    sections: (extension.sections ?? []).map((section) => ({
      key: section.key,
      tag: section.tag,
    })),
    hooks: extension.hooks?.length ?? 0,
    wraps: extension.wraps?.length ?? 0,
    tasks: extension.tasks?.length ?? 0,
  };
}

const shape = (capability: Capability) => {
  const info = capabilityInfo(capability);
  return {
    info,
    // Snapshots sort keys; the order the app and its tests see is kept here.
    keyOrder: [Object.keys(info).join(), ...info.tools.map((tool) => Object.keys(tool).join())],
    extension: extensionShape(capability.extension),
  };
};

describe("one declaration per tool (3.1)", () => {
  it("tasks: the Capability and extension are unchanged", () => {
    expect(shape(createTasksToolkit(stub))).toMatchInlineSnapshot(`
      {
        "extension": {
          "hooks": 0,
          "name": "tasks",
          "sections": [],
          "tasks": 0,
          "tools": [
            {
              "description": "Create a task (to-do) for the owner. Use for action items the owner mentions. Returns the task with its id.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "create_task",
              "parameters": {
                "properties": {
                  "description": {
                    "maxLength": 2000,
                    "type": "string",
                  },
                  "dueAt": {
                    "description": "ISO 8601 datetime; omit for no due date",
                    "format": "date-time",
                    "type": "string",
                  },
                  "priority": {
                    "enum": [
                      "low",
                      "medium",
                      "high",
                      "urgent",
                    ],
                    "type": "string",
                  },
                  "title": {
                    "maxLength": 300,
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "title",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "List the owner's tasks. Filter by status ('todo', 'in_progress', 'done'); default: open tasks.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "list_tasks",
              "parameters": {
                "properties": {
                  "status": {
                    "enum": [
                      "todo",
                      "in_progress",
                      "done",
                    ],
                    "type": "string",
                  },
                },
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "Update a task by id: title, notes, status, priority or due date. 'done' marks it complete.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "update_task",
              "parameters": {
                "properties": {
                  "description": {
                    "maxLength": 2000,
                    "type": "string",
                  },
                  "dueAt": {
                    "anyOf": [
                      {
                        "format": "date-time",
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "id": {
                    "type": "string",
                  },
                  "priority": {
                    "enum": [
                      "low",
                      "medium",
                      "high",
                      "urgent",
                    ],
                    "type": "string",
                  },
                  "status": {
                    "enum": [
                      "todo",
                      "in_progress",
                      "done",
                    ],
                    "type": "string",
                  },
                  "title": {
                    "maxLength": 300,
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "id",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "Mark a task done by id.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "complete_task",
              "parameters": {
                "properties": {
                  "id": {
                    "type": "string",
                  },
                },
                "required": [
                  "id",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "Permanently delete a task by id. Use only when the owner clearly asks; prefer complete_task.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "delete_task",
              "parameters": {
                "properties": {
                  "id": {
                    "type": "string",
                  },
                },
                "required": [
                  "id",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
          ],
          "wraps": 0,
        },
        "info": {
          "description": "Create and manage your tasks",
          "id": "tasks",
          "kind": "toolkit",
          "name": "Tasks",
          "tools": [
            {
              "askLabel": "add a task",
              "description": "Create a task",
              "label": "Added task",
              "name": "create_task",
            },
            {
              "askLabel": "list tasks",
              "description": "List tasks",
              "label": "Listed tasks",
              "name": "list_tasks",
              "readOnly": true,
            },
            {
              "askLabel": "update a task",
              "description": "Update a task",
              "label": "Updated task",
              "name": "update_task",
            },
            {
              "askLabel": "complete a task",
              "description": "Mark a task done",
              "label": "Completed task",
              "name": "complete_task",
            },
            {
              "askLabel": "delete a task",
              "description": "Delete a task",
              "label": "Deleted task",
              "name": "delete_task",
            },
          ],
        },
        "keyOrder": [
          "id,kind,name,description,tools",
          "name,label,askLabel,description",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description",
          "name,label,askLabel,description",
          "name,label,askLabel,description",
        ],
      }
    `);
  });

  it("web, configured with a vault: the Capability and extension are unchanged", () => {
    expect(shape(createWebToolkit({ apiKey: "key", vault: stub }))).toMatchInlineSnapshot(`
      {
        "extension": {
          "hooks": 0,
          "name": "web",
          "sections": [],
          "tasks": 0,
          "tools": [
            {
              "description": "Search the web. Returns the top results with title, URL and a snippet. Use web_fetch to read a result.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "web_search",
              "parameters": {
                "properties": {
                  "limit": {
                    "maximum": 10,
                    "minimum": 1,
                    "type": "integer",
                  },
                  "query": {
                    "maxLength": 2000,
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "query",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "Read a public web page as markdown.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "web_fetch",
              "parameters": {
                "properties": {
                  "url": {
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "url",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "Make an HTTP request from the server to a public API and read the response. To authenticate, pass \`auth\` with a vault handle (see vault_list): the server adds the key as a header, only for the hosts its item allows, and you never see it. Use web_fetch to read pages. Never type, ask for or repeat a password, card number, security code or one-time code yourself.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": true,
              "name": "http_request",
              "parameters": {
                "properties": {
                  "auth": {
                    "description": "Vault handle",
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string",
                  },
                  "body": {
                    "maxLength": 100000,
                    "type": "string",
                  },
                  "headers": {
                    "patternProperties": {
                      "^.*$": {
                        "maxLength": 2000,
                        "type": "string",
                      },
                    },
                    "type": "object",
                  },
                  "method": {
                    "anyOf": [
                      {
                        "const": "GET",
                        "type": "string",
                      },
                      {
                        "const": "POST",
                        "type": "string",
                      },
                      {
                        "const": "PUT",
                        "type": "string",
                      },
                      {
                        "const": "PATCH",
                        "type": "string",
                      },
                      {
                        "const": "DELETE",
                        "type": "string",
                      },
                      {
                        "const": "HEAD",
                        "type": "string",
                      },
                    ],
                  },
                  "url": {
                    "maxLength": 2000,
                    "minLength": 8,
                    "type": "string",
                  },
                },
                "required": [
                  "url",
                ],
                "type": "object",
              },
              "replay": "unsafe",
            },
          ],
          "wraps": 0,
        },
        "info": {
          "description": "Search and read web pages",
          "id": "web",
          "kind": "toolkit",
          "name": "Web",
          "tools": [
            {
              "askLabel": "search the web",
              "description": "Search the web",
              "label": "Searched the web",
              "name": "web_search",
              "readOnly": true,
            },
            {
              "askLabel": "read a page",
              "description": "Read a URL as markdown",
              "label": "Read page",
              "name": "web_fetch",
              "readOnly": true,
            },
            {
              "askLabel": "call an API",
              "description": "Make an HTTP request, optionally with a vault API key",
              "label": "Called an API",
              "name": "http_request",
              "vault": true,
            },
          ],
        },
        "keyOrder": [
          "id,kind,name,description,tools",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description,vault",
        ],
      }
    `);
  });

  it("web, configured without a vault: no http_request", () => {
    expect(shape(createWebToolkit({ apiKey: "key" }))).toMatchInlineSnapshot(`
      {
        "extension": {
          "hooks": 0,
          "name": "web",
          "sections": [],
          "tasks": 0,
          "tools": [
            {
              "description": "Search the web. Returns the top results with title, URL and a snippet. Use web_fetch to read a result.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "web_search",
              "parameters": {
                "properties": {
                  "limit": {
                    "maximum": 10,
                    "minimum": 1,
                    "type": "integer",
                  },
                  "query": {
                    "maxLength": 2000,
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "query",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
            {
              "description": "Read a public web page as markdown.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": false,
              "name": "web_fetch",
              "parameters": {
                "properties": {
                  "url": {
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "required": [
                  "url",
                ],
                "type": "object",
              },
              "replay": "safe",
            },
          ],
          "wraps": 0,
        },
        "info": {
          "description": "Search and read web pages",
          "id": "web",
          "kind": "toolkit",
          "name": "Web",
          "tools": [
            {
              "askLabel": "search the web",
              "description": "Search the web",
              "label": "Searched the web",
              "name": "web_search",
              "readOnly": true,
            },
            {
              "askLabel": "read a page",
              "description": "Read a URL as markdown",
              "label": "Read page",
              "name": "web_fetch",
              "readOnly": true,
            },
          ],
        },
        "keyOrder": [
          "id,kind,name,description,tools",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description,readOnly",
        ],
      }
    `);
  });

  it("web, not configured: search and fetch are listed but not offered", () => {
    expect(shape(createWebToolkit({ vault: stub }))).toMatchInlineSnapshot(`
      {
        "extension": {
          "hooks": 0,
          "name": "web",
          "sections": [],
          "tasks": 0,
          "tools": [
            {
              "description": "Make an HTTP request from the server to a public API and read the response. To authenticate, pass \`auth\` with a vault handle (see vault_list): the server adds the key as a header, only for the hosts its item allows, and you never see it. Use web_fetch to read pages. Never type, ask for or repeat a password, card number, security code or one-time code yourself.",
              "fields": [
                "description",
                "execute",
                "name",
                "parameters",
                "replay",
              ],
              "gated": true,
              "name": "http_request",
              "parameters": {
                "properties": {
                  "auth": {
                    "description": "Vault handle",
                    "maxLength": 64,
                    "minLength": 1,
                    "type": "string",
                  },
                  "body": {
                    "maxLength": 100000,
                    "type": "string",
                  },
                  "headers": {
                    "patternProperties": {
                      "^.*$": {
                        "maxLength": 2000,
                        "type": "string",
                      },
                    },
                    "type": "object",
                  },
                  "method": {
                    "anyOf": [
                      {
                        "const": "GET",
                        "type": "string",
                      },
                      {
                        "const": "POST",
                        "type": "string",
                      },
                      {
                        "const": "PUT",
                        "type": "string",
                      },
                      {
                        "const": "PATCH",
                        "type": "string",
                      },
                      {
                        "const": "DELETE",
                        "type": "string",
                      },
                      {
                        "const": "HEAD",
                        "type": "string",
                      },
                    ],
                  },
                  "url": {
                    "maxLength": 2000,
                    "minLength": 8,
                    "type": "string",
                  },
                },
                "required": [
                  "url",
                ],
                "type": "object",
              },
              "replay": "unsafe",
            },
          ],
          "wraps": 0,
        },
        "info": {
          "description": "Search and read web pages",
          "id": "web",
          "kind": "toolkit",
          "name": "Web",
          "setupHint": "Set TINYFISH_API_KEY to enable web search.",
          "tools": [
            {
              "askLabel": "search the web",
              "description": "Search the web",
              "label": "Searched the web",
              "name": "web_search",
              "readOnly": true,
            },
            {
              "askLabel": "read a page",
              "description": "Read a URL as markdown",
              "label": "Read page",
              "name": "web_fetch",
              "readOnly": true,
            },
            {
              "askLabel": "call an API",
              "description": "Make an HTTP request, optionally with a vault API key",
              "label": "Called an API",
              "name": "http_request",
              "vault": true,
            },
          ],
        },
        "keyOrder": [
          "id,kind,name,description,tools,setupHint",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description,vault",
        ],
      }
    `);
    expect(shape(createWebToolkit({}))).toMatchInlineSnapshot(`
      {
        "extension": {
          "hooks": 0,
          "name": "web",
          "sections": [],
          "tasks": 0,
          "tools": [],
          "wraps": 0,
        },
        "info": {
          "description": "Search and read web pages",
          "id": "web",
          "kind": "toolkit",
          "name": "Web",
          "setupHint": "Set TINYFISH_API_KEY to enable web search.",
          "tools": [
            {
              "askLabel": "search the web",
              "description": "Search the web",
              "label": "Searched the web",
              "name": "web_search",
              "readOnly": true,
            },
            {
              "askLabel": "read a page",
              "description": "Read a URL as markdown",
              "label": "Read page",
              "name": "web_fetch",
              "readOnly": true,
            },
          ],
        },
        "keyOrder": [
          "id,kind,name,description,tools,setupHint",
          "name,label,askLabel,description,readOnly",
          "name,label,askLabel,description,readOnly",
        ],
      }
    `);
  });

  it("http_request's gate plan is the vault plan, read by the gate", () => {
    const web = createWebToolkit({ apiKey: "key", vault: stub });
    const hooks = gateHooksOf(web.extension.tools!.find((t) => t.name === "http_request")!);
    expect(typeof hooks?.plan).toBe("function");
    expect(hooks?.settled).toBeTypeOf("function");
  });
});

#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer-core";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@notionhq/client";

// 1. Configuration & Environment Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Environment variables configuration
const requiredEnvVars = {
  NOTION_API_KEY: process.env.NOTION_API_KEY,
  BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
  BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID
};

// Validate required environment variables
Object.entries(requiredEnvVars).forEach(([name, value]) => {
  if (!value) throw new Error(`${name} environment variable is required`);
});

// Optional environment variables
const NOTION_PAGE_URL = process.env.NOTION_PAGE_URL || "https://www.notion.so/default-page";
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "default-database-id";

// 2. Global State
const browsers = new Map<string, { browser: Browser, page: Page }>();
const consoleLogs: string[] = [];
const screenshots = new Map<string, string>();
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// 3. Helper Functions
function extractNotionPageId(url: string): string {
  const match = url.match(/[a-zA-Z0-9]{8}-?[a-zA-Z0-9]{4}-?[a-zA-Z0-9]{4}-?[a-zA-Z0-9]{4}-?[a-zA-Z0-9]{12}/);
  if (!match) throw new Error("Could not extract page ID from Notion URL");
  return match[0].replace(/-/g, '');
}

async function createNewBrowserSession(sessionId: string) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}`
  });
  
  const page = (await browser.pages())[0];
  browsers.set(sessionId, { browser, page });
  
  // Set up console logging for this session
  page.on("console", (msg) => {
    const logEntry = `[Session ${sessionId}][${msg.type()}] ${msg.text()}`;
    consoleLogs.push(logEntry);
    server.notification({
      method: "notifications/cloud/message",
      params: { message: logEntry, type: "console_log" },
    });
  });
  
  return { browser, page };
}

// 4. Tool Definitions
const TOOLS: Tool[] = [
  {
    name: "puppeteer_create_session",
    description: "Create a new cloud browser session using Browserbase",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "puppeteer_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot" },
        selector: { type: "string", description: "CSS selector for element to screenshot" },
        width: { type: "number", description: "Width in pixels (default: 800)" },
        height: { type: "number", description: "Height in pixels (default: 600)" },
      },
      required: ["name"],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for input field" },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["script"],
    },
  },
  {
    name: "puppeteer_get_content",
    description: "Extract all content from the current page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { 
          type: "string", 
          description: "Optional CSS selector to get content from specific elements (default: returns whole page)",
          required: false 
        }
      },
      required: [], // Removed sessionId requirement since it's not needed
    },
  },
  {
    name: "puppeteer_parallel_sessions",
    description: "Create multiple browser sessions and navigate to different URLs",
    inputSchema: {
      type: "object",
      properties: {
        sessions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              id: { type: "string" }
            },
            required: ["url", "id"]
          }
        }
      },
      required: ["sessions"]
    }
  },
  {
    name: "notion_read_page",
    description: "Read content from a Notion page",
    inputSchema: {
      type: "object",
      properties: {
        pageUrl: { type: "string", description: "URL of the page to read" },
      },
      required: [], // Make optional since we'll use default URL if not provided
    },
  },
  {
    name: "notion_update_page",
    description: "Update content in a Notion page",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "ID of the page to update" },
        content: { type: "string", description: "Content to update" },
      },
      required: ["pageId", "content"],
    },
  },
  {
    name: "notion_append_content",
    description: "Append content to a Notion page",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "ID of the page to append to" },
        content: { type: "string", description: "Content to append" },
      },
      required: ["pageId", "content"],
    },
  },
  {
    name: "notion_read_comments",
    description: "Read comments from a Notion page",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "ID of the page to read comments from" },
      },
      required: ["pageId"],
    },
  },
  {
    name: "notion_add_comment",
    description: "Add a comment to a Notion page",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "ID of the page to comment on" },
        comment: { type: "string", description: "Comment text" },
      },
      required: ["pageId", "comment"],
    },
  },
  {
    name: "notion_add_to_database",
    description: "Add a new entry to a Notion database",
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { 
          type: "string", 
          description: "ID of the database (optional - will use default if not provided)" 
        },
        title: { type: "string", description: "Title of the entry" },
        tags: { 
          type: "array", 
          description: "Array of tags to add to the entry",
          items: { type: "string" }
        },
        properties: { 
          type: "object", 
          description: "Additional properties for the database entry (optional)",
          additionalProperties: true 
        },
        content: { type: "string", description: "Content for the page (optional)" }
      },
      required: ["title"],
    },
  },
];

// 5. Tool Handler Implementation
async function handleToolCall(name: string, args: any): Promise<{ toolResult: CallToolResult }> {
// const { browser, page } = browsers.get(args.sessionId) || await createNewBrowserSession(args.sessionId);
    
  // Only create default session if it's not a parallel_sessions call
  const defaultSession = name !== "puppeteer_parallel_sessions" ? 
    (browsers.get(args.sessionId) || await createNewBrowserSession(args.sessionId)) : 
    null;
  
  switch (name) {
    case "puppeteer_create_session":
      try {
        await createNewBrowserSession(args.sessionId);
        return {
          toolResult: {
            content: [{
              type: "text",
              text: "Created new browser session",
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to create browser session: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }
    case "puppeteer_navigate":
      await defaultSession!.page.goto(args.url);
      return {
        toolResult: {
          content: [{
            type: "text",
            text: `Navigated to ${args.url}`,
          }],
          isError: false,
        },
      };

    case "puppeteer_screenshot": {
      const width = args.width ?? 800;
      const height = args.height ?? 600;
      await defaultSession!.page.setViewport({ width, height });

      const screenshot = await (args.selector ? 
        (await defaultSession!.page.$(args.selector))?.screenshot({ encoding: "base64" }) :
        defaultSession!.page.screenshot({ encoding: "base64", fullPage: false }));

      if (!screenshot) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed",
            }],
            isError: true,
          },
        };
      }

      screenshots.set(args.name, screenshot as string);
      server.notification({
        method: "notifications/resources/list_changed",
      });

      return {
        toolResult: {
          content: [
            {
              type: "text",
              text: `Screenshot '${args.name}' taken at ${width}x${height}`,
            } as TextContent,
            {
              type: "image",
              data: screenshot,
              mimeType: "image/png",
            } as ImageContent,
          ],
          isError: false,
        },
      };
    }

    case "puppeteer_click":
      try {
        await defaultSession!.page.click(args.selector);
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Clicked: ${args.selector}`,
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to click ${args.selector}: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "puppeteer_fill":
      try {
        await defaultSession!.page.waitForSelector(args.selector);
        await defaultSession!.page.type(args.selector, args.value);
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Filled ${args.selector} with: ${args.value}`,
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to fill ${args.selector}: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "puppeteer_evaluate":
      try {
        const result = await defaultSession!.page.evaluate((script) => {
          const logs: string[] = [];
          const originalConsole = { ...console };
          
          ['log', 'info', 'warn', 'error'].forEach(method => {
            (console as any)[method] = (...args: any[]) => {
              logs.push(`[${method}] ${args.join(' ')}`);
              (originalConsole as any)[method](...args);
            };
          });

          try {
            const result = eval(script);
            Object.assign(console, originalConsole);
            return { result, logs };
          } catch (error) {
            Object.assign(console, originalConsole);
            throw error;
          }
        }, args.script);

        return {
          toolResult: {
            content: [
              {
                type: "text",
                text: `Execution result:\n${JSON.stringify(result.result, null, 2)}\n\nConsole output:\n${result.logs.join('\n')}`,
              },
            ],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Script execution failed: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "puppeteer_get_json":
      try {
        const result = await defaultSession!.page.evaluate((selector) => {
          // Helper function to find JSON in text
          function extractJSON(text: string) {
            const jsonObjects = [];
            let braceCount = 0;
            let start = -1;
            
            for (let i = 0; i < text.length; i++) {
              if (text[i] === '{') {
                if (braceCount === 0) start = i;
                braceCount++;
              } else if (text[i] === '}') {
                braceCount--;
                if (braceCount === 0 && start !== -1) {
                  try {
                    const jsonStr = text.slice(start, i + 1);
                    const parsed = JSON.parse(jsonStr);
                    jsonObjects.push(parsed);
                  } catch (e) {
                    // Invalid JSON, continue searching
                  }
                }
              }
            }
            return jsonObjects;
          }

          // Get all text content based on selector or full page
          const elements = selector ? 
            Array.from(document.querySelectorAll(selector)) : 
            [document.body];
          
          const results = {
            // Look for JSON in text content
            textContent: elements.flatMap(el => extractJSON(el.textContent || '')),
            
            // Look for JSON in script tags
            scriptTags: Array.from(document.getElementsByTagName('script'))
              .flatMap(script => {
                try {
                  if (script.type === 'application/json') {
                    return [JSON.parse(script.textContent || '')];
                  }
                  return extractJSON(script.textContent || '');
                } catch (e) {
                  return [];
                }
              }),
            
            // Look for JSON in meta tags
            metaTags: Array.from(document.getElementsByTagName('meta'))
              .flatMap(meta => {
                try {
                  const content = meta.getAttribute('content') || '';
                  return extractJSON(content);
                } catch (e) {
                  return [];
                }
              }),
            
            // Look for JSON-LD
            jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              .flatMap(script => {
                try {
                  return [JSON.parse(script.textContent || '')];
                } catch (e) {
                  return [];
                }
              })
          };

          return results;
        }, args.selector);

        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Found JSON content:\n${JSON.stringify(result, null, 2)}`,
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to extract JSON: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "puppeteer_get_content":
      try {
        let content;
        if (args.selector) {
          // If selector is provided, get content from specific elements
          content = await defaultSession!.page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            return Array.from(elements).map(el => el.textContent || '');
          }, args.selector);
        } else {
          // If no selector is provided, get content from the whole page
          content = await defaultSession!.page.evaluate(() => {
            return Array.from(document.querySelectorAll('*')).map(el => el.textContent || '');
          });
        }

        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Extracted content:\n${JSON.stringify(content, null, 2)}`,
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to extract content: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "puppeteer_parallel_sessions":
      try {
        console.log(`Starting parallel sessions for ${args.sessions.length} sessions`);
        const results = await Promise.all(args.sessions.map(async (session: { url: string, id: string }) => {
          console.log(`Creating session for ${session.id}: ${session.url}`);
          const { page } = await createNewBrowserSession(session.id);
          try {
            await page.goto(session.url);
            const content = await page.evaluate(() => document.body.innerText);
            return {
              id: session.id,
              url: session.url,
              content: content
            };
          } catch (error) {
            return {
              id: session.id,
              url: session.url,
              error: (error as Error).message
            };
          }
        }));

        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Parallel sessions results:\n${JSON.stringify(results, null, 2)}`,
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to execute parallel sessions: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "notion_read_page":
      try {
        const pageUrl = args.pageUrl || NOTION_PAGE_URL;
        const pageId = extractNotionPageId(pageUrl);
        const pageContent = await notion.blocks.children.list({
          block_id: pageId,
        });
        
        return {
          toolResult: {
            content: [{
              type: "text",
              text: JSON.stringify(pageContent, null, 2),
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to read page: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "notion_update_page":
      try {
        // Convert content string to blocks array
        const blocks = [{
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{
              type: 'text' as const,
              text: { content: args.content }
            }]
          }
        }];

        await notion.blocks.children.append({
          block_id: args.pageId,
          children: blocks,
        });

        return {
          toolResult: {
            content: [{
              type: "text",
              text: "Page updated successfully",
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to update page: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "notion_append_content":
      try {
        const blocks = [{
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{
              type: 'text' as const,
              text: { content: args.content }
            }]
          }
        }];

        await notion.blocks.children.append({
          block_id: args.pageId,
          children: blocks,
        });

        return {
          toolResult: {
            content: [{
              type: "text",
              text: "Content appended successfully",
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to append content: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "notion_read_comments":
      try {
        const comments = await notion.comments.list({
          block_id: args.pageId,
        });

        return {
          toolResult: {
            content: [{
              type: "text",
              text: JSON.stringify(comments, null, 2),
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to read comments: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "notion_add_comment":
      try {
        await notion.comments.create({
          parent: { page_id: args.pageId },
          rich_text: [{
            text: { content: args.comment }
          }],
        });

        return {
          toolResult: {
            content: [{
              type: "text",
              text: "Comment added successfully",
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to add comment: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    case "notion_add_to_database":
      try {
        // Process tags if provided
        const properties: any = {
          // Title is required
          Name: {
            title: [
              {
                text: {
                  content: args.title,
                },
              },
            ],
          },
        };

        // Add tags if provided
        if (args.tags && args.tags.length > 0) {
          properties.Tags = {
            multi_select: args.tags.map((tag: string) => ({ name: tag }))
          };
        }

        // Add any additional properties
        if (args.properties) {
          Object.assign(properties, args.properties);
        }

        const response = await notion.pages.create({
          parent: {
            database_id: args.databaseId || NOTION_DATABASE_ID,
          },
          properties,
          // Add content if provided
          ...(args.content && {
            children: [
              {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [
                    {
                      type: 'text',
                      text: {
                        content: args.content,
                      },
                    },
                  ],
                },
              },
            ],
          }),
        });

        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Created database entry: https://notion.so/${response.id.replace(/-/g, '')}`,
            }],
            isError: false,
          },
        };
      } catch (error) {
        return {
          toolResult: {
            content: [{
              type: "text",
              text: `Failed to create database entry: ${(error as Error).message}`,
            }],
            isError: true,
          },
        };
      }

    default:
      return {
        toolResult: {
          content: [{
            type: "text",
            text: `Unknown tool: ${name}`,
          }],
          isError: true,
        },
      };
  }
}

// 6. Server Setup and Configuration
const server = new Server(
  {
    name: "example-servers/browserbase",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// 7. Request Handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "console://logs",
      mimeType: "text/plain",
      name: "Browser console logs",
    },
    ...Array.from(screenshots.keys()).map(name => ({
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri.toString();
  
  if (uri === "console://logs") {
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: consoleLogs.join("\n"),
      }],
    };
  }

  if (uri.startsWith("screenshot://")) {
    const name = uri.split("://")[1];
    const screenshot = screenshots.get(name);
    if (screenshot) {
      return {
        contents: [{
          uri,
          mimeType: "image/png",
          blob: screenshot,
        }],
      };
    }
  }

  throw new Error(`Resource not found: ${uri}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => 
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

// 8. Server Initialization
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
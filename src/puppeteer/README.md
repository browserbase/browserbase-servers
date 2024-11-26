# Puppeteer (Browserbase Version) 🅱️

A Model Context Protocol server that provides browser automation capabilities using Puppeteer and Browserbase. This server enables LLMs to interact with web pages, take screenshots, and execute JavaScript in a real browser environment on the cloud.

This comes at scale, and is much cheaper than [Browserbase](https://www.browserbase.com). You can now run 100s of browser sessions on a single machine.

## Setup

Be sure to setup your environment variables in the `.env` file. 

In addition, you should set up your `.claude_desktop_config.json` file to use this server. You can access it through the Claude Desktop app or run `code ~/Library/Application\ Support/Claude/claude_desktop_config.json` in your terminal.

Your `.claude_desktop_config.json` should look something like this:

```json
{
  "mcpServers": {
    "browserbase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
      "env": {
        "BROWSERBASE_API_KEY": "YOUR_BROWSERBASE_API_KEY",
        "BROWSERBASE_PROJECT_ID": "YOUR_BROWSERBASE_PROJECT_ID",
        "NOTION_API_KEY": "YOUR_NOTION_API_KEY",
        "NOTION_PAGE_URL": "YOUR_NOTION_PAGE_URL", 
        "NOTION_DATABASE_ID": "YOUR_NOTION_DATABASE_ID"
      }
    }
  }
}
```

Run the script below to build and link the server to your local `node_modules` folder:

```bash
# Check TypeScript version
npx tsc --version

# Clean and rebuild
rm -rf build/
npm run build

# Link the server to your local node_modules folder
npm link
```

Finally, you should restart the Claude Desktop app. You'll be able to see the server in the list of MCP Tools available.

## Components

### Tools

- **puppeteer_create_session**
  - Create a new cloud browser session using Browserbase
  - Input: None required

- **puppeteer_navigate**
  - Navigate to any URL in the browser
  - Input: `url` (string)

- **puppeteer_screenshot**
  - Capture screenshots of the entire page or specific elements
  - Inputs:
    - `name` (string, required): Name for the screenshot
    - `selector` (string, optional): CSS selector for element to screenshot
    - `width` (number, optional, default: 800): Screenshot width
    - `height` (number, optional, default: 600): Screenshot height

- **puppeteer_click**
  - Click elements on the page
  - Input: `selector` (string): CSS selector for element to click

- **puppeteer_fill**
  - Fill out input fields
  - Inputs:
    - `selector` (string): CSS selector for input field
    - `value` (string): Value to fill

- **puppeteer_evaluate**
  - Execute JavaScript in the browser console
  - Input: `script` (string): JavaScript code to execute

- **puppeteer_get_content**
  - Extract all content from the current page
  - Input: `selector` (string, optional): CSS selector to get content from specific elements

- **puppeteer_parallel_sessions**
  - Create multiple browser sessions and navigate to different URLs
  - Input: `sessions` (array): Array of objects containing:
    - `url` (string): URL to navigate to
    - `id` (string): Session identifier

- **notion_read_page**
  - Read content from a Notion page
  - Input: `pageUrl` (string, optional): URL of the page to read

- **notion_update_page**
  - Update content in a Notion page
  - Inputs:
    - `pageId` (string): ID of the page to update
    - `content` (string): Content to update

- **notion_append_content**
  - Append content to a Notion page
  - Inputs:
    - `pageId` (string): ID of the page to append to
    - `content` (string): Content to append

- **notion_read_comments**
  - Read comments from a Notion page
  - Input: `pageId` (string): ID of the page to read comments from

- **notion_add_comment**
  - Add a comment to a Notion page
  - Inputs:
    - `pageId` (string): ID of the page to comment on
    - `comment` (string): Comment text

- **notion_add_to_database**
  - Add a new entry to a Notion database
  - Inputs:
    - `databaseId` (string, optional): ID of the database
    - `title` (string, required): Title of the entry
    - `tags` (array, optional): Array of tags to add to the entry
    - `properties` (object, optional): Additional properties for the database entry
    - `content` (string, optional): Content for the page

## Key Features

- Cloud platform
- Scalable infrastructure
- Browser automation
- Console log monitoring
- Screenshot capabilities
- JavaScript execution
- Basic web interaction (navigation, clicking, form filling)

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

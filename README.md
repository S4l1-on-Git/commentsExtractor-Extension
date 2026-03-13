# commentsExtractor

A Chrome extension that extracts HTML, CSS, and JS comments from any webpage.

Useful for recon during web pentests — developers often leave sensitive info in comments (credentials, internal paths, TODO notes, version info, etc).

## Features

- Extracts comments from the page HTML, all linked CSS files, and all linked JS files
- Parallel fetching — fast even on sites with many assets
- Tabbed view (HTML / CSS / JS)
- Export results as JSON or TXT
- Works on any http/https URL, not just the active tab

## Install

1. Clone or download this repo
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the repo folder

## Usage

Open the extension while on any webpage and click **ACTIVE TAB**, or paste a URL manually and hit **SCAN**.

## How it works

All network requests run through the background service worker (`background.js`), which bypasses CORS restrictions. The popup just handles the UI.

![commentsExtractor preview](assets/commentsExtractor.png)

Supports:
- `<!-- HTML comments -->`
- `/* CSS block comments */`
- `// JS single-line` and `/* JS block comments */`

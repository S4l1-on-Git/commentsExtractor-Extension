// content.js — injected into the page to extract comments from the live DOM.
// Reads comment nodes, inline style/script blocks, and fetches external files.
// Re-injection safe via window flag.

(function () {

  // ── extractors ─────────────────────────────────────────────────────────────

  function extractCssComments(css) {
    const out = [], re = /\/\*([\s\S]*?)\*\//g; let m;
    while ((m = re.exec(css)) !== null) {
      const c = m[0].trim();
      if (c) out.push(c);
    }
    return out;
  }

  function extractJsComments(js) {
    const out = [], re = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g; let m;
    while ((m = re.exec(js)) !== null) {
      const c = m[0].trim();
      if (c) out.push(c);
    }
    return out;
  }

  // ── main ───────────────────────────────────────────────────────────────────

  async function run(targetUrl) {
    const url = targetUrl || location.href;
    let htmlComments = [];

    if (url === location.href) {
      // ── same page: read live DOM directly (most reliable, no fetch needed) ──

      // 1. HTML comment nodes
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
      let node;
      while ((node = walker.nextNode())) {
        const c = node.nodeValue.trim();
        if (c) htmlComments.push(c);
      }
    } else {
      // ── different URL: fetch raw HTML and parse ────────────────────────────
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (r.ok) {
          const text = await r.text();
          const re = /<!--([\s\S]*?)-->/g; let m;
          while ((m = re.exec(text)) !== null) {
            const c = m[1].trim();
            if (c) htmlComments.push(c);
          }
        }
      } catch (_) {}
    }

    // 2. Inline <style> blocks — read textContent directly, no fetch
    const inlineCssComments = Array.from(document.querySelectorAll('style'))
      .flatMap(el => extractCssComments(el.textContent));

    // 3. Inline <script> blocks (no src) — read textContent directly
    const inlineJsComments = Array.from(document.querySelectorAll('script:not([src])'))
      .flatMap(el => extractJsComments(el.textContent));

    // 4. External CSS/JS — fetch from page context (same origin = no CORS issues)
    const cssUrls = Array.from(document.querySelectorAll('link[rel="stylesheet"], link[type="text/css"]'))
      .map(el => el.href).filter(Boolean);

    const jsUrls = Array.from(document.querySelectorAll('script[src]'))
      .map(el => el.src).filter(Boolean);

    async function safeFetch(u) {
      try {
        const r = await fetch(u, { credentials: 'include' });
        return r.ok ? r.text() : null;
      } catch { return null; }
    }

    const cssResults = await Promise.all(cssUrls.map(async u => {
      const text = await safeFetch(u);
      return { url: u, comments: text ? extractCssComments(text) : [] };
    }));

    const jsResults = await Promise.all(jsUrls.map(async u => {
      const text = await safeFetch(u);
      return { url: u, comments: text ? extractJsComments(text) : [] };
    }));

    // prepend inline blocks so they appear first
    if (inlineCssComments.length) cssResults.unshift({ url: 'inline', comments: inlineCssComments });
    if (inlineJsComments.length)  jsResults.unshift({ url: 'inline', comments: inlineJsComments });

    const totalCss = cssResults.reduce((s, r) => s + r.comments.length, 0);
    const totalJs  = jsResults.reduce((s, r) => s + r.comments.length, 0);

    return {
      url,
      timestamp: new Date().toISOString(),
      summary: {
        htmlComments: htmlComments.length,
        cssFiles:     cssUrls.length,
        cssComments:  totalCss,
        jsFiles:      jsUrls.length,
        jsComments:   totalJs,
        total:        htmlComments.length + totalCss + totalJs
      },
      html: htmlComments,
      css:  cssResults,
      js:   jsResults
    };
  }

  // ── message listener (re-injection safe) ───────────────────────────────────

  if (!window.__commentsExtractorReady) {
    window.__commentsExtractorReady = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.action === 'extractFromPage') {
        run(msg.url)
          .then(data => sendResponse({ success: true, data }))
          .catch(e   => sendResponse({ success: false, error: e.message }));
        return true;
      }
    });
  }

})();

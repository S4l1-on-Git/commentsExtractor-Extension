// background.js — fallback for manually typed external URLs only.
// Active tab scanning is handled by content.js injected from popup.js.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'extract') {
    runExtraction(msg.url)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err   => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function extractHtmlComments(html) {
  const out = [], re = /<!--([\s\S]*?)-->/g; let m;
  while ((m = re.exec(html)) !== null) { const c = m[1].trim(); if (c) out.push(c); }
  return out;
}

function extractCssComments(css) {
  const out = [], re = /\/\*([\s\S]*?)\*\//g; let m;
  while ((m = re.exec(css)) !== null) { const c = m[0].trim(); if (c) out.push(c); }
  return out;
}

function extractJsComments(js) {
  const out = [], re = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g; let m;
  while ((m = re.exec(js)) !== null) { const c = m[0].trim(); if (c) out.push(c); }
  return out;
}

function extractInlineCss(html) {
  const out = [], re = /<style[^>]*>([\s\S]*?)<\/style>/gi; let m;
  while ((m = re.exec(html)) !== null) if (m[1].trim()) out.push(m[1]);
  return out;
}

function extractInlineJs(html) {
  const out = [], re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html)) !== null) if (m[1].trim()) out.push(m[1]);
  return out;
}

function resolveUrl(base, rel) {
  try { return new URL(rel, base).href; } catch { return null; }
}

function parseResources(html, base) {
  const cssUrls = [], jsUrls = []; let m;
  const linkRe   = /<link\b[^>]+>/gi;
  const scriptRe = /<script\b[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    if (/rel=["']stylesheet["']/i.test(tag) || /type=["']text\/css["']/i.test(tag)) {
      const hm = /href=["']([^"']+)["']/i.exec(tag);
      if (hm) { const u = resolveUrl(base, hm[1]); if (u && !cssUrls.includes(u)) cssUrls.push(u); }
    }
  }
  while ((m = scriptRe.exec(html)) !== null) {
    const u = resolveUrl(base, m[1]);
    if (u && !jsUrls.includes(u)) jsUrls.push(u);
  }
  return { cssUrls, jsUrls };
}

async function runExtraction(targetUrl) {
  if (!/^https?:\/\//i.test(targetUrl))
    throw new Error(`Only http/https URLs supported — got: ${targetUrl}`);

  const res = await fetch(targetUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${targetUrl}`);
  const html = await res.text();

  const htmlComments      = extractHtmlComments(html);
  const { cssUrls, jsUrls } = parseResources(html, targetUrl);
  const inlineCssComments = extractInlineCss(html).flatMap(b => extractCssComments(b));
  const inlineJsComments  = extractInlineJs(html).flatMap(b => extractJsComments(b));

  async function safeFetch(url) {
    try { const r = await fetch(url); return r.ok ? r.text() : null; }
    catch { return null; }
  }

  const cssResults = await Promise.all(cssUrls.map(async url => {
    const text = await safeFetch(url);
    return { url, comments: text ? extractCssComments(text) : [] };
  }));

  const jsResults = await Promise.all(jsUrls.map(async url => {
    const text = await safeFetch(url);
    return { url, comments: text ? extractJsComments(text) : [] };
  }));

  if (inlineCssComments.length) cssResults.unshift({ url: 'inline', comments: inlineCssComments });
  if (inlineJsComments.length)  jsResults.unshift({ url: 'inline', comments: inlineJsComments });

  const totalCss = cssResults.reduce((s, r) => s + r.comments.length, 0);
  const totalJs  = jsResults.reduce((s, r) => s + r.comments.length, 0);

  return {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    summary: {
      htmlComments: htmlComments.length,
      cssFiles:     cssUrls.length, cssComments: totalCss,
      jsFiles:      jsUrls.length,  jsComments:  totalJs,
      total:        htmlComments.length + totalCss + totalJs
    },
    html: htmlComments,
    css:  cssResults,
    js:   jsResults
  };
}

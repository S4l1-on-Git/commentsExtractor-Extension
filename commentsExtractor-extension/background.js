chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "extract") {
    runExtraction(msg.url)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function extractHtmlComments(html) {
  const comments = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const c = m[1].trim();
    if (c) comments.push(c);
  }
  return comments;
}

function extractCssComments(css) {
  const comments = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const c = m[0].trim();
    if (c) comments.push(c);
  }
  return comments;
}

function extractJsComments(js) {
  const comments = [];
  const re = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    const c = m[0].trim();
    if (c) comments.push(c);
  }
  return comments;
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

function parseResources(html, baseUrl) {
  const cssUrls = [];
  const jsUrls = [];
  let m;

  const linkRe  = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
  const linkRe2 = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi;
  const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;

  while ((m = linkRe.exec(html))   !== null) { const u = resolveUrl(baseUrl, m[1]); if (u) cssUrls.push(u); }
  while ((m = linkRe2.exec(html))  !== null) { const u = resolveUrl(baseUrl, m[1]); if (u && !cssUrls.includes(u)) cssUrls.push(u); }
  while ((m = scriptRe.exec(html)) !== null) { const u = resolveUrl(baseUrl, m[1]); if (u) jsUrls.push(u); }

  return { cssUrls, jsUrls };
}

async function runExtraction(targetUrl) {
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error(`Only http/https URLs supported — got: ${targetUrl}`);
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  };

  const htmlRes = await fetch(targetUrl, { headers });
  if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status} on ${targetUrl}`);
  const html = await htmlRes.text();

  const htmlComments = extractHtmlComments(html);
  const { cssUrls, jsUrls } = parseResources(html, targetUrl);

  const cssResults = await Promise.all(cssUrls.map(async url => {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return { url, comments: [] };
      return { url, comments: extractCssComments(await res.text()) };
    } catch (e) {
      return { url, comments: [], error: e.message };
    }
  }));

  const jsResults = await Promise.all(jsUrls.map(async url => {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return { url, comments: [] };
      return { url, comments: extractJsComments(await res.text()) };
    } catch (e) {
      return { url, comments: [], error: e.message };
    }
  }));

  return {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    summary: {
      htmlComments: htmlComments.length,
      cssFiles: cssUrls.length,
      cssComments: cssResults.reduce((s, r) => s + r.comments.length, 0),
      jsFiles: jsUrls.length,
      jsComments: jsResults.reduce((s, r) => s + r.comments.length, 0),
      total: htmlComments.length +
             cssResults.reduce((s, r) => s + r.comments.length, 0) +
             jsResults.reduce((s, r) => s + r.comments.length, 0)
    },
    html: htmlComments,
    css: cssResults,
    js: jsResults
  };
}

let currentData = null;
let currentType  = 'html';

const urlInput     = document.getElementById('urlInput');
const scanBtn      = document.getElementById('scanBtn');
const activeTabBtn = document.getElementById('activeTabBtn');
const statusBar    = document.getElementById('statusBar');
const resultsPanel = document.getElementById('resultsPanel');
const tabsEl       = document.getElementById('tabs');
const toolbar      = document.getElementById('toolbar');

// pre-fill with active tab URL
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (tabs[0]?.url) urlInput.value = tabs[0].url;
});

// ── events ────────────────────────────────────────────────────────────────────

scanBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    // if typed URL matches active tab, use content script (page context)
    // otherwise fall back to background fetch
    if (tabs[0]?.url === url) runViaContentScript(tabs[0].id, url);
    else runViaBackground(url);
  });
});

activeTabBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    urlInput.value = tabs[0].url;
    runViaContentScript(tabs[0].id, tabs[0].url);
  });
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') scanBtn.click();
});

tabsEl.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  currentType = tab.dataset.type;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  renderResults();
});

document.getElementById('exportJson').addEventListener('click', exportJson);
document.getElementById('exportTxt').addEventListener('click',  exportTxt);

// ── active tab: inject content.js → message it ───────────────────────────────
// content.js reads the live DOM directly — same as DevTools console,
// no CORS, no session issues, no isolated world problems.

function runViaContentScript(tabId, url) {
  setLoading(true);

  chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
    if (chrome.runtime.lastError) {
      // injection failed (chrome:// page, PDF, etc.) — fall back to background
      runViaBackground(url);
      return;
    }
    chrome.tabs.sendMessage(tabId, { action: 'extractFromPage', url }, response => {
      setLoading(false);
      if (chrome.runtime.lastError) { showError(chrome.runtime.lastError.message); return; }
      if (!response?.success)       { showError(response?.error ?? 'no response from page'); return; }
      applyData(response.data);
    });
  });
}

// ── manual / external URL: background fetch ───────────────────────────────────

function runViaBackground(url) {
  setLoading(true);
  chrome.runtime.sendMessage({ action: 'extract', url }, response => {
    setLoading(false);
    if (chrome.runtime.lastError) { showError(chrome.runtime.lastError.message); return; }
    if (!response?.success)       { showError(response?.error ?? 'unknown error'); return; }
    applyData(response.data);
  });
}

// ── apply result data to UI ───────────────────────────────────────────────────

function applyData(data) {
  currentData = data;
  tabsEl.style.display  = 'none';
  toolbar.style.display = 'none';

  const s = data.summary;
  document.getElementById('htmlCount').textContent = s.htmlComments;
  document.getElementById('cssCount').textContent  = s.cssComments;
  document.getElementById('jsCount').textContent   = s.jsComments;

  statusBar.innerHTML = `
    <span>HTML <span class="stat-value html">${s.htmlComments}</span></span>
    <span>CSS <span class="stat-value css">${s.cssFiles} files · ${s.cssComments}</span></span>
    <span>JS <span class="stat-value js">${s.jsFiles} files · ${s.jsComments}</span></span>
    <span>total <span class="stat-value total">${s.total}</span></span>
  `;

  tabsEl.style.display  = 'flex';
  toolbar.style.display = 'flex';
  renderResults();
}

// ── rendering ─────────────────────────────────────────────────────────────────

function renderResults() {
  if (!currentData) return;
  resultsPanel.innerHTML = '';

  if (currentType === 'html') {
    if (currentData.html.length) renderGroup('HTML Page', currentData.html, 'html');
    else resultsPanel.innerHTML = emptyHtml('no HTML comments found');

  } else if (currentType === 'css') {
    const wc = currentData.css.filter(f => f.comments.length > 0);
    if (wc.length) wc.forEach(f => renderGroup(
      f.url === 'inline' ? 'inline <style>' : (f.url.split('/').pop() || f.url),
      f.comments, 'css', f.url === 'inline' ? null : f.url
    ));
    else resultsPanel.innerHTML = emptyHtml('no CSS comments found');

  } else {
    const wc = currentData.js.filter(f => f.comments.length > 0);
    if (wc.length) wc.forEach(f => renderGroup(
      f.url === 'inline' ? 'inline <script>' : (f.url.split('/').pop() || f.url),
      f.comments, 'js', f.url === 'inline' ? null : f.url
    ));
    else resultsPanel.innerHTML = emptyHtml('no JS comments found');
  }
}

function renderGroup(name, comments, type, fullUrl) {
  const group  = document.createElement('div');
  group.className = 'file-group';

  const header = document.createElement('div');
  header.className = 'file-header';

  const nameEl = document.createElement('div');
  nameEl.className = 'file-name';
  if (fullUrl) nameEl.title = fullUrl;
  nameEl.innerHTML = `<span class="file-type-label ${type}">[${type.toUpperCase()}]</span>${esc(name)}`;

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;align-items:center;gap:6px';

  const countEl = document.createElement('span');
  countEl.className = `file-count ${type}`;
  countEl.textContent = `${comments.length} comment${comments.length !== 1 ? 's' : ''}`;

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '▼';

  right.appendChild(countEl);
  right.appendChild(chevron);
  header.appendChild(nameEl);
  header.appendChild(right);
  group.appendChild(header);

  const list = document.createElement('div');
  list.className = 'comments-list';
  comments.forEach(c => {
    const item = document.createElement('div');
    item.className = 'comment-item';
    item.textContent = c;
    list.appendChild(item);
  });
  group.appendChild(list);

  header.addEventListener('click', () => {
    list.style.display = list.style.display === 'none' ? '' : 'none';
    header.classList.toggle('collapsed');
  });

  resultsPanel.appendChild(group);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function setLoading(on) {
  currentData           = null;
  tabsEl.style.display  = 'none';
  toolbar.style.display = 'none';
  scanBtn.disabled      = on;
  activeTabBtn.disabled = on;
  if (on) {
    statusBar.innerHTML    = `<span class="spinner"></span><span style="color:var(--green)">scanning…</span>`;
    resultsPanel.innerHTML = `<div class="empty-state">fetching resources…</div>`;
  }
}

function showError(msg) {
  setLoading(false);
  resultsPanel.innerHTML = `<div class="error-msg">error: ${esc(msg)}</div>`;
  statusBar.innerHTML    = `<span style="color:var(--red)">failed</span>`;
}

function emptyHtml(msg) {
  return `<div class="empty-state">${esc(msg)}</div>`;
}

function exportJson() {
  if (!currentData) return;
  download(
    new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' }),
    `comments_${sanitize(currentData.url)}.json`
  );
}

function exportTxt() {
  if (!currentData) return;
  const d = currentData;
  const lines = [
    `commentsExtractor — ${d.url}`, d.timestamp,
    `total: ${d.summary.total} comments\n`,
    `HTML Comments (${d.html.length}):`,
    ...d.html.map(c => `  - ${c}`)
  ];
  d.css.forEach(f => {
    if (!f.comments.length) return;
    lines.push(`\nCSS: ${f.url} (${f.comments.length}):`);
    f.comments.forEach(c => lines.push(`  - ${c}`));
  });
  d.js.forEach(f => {
    if (!f.comments.length) return;
    lines.push(`\nJS: ${f.url} (${f.comments.length}):`);
    f.comments.forEach(c => lines.push(`  - ${c}`));
  });
  download(
    new Blob([lines.join('\n')], { type: 'text/plain' }),
    `comments_${sanitize(d.url)}.txt`
  );
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => URL.revokeObjectURL(url));
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sanitize(url) {
  return url.replace(/^https?:\/\//,'').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,60);
}

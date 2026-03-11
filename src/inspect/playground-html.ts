/**
 * Inspect — Playground HTML renderer
 *
 * Self-contained HTML template for the browser-based playground UI.
 */

import type { RuntimePlaygroundSnapshot } from './playground.js'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}

export function renderPlaygroundHtml(snapshot: RuntimePlaygroundSnapshot, entrypoint: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Raffel Playground</title>
  <style>
    :root {
      --bg: #f4efe6;
      --panel: #fffaf3;
      --line: #d8cdbd;
      --ink: #1f2a2e;
      --muted: #6f7c82;
      --accent: #0d6b66;
      --accent-soft: #d6efe8;
      --danger: #a5372d;
      --mono: "IBM Plex Mono", "SFMono-Regular", Menlo, monospace;
      --sans: "Space Grotesk", "Avenir Next", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at top, #fff6ea, var(--bg)); color: var(--ink); font-family: var(--sans); }
    .shell { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(255,250,243,0.9); backdrop-filter: blur(10px); padding: 24px 20px; }
    .title { font-size: 28px; line-height: 1; margin: 0 0 8px; }
    .subtitle { color: var(--muted); margin: 0 0 18px; font-size: 14px; }
    .search { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: white; margin-bottom: 18px; }
    .group { margin-bottom: 18px; }
    .group h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .entry-btn { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; }
    .entry-btn:hover, .entry-btn.active { background: var(--accent-soft); border-color: rgba(13,107,102,0.16); }
    .entry-label { display: block; font-size: 14px; font-weight: 700; }
    .entry-meta { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
    .main { padding: 28px; }
    .hero { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .hero h1 { margin: 0 0 6px; font-size: 34px; }
    .hero p { margin: 0; color: var(--muted); }
    .pill { display: inline-flex; align-items: center; padding: 5px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 20px; box-shadow: 0 16px 40px rgba(31,42,46,0.06); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    .editor { display: flex; flex-direction: column; gap: 6px; }
    .editor.full { grid-column: 1 / -1; }
    .editor label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    textarea, pre, .target { width: 100%; border: 1px solid var(--line); border-radius: 14px; background: white; padding: 12px; font-family: var(--mono); font-size: 12px; min-height: 120px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
    .target { min-height: auto; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
    button.action { appearance: none; border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer; background: var(--accent); color: white; font-weight: 700; }
    button.secondary { background: #e9dfd0; color: var(--ink); }
    button.danger { background: var(--danger); }
    .status { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <h1 class="title">Raffel Playground</h1>
      <p class="subtitle">${escapeHtml(entrypoint)}</p>
      <input class="search" id="search" placeholder="Filter operations, routes, channels">
      <div id="entries"></div>
    </aside>
    <main class="main">
      <div class="hero">
        <div>
          <h1>Unified local invocation</h1>
          <p>HTTP, GraphQL, JSON-RPC, gRPC, channels, and streams from one inspection graph.</p>
        </div>
        <span class="pill">${snapshot.entries.length} subjects</span>
      </div>
      <section class="panel" id="detail"></section>
    </main>
  </div>
  <script>
    const SNAPSHOT = ${escapeJsonForScript(snapshot)};
    const entryContainer = document.getElementById('entries');
    const detail = document.getElementById('detail');
    const searchInput = document.getElementById('search');
    let activeKey = SNAPSHOT.entries[0] ? SNAPSHOT.entries[0].key : null;
    let activeSession = null;
    let sessionPollTimer = null;

    function esc(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    function pretty(value) {
      return JSON.stringify(value ?? {}, null, 2);
    }

    function groupedEntries(filter) {
      const filtered = SNAPSHOT.entries.filter((entry) => {
        if (!filter) return true;
        const haystack = [entry.label, entry.description, entry.operationId, entry.channelId, entry.protocol, entry.mode]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(filter.toLowerCase());
      });

      const groups = new Map();
      for (const entry of filtered) {
        if (!groups.has(entry.protocol)) {
          groups.set(entry.protocol, []);
        }
        groups.get(entry.protocol).push(entry);
      }
      return Array.from(groups.entries());
    }

    function parseJson(text, fallback) {
      try {
        return text ? JSON.parse(text) : fallback;
      } catch (error) {
        throw new Error('Invalid JSON: ' + error.message);
      }
    }

    function currentEntry() {
      return SNAPSHOT.entries.find((entry) => entry.key === activeKey) || null;
    }

    function stopPolling() {
      if (sessionPollTimer) {
        clearInterval(sessionPollTimer);
        sessionPollTimer = null;
      }
    }

    async function refreshSession(sessionId) {
      const response = await fetch('/__session/' + encodeURIComponent(sessionId));
      if (!response.ok) {
        throw new Error('Failed to refresh session');
      }
      activeSession = await response.json();
      const sessionView = document.getElementById('sessionView');
      if (sessionView) {
        sessionView.textContent = pretty(activeSession);
      }
    }

    async function invoke(entry, editors) {
      const payload = {
        entry: entry.key,
        headers: parseJson(editors.headers?.value || '{}', {}),
        metadata: parseJson(editors.metadata?.value || '{}', {}),
        params: parseJson(editors.params?.value || '{}', {}),
        query: parseJson(editors.query?.value || '{}', {}),
        body: editors.body ? parseJson(editors.body.value || 'null', null) : undefined,
        document: editors.document ? editors.document.value : undefined,
      };

      const response = await fetch('/__invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      editors.output.textContent = pretty(result);
    }

    async function openSession(entry, editors) {
      const payload = {
        entry: entry.key,
        headers: parseJson(editors.headers?.value || '{}', {}),
        metadata: parseJson(editors.metadata?.value || '{}', {}),
        params: parseJson(editors.params?.value || '{}', {}),
        query: parseJson(editors.query?.value || '{}', {}),
        body: editors.body ? parseJson(editors.body.value || 'null', null) : undefined,
      };

      const response = await fetch('/__session/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      activeSession = result;
      editors.output.textContent = pretty(result);
      stopPolling();
      if (result.id) {
        sessionPollTimer = setInterval(() => {
          refreshSession(result.id).catch((error) => {
            stopPolling();
            editors.output.textContent = JSON.stringify({ error: error.message }, null, 2);
          });
        }, 700);
      }
    }

    async function sendSessionMessage(editors) {
      if (!activeSession?.id) {
        throw new Error('No active session');
      }
      const response = await fetch('/__session/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          message: parseJson(editors.message.value || 'null', null),
        }),
      });
      const result = await response.json();
      await refreshSession(result.id || activeSession.id);
      editors.output.textContent = pretty(activeSession);
    }

    async function closeSession(editors) {
      if (!activeSession?.id) return;
      await fetch('/__session/' + encodeURIComponent(activeSession.id), { method: 'DELETE' });
      await refreshSession(activeSession.id).catch(() => {});
      stopPolling();
      editors.output.textContent = pretty(activeSession);
    }

    function addEditor(parent, label, value, id, full) {
      const wrap = document.createElement('div');
      wrap.className = 'editor' + (full ? ' full' : '');
      const title = document.createElement('label');
      title.textContent = label;
      const area = document.createElement('textarea');
      area.id = id;
      area.value = typeof value === 'string' ? value : pretty(value);
      wrap.append(title, area);
      parent.appendChild(wrap);
      return area;
    }

    function renderDetail() {
      const entry = currentEntry();
      if (!entry) {
        detail.innerHTML = '<p>No playground subjects available.</p>';
        return;
      }

      stopPolling();
      activeSession = null;
      detail.innerHTML = '';

      const heading = document.createElement('div');
      heading.innerHTML = '<h2 style="margin:0 0 6px;">' + esc(entry.label) + '</h2>'
        + '<div class="status">' + esc(entry.protocol.toUpperCase() + ' · ' + entry.mode + ' · ' + (entry.operationId || entry.channelId || entry.bindingId)) + '</div>'
        + '<div class="target">' + esc(JSON.stringify(entry.target, null, 2)) + '</div>';
      detail.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'grid';
      const editors = {
        headers: addEditor(grid, 'Headers', entry.defaults.headers || {}, 'headers'),
        metadata: addEditor(grid, 'Metadata', entry.defaults.metadata || {}, 'metadata'),
        params: addEditor(grid, 'Params', entry.defaults.params || {}, 'params'),
        query: addEditor(grid, 'Query', entry.defaults.query || {}, 'query'),
        body: null,
        document: null,
        message: null,
        output: document.createElement('pre'),
      };

      if (entry.defaults.body !== undefined) {
        editors.body = addEditor(grid, 'Body', entry.defaults.body, 'body', true);
      }
      if (entry.defaults.document) {
        editors.document = addEditor(grid, 'GraphQL Document', entry.defaults.document, 'document', true);
      }
      if (entry.defaults.message) {
        editors.message = addEditor(grid, 'Session Message', entry.defaults.message, 'message', true);
      }

      detail.appendChild(grid);

      const actions = document.createElement('div');
      actions.className = 'actions';

      if (!entry.session) {
        const invokeBtn = document.createElement('button');
        invokeBtn.className = 'action';
        invokeBtn.textContent = 'Invoke';
        invokeBtn.onclick = () => invoke(entry, editors).catch((error) => {
          editors.output.textContent = pretty({ error: error.message });
        });
        actions.appendChild(invokeBtn);
      } else {
        const openBtn = document.createElement('button');
        openBtn.className = 'action';
        openBtn.textContent = 'Open Session';
        openBtn.onclick = () => openSession(entry, editors).catch((error) => {
          editors.output.textContent = pretty({ error: error.message });
        });
        actions.appendChild(openBtn);

        if (editors.message) {
          const sendBtn = document.createElement('button');
          sendBtn.className = 'action secondary';
          sendBtn.textContent = 'Send Message';
          sendBtn.onclick = () => sendSessionMessage(editors).catch((error) => {
            editors.output.textContent = pretty({ error: error.message });
          });
          actions.appendChild(sendBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'action danger';
        closeBtn.textContent = 'Close Session';
        closeBtn.onclick = () => closeSession(editors).catch((error) => {
          editors.output.textContent = pretty({ error: error.message });
        });
        actions.appendChild(closeBtn);
      }

      detail.appendChild(actions);

      const outputWrap = document.createElement('div');
      outputWrap.className = 'editor full';
      const outputLabel = document.createElement('label');
      outputLabel.textContent = entry.session ? 'Session Inspector' : 'Response Inspector';
      editors.output.id = 'sessionView';
      editors.output.textContent = pretty({ ready: true });
      outputWrap.append(outputLabel, editors.output);
      detail.appendChild(outputWrap);
    }

    function renderEntries() {
      entryContainer.innerHTML = '';
      for (const [protocol, entries] of groupedEntries(searchInput.value)) {
        const group = document.createElement('section');
        group.className = 'group';
        const title = document.createElement('h3');
        title.textContent = protocol;
        group.appendChild(title);

        for (const entry of entries) {
          const button = document.createElement('button');
          button.className = 'entry-btn' + (entry.key === activeKey ? ' active' : '');
          button.innerHTML = '<span class="entry-label">' + esc(entry.label) + '</span>'
            + '<span class="entry-meta">' + esc((entry.operationId || entry.channelId || '') + ' · ' + entry.mode) + '</span>';
          button.onclick = () => {
            activeKey = entry.key;
            renderEntries();
            renderDetail();
          };
          group.appendChild(button);
        }

        entryContainer.appendChild(group);
      }
    }

    searchInput.addEventListener('input', renderEntries);
    renderEntries();
    renderDetail();
  </script>
</body>
</html>`
}

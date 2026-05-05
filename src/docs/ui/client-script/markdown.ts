/**
 * Embedded docs UI client script chunk.
 */

export const markdownClientScript = String.raw`    // Helper to escape text for display
    function esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function escapeAttr(str) {
      return esc(str).replace(/"/g, '&quot;');
    }

    function isSafeUrl(url) {
      return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url);
    }

    function slugifyHeading(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    function parseInlineMarkdown(value) {
      if (!value) return '';
      const codeTokens = [];
      const tick = String.fromCharCode(96);
      const inlineCodeRe = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
      let text = String(value).replace(inlineCodeRe, function(_match, code) {
        const token = '\u0000INLINE_CODE_' + codeTokens.length + '\u0000';
        codeTokens.push('<code class="md-inline-code">' + esc(code) + '</code>');
        return token;
      });

      text = esc(text);
      text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, function(match, alt, url, title) {
        if (!isSafeUrl(url)) return match;
        const titleAttr = title ? ' title="' + escapeAttr(title) + '"' : '';
        return '<img class="md-image" src="' + escapeAttr(url) + '" alt="' + escapeAttr(alt) + '"' + titleAttr + '>';
      });
      text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, function(match, label, url, title) {
        if (!isSafeUrl(url)) return match;
        const external = /^https?:\/\//i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
        const titleAttr = title ? ' title="' + escapeAttr(title) + '"' : '';
        return '<a href="' + escapeAttr(url) + '"' + external + titleAttr + '>' + label + '</a>';
      });
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
      codeTokens.forEach(function(html, index) {
        text = text.replace('\u0000INLINE_CODE_' + index + '\u0000', html);
      });
      return text;
    }

    function normalizeTabTitle(value) {
      return String(value || '')
        .replace(/^\*\*/, '')
        .replace(/\*\*$/, '')
        .trim();
    }

    function renderAlertBlock(lines) {
      const first = lines[0] || '';
      const match = first.match(/^\[!(NOTE|TIP|WARNING|DANGER|INFO)\]\s*(.*)$/i);
      if (!match) return null;
      const kind = match[1].toLowerCase();
      const title = match[2] || match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      const body = lines.slice(1).join('\n');
      return '<aside class="md-alert md-alert-' + escapeAttr(kind) + '">' +
        '<div class="md-alert-title">' + esc(title) + '</div>' +
        '<div class="md-alert-body">' + parseMarkdown(body) + '</div>' +
        '</aside>';
    }

    // Markdown parser for generated docs content.
    function parseMarkdown(md) {
      if (!md) return '';
      const source = String(md).replace(/\r\n?/g, '\n');
      const lines = source.split('\n');
      const html = [];
      let index = 0;
      const tickFence = String.fromCharCode(96).repeat(3);

      function readUntilBlank() {
        const block = [];
        while (index < lines.length && lines[index].trim()) {
          block.push(lines[index]);
          index += 1;
        }
        return block;
      }

      function renderList(ordered) {
        const items = [];
        const re = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
        while (index < lines.length && re.test(lines[index])) {
          const match = lines[index].match(re);
          let body = match ? match[1] : '';
          let checkbox = '';
          const task = body.match(/^\[( |x|X)\]\s+(.+)$/);
          if (task) {
            const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
            checkbox = '<input type="checkbox" disabled' + checked + '> ';
            body = task[2];
          }
          items.push('<li>' + checkbox + parseInlineMarkdown(body) + '</li>');
          index += 1;
        }
        return '<' + (ordered ? 'ol' : 'ul') + ' class="md-list">' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>';
      }

      function renderTable() {
        const header = lines[index].trim();
        const separator = lines[index + 1] ? lines[index + 1].trim() : '';
        if (!/^\|.*\|$/.test(header) || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
          return null;
        }

        const headers = header.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        index += 2;
        const rows = [];
        while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
          rows.push(lines[index].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
          index += 1;
        }

        return '<table class="md-table"><thead><tr>' +
          headers.map(c => '<th>' + parseInlineMarkdown(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map(row => '<tr>' + row.map(c => '<td>' + parseInlineMarkdown(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>';
      }

      function renderTabs() {
        const tabs = [];
        let current = null;
        index += 1;

        while (index < lines.length && lines[index].trim() !== '<!-- tabs:end -->') {
          const tabHeading = lines[index].trim().match(/^####\s+(.+)$/);
          if (tabHeading) {
            if (current) tabs.push(current);
            current = { title: normalizeTabTitle(tabHeading[1]), lines: [] };
            index += 1;
            continue;
          }
          if (current) {
            current.lines.push(lines[index]);
          }
          index += 1;
        }

        if (current) tabs.push(current);
        if (index < lines.length) index += 1;
        if (tabs.length === 0) return '';

        const buttons = tabs.map((tab, tabIndex) =>
          '<button type="button" class="md-tab-button' + (tabIndex === 0 ? ' active' : '') + '" data-tab-index="' + tabIndex + '">' +
            esc(tab.title || 'Tab ' + (tabIndex + 1)) +
          '</button>'
        ).join('');
        const panels = tabs.map((tab, tabIndex) =>
          '<div class="md-tab-panel' + (tabIndex === 0 ? ' active' : '') + '" data-tab-index="' + tabIndex + '">' +
            parseMarkdown(tab.lines.join('\n')) +
          '</div>'
        ).join('');

        return '<div class="md-tabs"><div class="md-tab-list" role="tablist">' + buttons + '</div>' + panels + '</div>';
      }

      while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
          index += 1;
          continue;
        }

        if (trimmed === '<!-- tabs:start -->') {
          html.push(renderTabs());
          continue;
        }

        if (trimmed.startsWith(tickFence)) {
          const lang = trimmed.slice(3).trim() || 'text';
          const code = [];
          index += 1;
          while (index < lines.length && !lines[index].trim().startsWith(tickFence)) {
            code.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          if (lang === 'mermaid') {
            html.push('<div class="mermaid">' + esc(code.join('\n')) + '</div>');
          } else {
            html.push('<div class="md-code-wrap"><button type="button" class="copy-code-btn">Copy</button><pre class="md-code-block"><code class="language-' + escapeAttr(lang) + '">' + esc(code.join('\n')) + '</code></pre></div>');
          }
          continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2].replace(/\s+#+$/, '').trim();
          const id = slugifyHeading(text);
          html.push('<h' + level + ' class="md-h' + level + '" id="' + escapeAttr(id) + '"><a class="heading-anchor" href="#' + escapeAttr(id) + '">#</a>' + parseInlineMarkdown(text) + '</h' + level + '>');
          index += 1;
          continue;
        }

        if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
          html.push('<hr class="md-hr">');
          index += 1;
          continue;
        }

        if (/^>\s?/.test(trimmed)) {
          const quote = [];
          while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
            quote.push(lines[index].trim().replace(/^>\s?/, ''));
            index += 1;
          }
          const alertHtml = renderAlertBlock(quote);
          html.push(alertHtml || '<blockquote class="md-blockquote">' + parseMarkdown(quote.join('\n')) + '</blockquote>');
          continue;
        }

        const table = renderTable();
        if (table) {
          html.push(table);
          continue;
        }

        if (/^\s*[-*+]\s+/.test(line)) {
          html.push(renderList(false));
          continue;
        }

        if (/^\s*\d+\.\s+/.test(line)) {
          html.push(renderList(true));
          continue;
        }

        const paragraph = readUntilBlank().join(' ');
        html.push('<p class="md-p">' + parseInlineMarkdown(paragraph) + '</p>');
      }

      return html.join('\n');
    }

`

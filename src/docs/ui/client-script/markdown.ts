/**
 * Embedded docs UI client script chunk.
 */

export const markdownClientScript = String.raw`    // Helper to escape text for display
    const COMMON_EMOJI_ENTITIES = {
      '+1': '&#x1F44D;',
      '-1': '&#x1F44E;',
      '100': '&#x1F4AF;',
      bug: '&#x1F41B;',
      book: '&#x1F4D6;',
      books: '&#x1F4DA;',
      bulb: '&#x1F4A1;',
      check: '&#x2705;',
      fire: '&#x1F525;',
      gear: '&#x2699;&#xFE0F;',
      grinning: '&#x1F600;',
      heart: '&#x2764;&#xFE0F;',
      info: '&#x2139;&#xFE0F;',
      joy: '&#x1F602;',
      link: '&#x1F517;',
      lock: '&#x1F512;',
      memo: '&#x1F4DD;',
      package: '&#x1F4E6;',
      pushpin: '&#x1F4CC;',
      rocket: '&#x1F680;',
      smile: '&#x1F604;',
      sparkles: '&#x2728;',
      star: '&#x2B50;',
      tada: '&#x1F389;',
      unlock: '&#x1F513;',
      warning: '&#x26A0;&#xFE0F;',
      white_check_mark: '&#x2705;',
      wrench: '&#x1F527;',
      x: '&#x274C;',
      zap: '&#x26A1;',
    };

    function esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function escapeAttr(str) {
      return esc(str).replace(/"/g, '&quot;');
    }

    function renderEmojiShorthand(value) {
      if (markdownConfig.noEmoji === true) return String(value || '');
      return String(value || '').replace(/:([a-z0-9_+-]+):/gi, function(match, name) {
        const entity = COMMON_EMOJI_ENTITIES[String(name).toLowerCase()];
        return entity ? '<span class="emoji" aria-label="' + escapeAttr(name) + '">' + entity + '</span>' : match;
      });
    }

    function getExternalLinkTarget() {
      return String(markdownConfig.externalLinkTarget || '_blank');
    }

    function getExternalLinkRel(target) {
      if (target !== '_blank') return '';
      return String(markdownConfig.externalLinkRel ?? 'noopener noreferrer');
    }

    function isNoCompileLink(href) {
      const patterns = Array.isArray(markdownConfig.noCompileLinks) ? markdownConfig.noCompileLinks : [];
      return patterns.some(function(pattern) {
        try {
          return new RegExp(String(pattern)).test(href);
        } catch {
          return false;
        }
      });
    }

    function parseMarkdownAttributes(text) {
      const attrs = { classes: [] };
      const withoutAttrs = String(text || '').replace(/:([A-Za-z-]+)(?:=([^\s:]+))?/g, function(_match, name, value) {
        const key = String(name).toLowerCase();
        if (key === 'class' && value) attrs.classes.push(value);
        if (key === 'id' && value) attrs.id = value;
        if (key === 'target' && value) attrs.target = value;
        if (key === 'disabled') attrs.disabled = true;
        if (key === 'ignore') attrs.ignore = true;
        if (key === 'no-zoom') attrs.noZoom = true;
        if (key === 'size' && value) {
          const parts = String(value).split('x');
          if (parts[0] && parts[0].endsWith('%')) attrs.widthStyle = parts[0];
          else if (parts[0]) attrs.width = parts[0];
          if (parts[1]) attrs.height = parts[1];
        }
        return '';
      }).trim();
      if (withoutAttrs) attrs.title = withoutAttrs;
      return attrs;
    }

    function parseMarkdownDestination(value) {
      const raw = String(value || '').trim()
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'");
      if (!raw) return null;
      const match = raw.match(/^(\S+)(?:\s+(['"])(.*?)\2)?$/);
      const href = match ? match[1] : raw;
      const meta = match ? (match[3] || '') : '';
      return {
        href,
        attrs: meta.startsWith(':') ? parseMarkdownAttributes(meta) : { title: meta || undefined, classes: [] }
      };
    }

    function parseComponentFence(lang, body) {
      const match = String(lang || '').match(/^(?:raffel-component|svelte-component)\s+([A-Za-z][\w.-]*)(?:\s+(.+))?$/);
      if (!match) return null;
      return {
        name: match[1],
        props: match[2] ? match[2].trim() : String(body || '').trim(),
      };
    }

    function renderMarkdownAttributeString(attrs, kind) {
      const attributes = [];
      if (attrs.title) attributes.push('title="' + escapeAttr(attrs.title) + '"');
      if (attrs.id) attributes.push('id="' + escapeAttr(attrs.id) + '"');
      if (attrs.classes && attrs.classes.length > 0) {
        const base = kind === 'image' ? 'md-image' : '';
        attributes.push('class="' + escapeAttr([base].concat(attrs.classes).filter(Boolean).join(' ')) + '"');
      }
      if (kind === 'image') {
        if (attrs.noZoom) attributes.push('data-no-zoom="true"');
        if (attrs.width) attributes.push('width="' + escapeAttr(attrs.width) + '"');
        if (attrs.height) attributes.push('height="' + escapeAttr(attrs.height) + '"');
        if (attrs.widthStyle) attributes.push('style="width:' + escapeAttr(attrs.widthStyle) + '"');
      }
      return attributes.length ? ' ' + attributes.join(' ') : '';
    }

    function parseHeadingTitle(value) {
      const withoutClosingHashes = String(value || '').replace(/\s+#+$/, '').trim();
      const ignoreAll = /\{raffel-ignore-all\}/i.test(withoutClosingHashes);
      const ignore = ignoreAll || /\{raffel-ignore\}/i.test(withoutClosingHashes);
      const withoutIgnore = withoutClosingHashes
        .replace(/<!--\s*\{raffel-ignore(?:-all)?\}\s*-->/ig, '')
        .replace(/\{raffel-ignore(?:-all)?\}/ig, '')
        .trim();
      const idMatch = withoutIgnore.match(/\s+:id=([A-Za-z0-9_-]+)\s*$/);
      const title = idMatch ? withoutIgnore.slice(0, idMatch.index).trim() : withoutIgnore;
      return { title, id: idMatch ? idMatch[1] : slugifyHeading(title), ignore, ignoreAll };
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
      const htmlTokens = [];
      const protectHtml = function(html) {
        const token = '\u0000H' + htmlTokens.length + 'H\u0000';
        htmlTokens.push(html);
        return token;
      };
      const tick = String.fromCharCode(96);
      const inlineCodeRe = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
      let text = String(value).replace(inlineCodeRe, function(_match, code) {
        const token = '\u0000C' + codeTokens.length + 'C\u0000';
        codeTokens.push('<code class="md-inline-code">' + esc(code) + '</code>');
        return token;
      });

      if (markdownConfig.html === 'raw') text = text.replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g, protectHtml);
      text = esc(text);
      text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, destination) {
        const parsed = parseMarkdownDestination(destination);
        if (!parsed || !isSafeUrl(parsed.href)) return match;
        const attrs = renderMarkdownAttributeString(parsed.attrs, 'image');
        const classAttr = parsed.attrs.classes.length > 0 ? '' : ' class="md-image"';
        return protectHtml('<img' + classAttr + ' src="' + escapeAttr(parsed.href) + '" alt="' + escapeAttr(alt) + '"' + attrs + '>');
      });
      text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, label, destination) {
        const parsed = parseMarkdownDestination(destination);
        if (!parsed || !isSafeUrl(parsed.href)) return match;
        const target = parsed.attrs.target || (/^https?:\/\//i.test(parsed.href) ? getExternalLinkTarget() : '');
        const targetAttr = target ? ' target="' + escapeAttr(target) + '"' : '';
        const rel = getExternalLinkRel(target);
        const relAttr = rel ? ' rel="' + escapeAttr(rel) + '"' : '';
        const disabledAttrs = parsed.attrs.disabled ? ' aria-disabled="true" tabindex="-1"' : '';
        const classes = parsed.attrs.disabled ? ['markdown-disabled'].concat(parsed.attrs.classes) : parsed.attrs.classes;
        const attrs = renderMarkdownAttributeString(Object.assign({}, parsed.attrs, { classes }), 'link');
        return protectHtml('<a href="' + escapeAttr(parsed.href) + '"' + targetAttr + relAttr + disabledAttrs + attrs + '>') +
          label +
          protectHtml('</a>');
      });
      text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
      text = renderEmojiShorthand(text);
      codeTokens.forEach(function(html, index) {
        text = text.replace('\u0000C' + index + 'C\u0000', html);
      });
      htmlTokens.forEach(function(html, index) {
        text = text.replace('\u0000H' + index + 'H\u0000', html);
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
      const match = first.match(/^\[!(NOTE|TIP|WARNING|DANGER|INFO|IMPORTANT|CAUTION)\]\s*(.*)$/i);
      const legacy = first.match(/^([!?])>\s*(.*)$/);
      if (!match && !legacy) return null;
      const rawKind = match ? match[1] : (legacy[1] === '?' ? 'TIP' : 'IMPORTANT');
      const kind = rawKind.toLowerCase();
      const title = (match && match[2]) || rawKind.charAt(0).toUpperCase() + rawKind.slice(1).toLowerCase();
      const body = (legacy ? [legacy[2] || ''].concat(lines.slice(1)) : lines.slice(1)).join('\n');
      return '<aside class="md-alert md-alert-' + escapeAttr(kind) + '">' +
        '<div class="md-alert-title">' + esc(title) + '</div>' +
        '<div class="md-alert-body">' + parseMarkdown(body) + '</div>' +
        '</aside>';
    }

    // Markdown parser for generated docs content.
    function parseMarkdown(md) {
      if (!md) return '';
      const pluginContext = getPluginContext();
      const source = applyStringHook('beforeMarkdown', String(md), pluginContext).replace(/\r\n?/g, '\n');
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

        if (markdownConfig.html === 'raw' && /^<\/?[A-Za-z][^>]*>$/.test(trimmed)) {
          html.push(readUntilBlank().join('\n'));
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
          const component = parseComponentFence(lang, code.join('\n'));
          if (component) {
            html.push('<div class="docs-component-mount svelte-component-mount" data-raffel-component="' + escapeAttr(component.name) + '" data-props="' + escapeAttr(component.props) + '"></div>');
          } else if (lang === 'mermaid') {
            html.push('<div class="mermaid" data-mermaid-source="' + escapeAttr(code.join('\n')) + '">' + esc(code.join('\n')) + '</div>');
          } else {
            html.push('<div class="md-code-wrap"><button type="button" class="copy-code-btn">Copy</button><pre class="md-code-block"><code class="language-' + escapeAttr(lang) + '">' + esc(code.join('\n')) + '</code></pre></div>');
          }
          continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          const parsedHeading = parseHeadingTitle(heading[2]);
          const ignoreAttrs = (parsedHeading.ignore ? ' data-markdown-ignore="true"' : '') +
            (parsedHeading.ignoreAll ? ' data-markdown-ignore-all="true"' : '');
          html.push('<h' + level + ' class="md-h' + level + '" id="' + escapeAttr(parsedHeading.id) + '"' + ignoreAttrs + '><a class="heading-anchor" href="#' + escapeAttr(parsedHeading.id) + '">#</a>' + parseInlineMarkdown(parsedHeading.title) + '</h' + level + '>');
          index += 1;
          continue;
        }

        if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
          html.push('<hr class="md-hr">');
          index += 1;
          continue;
        }

        if (/^[!?]>\s?/.test(trimmed)) {
          const alertHtml = renderAlertBlock([trimmed]);
          if (alertHtml) html.push(alertHtml);
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

      return applyStringHook('afterMarkdown', html.join('\n'), pluginContext);
    }

`

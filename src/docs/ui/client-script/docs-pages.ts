/**
 * Embedded docs UI client script chunk.
 */

export const docsPagesClientScript = String.raw`    function parsePageFrontmatter(markdown) {
      const source = String(markdown || '').replace(/\r\n?/g, '\n');
      if (!source.startsWith('---\n')) {
        return { data: {}, body: source };
      }

      const end = source.indexOf('\n---', 4);
      if (end === -1) {
        return { data: {}, body: source };
      }

      const data = {};
      const header = source.slice(4, end).split('\n');
      header.forEach(line => {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match) return;
        const key = match[1];
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        data[key] = value;
      });

      const bodyStart = source.indexOf('\n', end + 4);
      return {
        data,
        body: bodyStart === -1 ? '' : source.slice(bodyStart + 1),
      };
    }

    function firstMarkdownHeading(markdown) {
      const match = String(markdown || '').match(/^#\s+(.+)$/m);
      return match ? match[1].replace(/\s+#+$/, '').trim() : '';
    }

    function resolveDocsAlias(path) {
      let current = normalizeDocsPath(path);
      const seen = new Set();
      for (let depth = 0; depth < 10; depth += 1) {
        const next = resolveDocsAliasTarget(current);
        if (!next || seen.has(next)) return current;
        seen.add(current);
        current = normalizeDocsPath(next);
      }
      return current;
    }

    function resolveDocsAliasTarget(path) {
      if (docsAliases[path]) return docsAliases[path];
      for (const [pattern, target] of Object.entries(docsAliases)) {
        if (!/[()*+?[\\\]^$|]/.test(pattern)) continue;
        try {
          const expression = new RegExp(pattern.startsWith('^') ? pattern : '^' + pattern + '$');
          const match = path.match(expression);
          if (!match) continue;
          return String(target).replace(/\$(\d+)/g, function(_token, index) {
            return match[Number(index)] || '';
          });
        } catch {
          continue;
        }
      }
      return '';
    }

    function getDocsPageView(page) {
      const parsed = parsePageFrontmatter(page.markdown || '');
      const title = parsed.data.title || page.title || firstMarkdownHeading(parsed.body) || page.path || 'Untitled';
      const description = parsed.data.description || page.description || '';
      const order = Number(parsed.data.order ?? page.order ?? 0);
      const section = parsed.data.section || page.section || 'Guides';
      return {
        ...page,
        title,
        description,
        order: Number.isFinite(order) ? order : 0,
        section,
        updatedAt: parsed.data.updatedAt || page.updatedAt,
        markdown: parsed.body,
        frontmatter: parsed.data,
      };
    }

    function getDocsPageViews() {
      if (!Array.isArray(docsPages)) return [];
      return docsPages
        .map(getDocsPageView)
        .sort((a, b) =>
          String(a.section || '').localeCompare(String(b.section || '')) ||
          (a.order || 0) - (b.order || 0) ||
          String(a.title || '').localeCompare(String(b.title || ''))
        );
    }

    function getDocsPageMarkdown(page) {
      const markdown = renderUpdatedMarker(page.markdown || '', page.updatedAt);
      if (markdownConfig.autoHeader !== true || /^#\s+.+$/m.test(markdown)) return markdown;
      return '# ' + (page.title || page.path || 'Untitled') + '\n\n' + markdown;
    }

    function renderUpdatedMarker(markdown, updatedAt) {
      if (!String(markdown || '').includes('{raffel-updated}')) return markdown;
      return String(markdown || '').replace(/\{raffel-updated\}/g, formatDocsUpdated(updatedAt));
    }

    function formatDocsUpdated(updatedAt) {
      if (!updatedAt) return '';
      const date = new Date(updatedAt);
      if (Number.isNaN(date.getTime())) return '';
      const pad = value => String(value).padStart(2, '0');
      const tokens = {
        YYYY: String(date.getUTCFullYear()),
        MM: pad(date.getUTCMonth() + 1),
        DD: pad(date.getUTCDate()),
        HH: pad(date.getUTCHours()),
        mm: pad(date.getUTCMinutes()),
        ss: pad(date.getUTCSeconds()),
      };
      const format = String(markdownConfig.formatUpdated || 'YYYY-MM-DD');
      return format.replace(/YYYY|MM|DD|HH|mm|ss/g, token => tokens[token] || token);
    }

    function getSidebarSubMaxLevel() {
      const max = Number(sidebarConfig.subMaxLevel || 0);
      return Number.isFinite(max) && max > 1 ? Math.floor(max) : 0;
    }

    function extractSidebarHeadings(markdown) {
      const max = getSidebarSubMaxLevel();
      if (!max) return [];
      const headings = [];
      String(markdown || '').split(/\r?\n/).forEach(line => {
        const heading = line.trim().match(/^(#{1,6})\s+(.+)$/);
        if (!heading) return;
        const level = heading[1].length;
        const parsed = parseHeadingTitle(heading[2]);
        if (parsed.ignoreAll) {
          headings.length = 0;
          headings.ignoreAll = true;
          return;
        }
        if (headings.ignoreAll || level < 2 || level > max || parsed.ignore) return;
        headings.push({ id: parsed.id, title: parsed.title, level });
      });
      return headings.ignoreAll ? [] : headings;
    }

`

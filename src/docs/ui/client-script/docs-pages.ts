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

`

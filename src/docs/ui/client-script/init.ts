/**
 * Embedded docs UI client script chunk.
 */

export const initClientScript = String.raw`    // Render introduction markdown if provided
    // Note: introductionMarkdown is server-generated trusted content from USD spec
    // parseMarkdown() escapes text before processing markdown syntax
    function renderIntroduction() {
      const container = document.getElementById('introductionContent');
      if (!container || !introductionMarkdown) return;
      container.innerHTML = parseMarkdown(introductionMarkdown);
    }

    document.addEventListener('click', (event) => {
      const copyButton = event.target.closest('.copy-code-btn');
      if (!copyButton) return;
      const wrap = copyButton.closest('.md-code-wrap');
      const code = wrap ? wrap.querySelector('code') : null;
      if (!code) return;
      const text = code.textContent || '';
      const markCopied = () => {
        const previous = copyButton.textContent;
        copyButton.textContent = 'Copied';
        setTimeout(() => {
          copyButton.textContent = previous || 'Copy';
        }, 1500);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(markCopied).catch(() => {});
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        markCopied();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const search = document.getElementById('searchInput');
        if (search && document.activeElement !== search) {
          event.preventDefault();
          search.focus();
        }
      }
    });

    // Initial render
    renderIntroduction();
    renderFooter();
    renderProtocolTabs();
    renderSidebar();
    renderContent();
`

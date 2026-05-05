/**
 * Embedded docs UI client script chunk.
 */

export const initClientScript = "    // Render introduction markdown if provided\n    // Note: introductionMarkdown is server-generated trusted content from USD spec\n    // parseMarkdown() escapes text before processing markdown syntax\n    function renderIntroduction() {\n      const container = document.getElementById('introductionContent');\n      if (!container || !introductionMarkdown) return;\n      container.innerHTML = parseMarkdown(introductionMarkdown);\n    }\n\n    // Initial render\n    renderIntroduction();\n    renderProtocolTabs();\n    renderSidebar();\n    renderContent();\n"

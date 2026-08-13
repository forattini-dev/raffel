export const projectionDiagnosticStyles = `
  .projection-diagnostic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }

  .projection-diagnostic {
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: 5px;
    padding: 9px 10px;
    background: var(--surface-color);
    font-size: var(--font-size-xs);
  }

  .projection-preserved { border-left-color: #10b981; }
  .projection-adapted { border-left-color: #f59e0b; }
  .projection-unsupported { border-left-color: #ef4444; }

  .projection-diagnostic-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .projection-diagnostic-heading span {
    font-family: var(--font-mono);
    text-transform: uppercase;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  .projection-diagnostic-details,
  .projection-diagnostic-reason {
    color: var(--text-secondary);
    line-height: 1.35;
  }

  .projection-diagnostic-reason { margin-top: 5px; }
`

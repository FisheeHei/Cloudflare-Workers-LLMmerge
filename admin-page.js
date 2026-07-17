export function renderAdminPage(origin, version) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Gateway</title>
${renderAdminStyle()}${renderAdminMarkup(origin, version)}${renderAdminScript(version)}
</body>
</html>`;
}

function renderAdminStyle() {
  return `  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d7c7aa;
      --accent: #a54d2d;
      --accent-2: #2f6f5e;
      --bg-raised: #fff9ef;
      --fg: #1f2937;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, rgba(165,77,45,.18), transparent 28%),
                  linear-gradient(180deg, #efe5d2 0%, var(--bg) 42%, #f8f4ec 100%);
      color: var(--ink);
      font: 15px/1.5 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    }
    html, body { overflow-x: hidden; }
    .wrap { width: min(960px, calc(100vw - 24px)); margin: 0 auto; padding: 24px 0 48px; }

    .hero, .panel {
      background: rgba(255,253,248,.94);
      border: 1px solid var(--line);
      box-shadow: 0 18px 40px rgba(38,28,18,.08);
      backdrop-filter: blur(8px);
      margin-bottom: 18px;
    }
    .hero { padding: 24px; }
    .hero h1 { margin: 0 0 10px; font: 700 30px/1.15 Georgia, serif; }
    .hero-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero code {
      background: #f2e7d3; padding: 4px 10px; border-radius: 8px;
      font-size: 14px; word-break: break-all;
    }
    .gateway-urls { margin-top: 12px; }
    .url-card {
      border: 1px solid var(--line);
      background: rgba(255,253,248,.7); border-radius: 14px; padding: 14px;
      max-width: 520px; overflow: hidden;
    }
    .url-card .url-card-head { font-weight: 600; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .url-card code { display: block; margin-bottom: 8px; }
    .url-card button { margin-right: 6px; }
    .panel { padding: 20px; }
    .panel h2 { margin: 0 0 14px; font: 700 20px/1.2 Georgia, serif; }

    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .toolbar h2 { margin: 0; }
    .toolbar > * { min-width: 0; }
    .toolbar-spacer { flex: 1; }
    .menu-wrap { position: relative; }
    .menu {
      position: absolute; right: 0; top: calc(100% + 6px); z-index: 20;
      display: none; min-width: 150px; max-height: min(52vh, 320px); overflow-y: auto; padding: 6px;
      background: #fffdfa; border: 1px solid #cfbea0; border-radius: 12px;
      box-shadow: 0 12px 24px rgba(38,28,18,.12);
      overscroll-behavior: contain;
    }
    .menu-wrap.open .menu { display: grid; gap: 4px; }
    .menu button { width: 100%; text-align: left; border-radius: 8px; }

    button {
      border: 0; border-radius: 999px; padding: 9px 16px;
      font: 600 13px/1.1 inherit; cursor: pointer;
      background: var(--accent); color: white;
      transition: transform .16s,opacity .16s;
    }
    button:hover { filter: brightness(1.06); }
    button:active { transform: translateY(1px); }
    button[disabled] { opacity: .55; cursor: wait; }
    button.small { padding: 6px 12px; font-size: 12px; }
    button.secondary { background: #eadcc5; color: #3a2b1f; }
    button.good { background: var(--accent-2); }
    button.danger { background: #8d2f23; }

    input, textarea, select {
      width: 100%; border: 1px solid #cdbda2; background: #fffdfa;
      color: var(--ink); border-radius: 10px; padding: 9px 12px; font: inherit;
    }
    textarea { min-height: 72px; resize: vertical; }
    .note { color: var(--muted); font-size: 13px; }
    .mono { font-family: "Cascadia Code","Fira Code",Consolas,monospace; font-size: 13px; }

    .row { display: grid; gap: 12px; grid-template-columns: repeat(12, 1fr); margin-bottom: 10px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field label { color: var(--muted); font-size: 13px; }
    .span-12 { grid-column: span 12; }
    .span-6 { grid-column: span 6; }
    .span-4 { grid-column: span 4; }
    .span-3 { grid-column: span 3; }

    .upstream-card {
      border: 1px solid #cfbea0; background: #fff9ef;
      border-radius: 16px; margin-bottom: 10px; overflow: hidden;
    }
    .upstream-group {
      border: 1px solid #cfbea0; border-radius: 14px; background: #fffdf8;
      margin-bottom: 12px; overflow: hidden;
    }
    .upstream-group > summary {
      cursor: pointer; list-style: none; user-select: none;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 14px; background: #eadcc5; color: #3a2b1f; font-weight: 700;
    }
    .upstream-group-active { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
    .upstream-group > summary::-webkit-details-marker { display: none; }
    .upstream-group-body { padding: 10px; }
    .upstream-group-body .upstream-card:last-child { margin-bottom: 0; }
    .upstream-card.disabled { background: #f4efe7; border-color: #d8cbb8; opacity: .82; }
    .upstream-card summary {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 14px 16px; cursor: pointer; user-select: none;
      list-style: none;
    }
    .upstream-card summary::-webkit-details-marker { display: none; }
    .upstream-card summary::before {
      content: "\u25B6"; font-size: 10px; color: var(--muted);
      transition: transform .2s ease; flex-shrink: 0;
    }
    .upstream-card[open] summary::before { transform: rotate(90deg); }
    .upstream-card summary .card-badge {
      background: #eadcc5; color: #3a2b1f; padding: 3px 10px;
      border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap;
    }
    .upstream-status-emoji { width: 22px; text-align: center; font-size: 16px; line-height: 1; }
    .upstream-card summary strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .health-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      background: #d1d5db; transition: background .3s ease;
    }
    .health-dot.ok { background: #22c55e; }
    .health-dot.fail { background: #ef4444; }
    .health-dot.checking { background: #f59e0b; animation: pulse .6s ease infinite alternate; }
    @keyframes pulse { to { opacity: .4; } }
    .capability-badge {
      background: #e0d5c0; color: #3a2b1f; padding: 2px 8px;
      border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .upstream-card summary .card-meta { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .upstream-enable-toggle { padding: 5px 9px; }
    .nim-rpm-timer[hidden] { display: none; }
    .upstream-card .card-body { padding: 0 16px 14px; }
    .model-entry-list { display: grid; gap: 6px; margin-top: 4px; }
    .model-entry {
      display: grid; grid-template-columns: minmax(0, 1fr) 90px auto;
      gap: 6px; align-items: center; padding: 6px;
      border: 1px solid #eadcc5; border-radius: 8px; background: #fffdfa;
    }
    .model-entry input { padding: 7px 9px; }
    .model-entry .model-context-input { text-align: center; }
    .model-entry-empty { padding: 8px; border: 1px dashed #cfbea0; border-radius: 8px; }

    .client-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 14px; border: 1px solid #cfbea0;
      background: #fff9ef; border-radius: 12px; margin-bottom: 8px;
    }
    .client-item .client-meta { flex: 1; min-width: 0; }
    .client-item .client-meta strong { display: block; }
    .client-item .client-meta .mono { color: var(--muted); word-break: break-all; }
    .client-create { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
    .client-create input { flex: 1; min-width: 160px; }
    .client-models-input { min-width: min(360px, 100%); }
    .client-model-editor { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
    .client-model-editor input { flex: 1 1 320px; min-width: 180px; }

    .key-output {
      margin-top: 12px; padding: 14px; background: #f2e7d3;
      border-radius: 12px; border: 1px solid #cfbea0;
    }
    .key-output pre {
      margin: 0 0 8px; font-size: 13px; word-break: break-all; white-space: pre-wrap;
      font-family: "Cascadia Code","Fira Code",Consolas,monospace;
    }
    .key-output .key-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    .settings-panel summary {
      cursor: pointer; user-select: none; list-style: none;
      display: flex; align-items: center; gap: 8px;
    }
    .settings-panel summary::-webkit-details-marker { display: none; }
    .settings-panel summary::before {
      content: "\u25B6"; font-size: 10px; color: var(--muted);
      transition: transform .2s ease;
    }
    .settings-panel[open] summary::before { transform: rotate(90deg); }
    .settings-panel summary h2 { margin: 0; }
    .settings-body { padding-top: 14px; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(33,24,15,.55);
      display: none; align-items: center; justify-content: center;
      padding: 16px; z-index: 50;
    }
    .modal-backdrop.open { display: flex; }
    .modal-card {
      width: min(680px, 100%); max-height: calc(100vh - 32px); overflow: auto;
      background: #fffaf2; border: 1px solid #cfbea0;
      border-radius: 24px; padding: 20px; box-shadow: 0 26px 60px rgba(0,0,0,.18);
    }
    .modal-card h3 { margin: 0 0 14px; font: 700 18px/1.2 Georgia, serif; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
    .system-prompt-textarea { min-height: min(30vh, 320px); font-family: "Cascadia Code","Fira Code",Consolas,monospace; }
    .context-prompt-textarea { min-height: min(38vh, 440px); font-family: "Cascadia Code","Fira Code",Consolas,monospace; }
    .prompt-splitter-textarea { min-height: min(66vh, 680px); font-family: "Cascadia Code","Fira Code",Consolas,monospace; }
    .prompt-modal-grid { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.25fr) minmax(300px, .85fr); gap: 14px; align-items: start; }
    .prompt-modal-card { width: min(1560px, calc(100vw - 12px)); }
    .prompt-main-column { display: grid; gap: 12px; }
    .prompt-scope-column { display: grid; gap: 12px; align-content: start; }
    .prompt-client-scope { border: 1px solid #eadcc5; border-radius: 8px; background: #fffdfa; padding: 8px; max-height: 220px; overflow: auto; display: flex; gap: 6px; flex-wrap: wrap; align-content: flex-start; }
    .prompt-client-scope label { display: inline-flex; max-width: 100%; align-items: center; border: 1px solid #cfbea0; border-radius: 999px; padding: 5px 8px; font-size: 12px; margin: 0; color: var(--ink); line-height: 1.2; cursor: pointer; background: #fffdfa; }
    .prompt-client-scope label.active { background: #1f8f61; border-color: #1f8f61; color: #fff; }
    .prompt-client-scope input { position: absolute; opacity: 0; pointer-events: none; }
    .prompt-client-scope span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .prompt-splitter-row { display: grid; gap: 10px; align-items: start; }
    .context-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
    .context-controls input[type="number"] { width: 84px; }
    .context-items { display: grid; gap: 8px; max-height: 340px; overflow: auto; padding-right: 2px; }
    .context-item { border: 1px solid #eadcc5; border-radius: 8px; background: #fffdfa; padding: 8px; display: grid; gap: 6px; }
    .context-item-head { display: grid; grid-template-columns: 18px minmax(0, 1fr) 88px auto; gap: 6px; align-items: center; }
    .context-item-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .context-item textarea { min-height: 76px; font-family: "Cascadia Code","Fira Code",Consolas,monospace; }
    .model-picker-backdrop { z-index: 80; }
    .model-picker-card { width: min(1216px, calc(100vw - 48px)); }
    .picker-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .picker-head h3 { margin: 0; }
    .model-picker-grid {
      display: grid; grid-template-columns: 220px 260px minmax(0, 1fr); gap: 12px;
      min-height: min(68vh, 722px);
    }
    .model-picker-groups, .model-picker-subgroups, .model-picker-list {
      border: 1px solid #cfbea0; border-radius: 8px; background: #fffdfa;
      overflow: auto; max-height: min(68vh, 722px);
    }
    .model-picker-groups, .model-picker-subgroups { padding: 8px; }
    .model-group-btn {
      width: 100%; display: flex; justify-content: space-between; gap: 8px;
      border-radius: 8px; padding: 8px 10px; margin-bottom: 4px;
      background: transparent; color: var(--ink); text-align: left;
    }
    .model-group-btn.active { background: #eadcc5; }
    .model-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 0; border-bottom: 1px solid #f1e6d6; background: transparent; color: var(--ink); text-align: left; font-size: 13px; }
    .model-row:last-child { border-bottom: 0; }
    .model-row input { width: auto; }
    .model-row.active { background: #f2e7d3; }
    .model-row .mono { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; justify-content: flex-end; }
    .model-tag { border: 1px solid #cfbea0; border-radius: 999px; padding: 1px 6px; color: var(--muted); font-size: 11px; white-space: nowrap; background: #fffdfa; }
    .model-tag-filter { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .model-tag-filter button { padding: 5px 8px; font-size: 12px; }
    .model-tag-filter button.active { background: #1f8f61; color: white; }
    .picker-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; flex-wrap: wrap; margin-top: 14px; }
    .picker-actions button.small { padding: 7px 13px; font-size: 13px; }
    @media (max-width: 760px) {
      .prompt-modal-grid { grid-template-columns: 1fr; }
      .prompt-client-scope { max-height: 130px; }
      .model-picker-grid { grid-template-columns: 1fr; }
      .model-picker-groups, .model-picker-subgroups { max-height: 150px; }
      .model-row { align-items: flex-start; flex-wrap: wrap; }
      .model-tags { margin-left: 26px; justify-content: flex-start; }
      .model-entry { grid-template-columns: 1fr; }
    }

    #toast {
      position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
      background: #1f2937; color: #f9fafb; padding: 12px 28px;
      border-radius: 999px; font-size: 14px; font-weight: 600;
      opacity: 0; pointer-events: none;
      transition: opacity .25s ease, transform .25s ease;
      z-index: 100;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(-6px); }
    #log-list { max-width: 100%; overflow-x: auto; }
    .log-table { width: 100%; min-width: 780px; border-collapse: collapse; font-size: 13px; }
    .log-table th, .log-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--line); }
    .log-table th { color: var(--muted); font-weight: 600; font-size: 12px; }
    .log-table .ok { color: var(--accent-2); }
    .log-table .err { color: #8d2f23; }
    .log-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
    .log-filter { padding: 5px 9px; font-size: 12px; }
    .log-filter.active { background: #1f8f61; color: #fff; }
    .chart-bar { display: flex; align-items: stretch; gap: 2px; height: 110px; padding: 4px 0; border-bottom: 1px solid var(--line); margin-bottom: 10px; }
    .chart-bar .bar-hit { flex: 1; min-width: 8px; display: flex; align-items: flex-end; position: relative; cursor: default; }
    .chart-bar .bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; position: relative; pointer-events: none; }
    .chart-bar .bar.fail { background: #8d2f23; }
    .chart-bar .bar-hit::after { content: attr(data-h); display: none; position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%); font-size: 9px; color: var(--muted); }
    .chart-bar .bar-hit:nth-child(6n)::after { display: block; }
    .chart-label { font-size: 12px; font-weight: 600; color: var(--muted); margin: 8px 0 2px; } .chart-label:first-of-type { margin-top: 0; }
    .stat-tip {
      position: fixed; z-index: 120; width: min(260px, calc(100vw - 24px)); max-height: 260px; overflow: auto;
      padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--panel); box-shadow: 0 12px 28px #00000022; pointer-events: none;
      font-size: 12px; line-height: 1.35;
    }
    .stat-tip[hidden] { display: none; }
    .stat-tip-title { font-weight: 700; color: var(--fg); margin-bottom: 6px; }
    .stat-tip-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 2px 0; }
    .stat-tip-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stat-tip-value { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .stats-grid-2col { grid-template-columns: repeat(2, 1fr); }
    .stat-box { background: var(--bg-raised); border-radius: 8px; padding: 10px 12px; text-align: center; }
    .stat-num { display: block; font-size: 22px; font-weight: 700; color: var(--fg); }
    .stat-label { font-size: 11px; color: var(--muted); }
    .live-log { max-height: 200px; overflow-y: auto; }
    .log-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .log-badge { display: inline-block; width: 28px; text-align: center; border-radius: 4px; font-size: 11px; font-weight: 700; padding: 2px 0; }
    .log-badge.ok { background: #065f4620; color: var(--accent-2); }
    .log-badge.err { background: #8d2f2320; color: #8d2f23; }
    @media (max-width: 700px) {
      .wrap { width: min(100%, calc(100vw - 12px)); padding: 8px 0 28px; }
      .hero, .panel { margin-bottom: 10px; }
      .hero, .panel, .modal-card { padding: 14px; }
      .hero h1 { font-size: 24px; }
      .url-card { max-width: 100%; }
      .toolbar { align-items: stretch; }
      .toolbar h2 { flex-basis: 100%; }
      .toolbar-spacer { display: none; }
      .menu-wrap { position: static; width: 100%; }
      .menu-wrap > button { width: 100%; }
      .menu { position: static; width: 100%; margin-top: 6px; box-shadow: none; }
      .row { grid-template-columns: 1fr; }
      .span-3, .span-4, .span-6, .span-12 { grid-column: 1; }
      .stats-grid, .stats-grid-2col { grid-template-columns: 1fr; }
      .upstream-card summary { align-items: flex-start; gap: 8px; }
      .upstream-card summary strong { flex-basis: calc(100% - 32px); white-space: normal; }
      .upstream-card summary .card-meta { white-space: normal; }
      .upstream-card .card-body { padding: 0 12px 12px; }
      .client-item, .live-log .log-row { align-items: flex-start; flex-wrap: wrap; }
      .client-create input { flex-basis: 100%; }
      .chart-bar .bar-hit { min-width: 0; }
      .chart-bar .bar-hit::after { display: none; }
      .chart-bar .bar-hit:nth-child(8n)::after { display: block; }
      .stat-tip { max-height: 220px; }
      .modal-backdrop { align-items: stretch; }
      .modal-card { width: 100%; border-radius: 14px; }
      .prompt-edit-grid, .prompt-splitter-row { grid-template-columns: 1fr; }
      .picker-actions { justify-content: stretch; }
      .picker-actions button, .picker-actions label { flex: 1 1 140px; }
    }
  </style>`;
}

function renderAdminMarkup(origin, version) {
  return `
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>LLM Gateway</h1>
    <div class="gateway-urls">
      <div class="url-card">
        <div class="url-card-head">Gateway URL <span class="note">(OpenAI + Claude Compatible)</span></div>
        <code id="gateway-url-pill">${origin}/v1</code>
        <button class="small secondary" id="copy-gateway-url">\u590d\u5236</button>
      </div>
    </div>
  </div>

  <div class="panel" id="stats-panel">
    <div class="toolbar">
      <h2>统计</h2>
      <span class="note" id="stat-current-model"></span>
      <span class="note" id="stat-updated"></span>
      <button class="small secondary" id="load-stats">加载统计</button>
    </div>
    <div class="chart-label">请求量</div>
    <div class="chart-bar" id="chart-requests"></div>
    <div class="stats-grid">
      <div class="stat-box"><span class="stat-num" id="stat-total">-</span><span class="stat-label">24h 请求</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-success">-</span><span class="stat-label">成功</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-fail">-</span><span class="stat-label">失败</span></div>
    </div>
    <div class="chart-label">Tokens</div>
    <div class="chart-bar" id="chart-tokens"></div>
    <div class="stats-grid stats-grid-2col">
      <div class="stat-box"><span class="stat-num" id="stat-pt">-</span><span class="stat-label">Input</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-ct">-</span><span class="stat-label">Output</span></div>
    </div>
    <div class="stats-grid stats-grid-2col" style="margin-top:4px">
      <div class="stat-box"><span class="stat-num" id="stat-pt-session">0</span><span class="stat-label">会话 Input</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-ct-session">0</span><span class="stat-label">会话 Output</span></div>
    </div>
  </div>

  <div class="panel">
    <h2>\u5ba2\u6237\u7aef Keys</h2>
    <p class="note" style="margin:4px 0 8px;font-size:12px">\u6bcf\u4e2a Key \u53ea\u80fd\u8c03\u7528\u201c\u5141\u8bb8\u6a21\u578b\u201d\u4e2d\u7684\u6a21\u578b\uff1b\u7559\u7a7a\u6216\u586b * \u8868\u793a\u4e0d\u9650\u5236\u3002</p>
    <div id="client-list"></div>
    <div class="client-create">
      <input id="client-name" placeholder="\u540d\u79f0 (\u53ef\u9009)">
      <input id="client-models" class="client-models-input mono" placeholder="\u5141\u8bb8\u6a21\u578b\uff0c\u9017\u53f7\u5206\u9694\uff1a z-ai/glm-5.2">
      <button class="good" id="create-client">\u751f\u6210 Key</button>
      <button class="small secondary" id="refresh-client-key" hidden>\u5237\u65b0</button>
    </div>
    <div class="key-output" id="client-output" hidden>
      <pre id="client-output-text" class="mono"></pre>
      <div class="key-actions">
        <button class="small good" id="copy-client-key">\u590d\u5236 Key</button>
        <button class="small secondary" id="copy-client-json">\u590d\u5236 JSON</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <h2>\u4e0a\u6e38\u914d\u7f6e</h2>
      <button id="open-vendor-modal">+ \u6dfb\u52a0\u4e0a\u6e38</button>
      <button class="good" id="save-config">\u4fdd\u5b58\u914d\u7f6e</button>
      <button type="button" class="secondary" id="export-upstreams">\u5bfc\u51fa\u914d\u7f6e</button>
      <button type="button" class="secondary" id="import-upstreams">\u5bfc\u5165\u914d\u7f6e</button>
      <button type="button" class="secondary" id="check-health">\u68c0\u67e5\u5065\u5eb7\u5ea6</button>
      <span class="toolbar-spacer"></span>
      <div class="menu-wrap" id="upstream-actions">
        <button type="button" class="secondary" id="upstream-actions-toggle">\u66f4\u591a\u64cd\u4f5c</button>
        <div class="menu">
          <button type="button" class="secondary small" id="refresh-models">\u5237\u65b0\u6a21\u578b\u7f13\u5b58</button>
          <button type="button" class="secondary small" id="speed-test">\u6a21\u578b\u6d4b\u901f</button>
        </div>
      </div>
      <span class="note" id="config-status"></span>
    </div>
    <div id="upstream-list"></div>
    <input type="file" id="import-upstreams-file" accept=".json,application/json" hidden>
  </div>

  <div class="panel" id="log-panel">
    <div class="toolbar">
      <h2>\u8c03\u7528\u65e5\u5fd7</h2>
      <button class="small secondary" id="refresh-logs">\u5237\u65b0</button>
      <span class="note" id="token-total"></span>
    </div>
    <div id="log-list"><div class="note">\u52a0\u8f7d\u4e2d...</div></div>
  </div>


  <details class="panel settings-panel">
    <summary><h2>\u9ad8\u7ea7\u8bbe\u7f6e</h2></summary>
    <div class="settings-body">
      <div class="row">
        <div class="field span-3"><label>\u8bf7\u6c42\u8d85\u65f6 (ms, \u9ed8\u8ba4180000)</label><input id="request-timeout" type="number" min="1000" placeholder="180000"></div>
        <div class="field span-3"><label>\u6d41\u5f0f\u7a7a\u95f2\u8d85\u65f6 (ms, \u9ed8\u8ba4900000)</label><input id="stream-idle-timeout" type="number" min="1000" placeholder="900000"></div>
        <div class="field span-3"><label>\u51b7\u5374 TTL (s, \u9ed8\u8ba460)</label><input id="cooldown-ttl" type="number" min="1" placeholder="60"></div>
        <div class="field span-3"><label>\u6a21\u578b\u7f13\u5b58 TTL (s, \u9ed8\u8ba43600)</label><input id="model-cache-ttl" type="number" min="1" placeholder="3600"></div>
      </div>
      <div class="row">
        <div class="field span-3">
          <label><input type="checkbox" id="routing-load-balance"> \u8d1f\u8f7d\u5747\u8861 (\u9ed8\u8ba4\u5f00)</label>
        </div>
        <div class="field span-3">
          <label><input type="checkbox" id="routing-failover"> \u6545\u969c\u8f6c\u79fb (\u9ed8\u8ba4\u5f00)</label>
        </div>
        <div class="field span-3">
          <label><input type="checkbox" id="routing-hedge"> Hedged Request</label>
        </div>
        <div class="field span-3">
          <label><input type="checkbox" id="routing-fast"> Gateway Fast \u6a21\u5f0f <span class="note">\u62a2\u9996\u5305\uff1b\u4e0e Hedged \u540c\u5f00\u65f6\uff0cHedged \u51b3\u5b9a\u5019\u9009\u6570\uff0cFast \u52a0\u901f\u524d 2 \u4e2a</span></label>
        </div>
      </div>
      <div class="row">
        <div class="field span-3"><label>\u6700\u9ad8\u8bf7\u6c42\u4e0a\u6e38\u6570</label><input id="routing-hedge-max" type="number" min="1" max="5" placeholder="2"></div>
      </div>
      <div class="row">
        <div class="field span-12"><label>\u7cfb\u7edf\u63d0\u793a\u8bcd / \u5168\u5c40\u4e0a\u4e0b\u6587</label><button type="button" class="secondary small" id="open-system-prompt-modal">\u7f16\u8f91\u63d0\u793a\u8bcd\u4e0e\u4e0a\u4e0b\u6587</button><span class="note" id="system-prompt-status"></span></div>
      </div>
      <button class="good small" id="save-settings">\u4fdd\u5b58\u8bbe\u7f6e</button>
      <span class="note" id="settings-status"></span>
    </div>
  </details>

  <div class="panel">
    <div class="toolbar">
      <h2>请求日志</h2>
      <button class="small secondary" id="load-logs">刷新</button>
    </div>
    <div class="live-log" id="live-log"></div>
  </div>

  <footer style="text-align:center;padding:24px 0;color:var(--muted);font-size:13px;">
    ${version} ·
    <a href="https://github.com/FisheeHei/Cloudflare-Workers-LLMmerge" style="color:var(--accent);">FisheeHei/Cloudflare-Workers-LLMmerge</a>
    · by FisheeHei
  </footer>
</div>

<div id="toast"></div>
<div class="stat-tip" id="stat-tip" hidden></div>

<div class="modal-backdrop model-picker-backdrop" id="model-picker-modal">
  <div class="modal-card model-picker-card">
    <div class="picker-head">
      <h3 id="model-picker-title">\u9009\u62e9\u6a21\u578b</h3>
      <button type="button" class="secondary small" id="model-picker-close">\u5173\u95ed</button>
    </div>
    <input id="model-picker-search" placeholder="\u641c\u7d22\u6a21\u578b">
    <div class="model-tag-filter" id="model-tag-filter"></div>
    <div class="model-picker-grid" style="margin-top:12px">
      <div class="model-picker-groups" id="model-picker-groups"></div>
      <div class="model-picker-subgroups" id="model-picker-subgroups"></div>
      <div class="model-picker-list" id="model-picker-list"></div>
    </div>
    <div class="picker-actions">
      <span class="note" id="picker-count">\u5df2\u9009 0</span>
      <label class="note" id="picker-same-preset-wrap" hidden><input type="checkbox" id="picker-apply-same-preset"> \u5e94\u7528\u5230\u540c\u7c7b\u578b\u5168\u90e8\u4e0a\u6e38</label>
      <button type="button" class="small secondary" id="picker-select-visible">\u9009\u4e2d\u5f53\u524d</button>
      <button type="button" class="small secondary" id="picker-clear-visible">\u6e05\u7a7a\u5f53\u524d</button>
      <button type="button" class="small secondary" id="picker-cancel">\u53d6\u6d88</button>
      <button type="button" class="small good" id="picker-apply">\u5e94\u7528</button>
    </div>
  </div>
</div>
<div class="modal-backdrop model-picker-backdrop" id="speed-picker-modal">
  <div class="modal-card model-picker-card">
    <div class="picker-head">
      <h3>\u6a21\u578b\u6d4b\u901f</h3>
      <button type="button" class="secondary small" id="speed-picker-close">\u5173\u95ed</button>
    </div>
    <input id="speed-picker-search" placeholder="\u641c\u7d22\u6a21\u578b">
    <div class="model-picker-grid" style="margin-top:12px">
      <div class="model-picker-groups" id="speed-picker-upstreams"></div>
      <div class="model-picker-subgroups" id="speed-picker-groups"></div>
      <div class="model-picker-list" id="speed-picker-models"></div>
    </div>
    <div class="picker-actions">
      <span class="note" id="speed-picker-status"></span>
      <button type="button" class="small secondary" id="speed-picker-cancel">\u53d6\u6d88</button>
      <button type="button" class="small good" id="speed-picker-run">\u5f00\u59cb\u6d4b\u901f</button>
    </div>
  </div>
</div>
<div class="modal-backdrop" id="vendor-modal">
  <div class="modal-card">
    <h3>\u6dfb\u52a0\u4e0a\u6e38</h3>
    <div class="row">
      <div class="field span-12"><label>\u6a21\u677f</label><select id="vendor-preset"></select></div>
    </div>
    <div class="row">
      <div class="field span-6"><label>\u5907\u6ce8</label><input id="vendor-note" placeholder="\u4f8b\u5982: \u4e3b\u529b Key"></div>
      <div class="field span-6"><label>\u5185\u90e8\u540d\u79f0</label><input id="vendor-name" placeholder="my-upstream (\u53ef\u7701\u7565)"></div>
    </div>
    <div class="row">
      <div class="field span-12" id="vendor-account-id-wrap" style="display:none"><label>Account ID</label><input id="vendor-account-id" class="mono" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>
    </div>
    <div class="row">
      <div class="field span-6"><label>Base URL</label><input id="vendor-base-url" placeholder="https://..."></div>
      <div class="field span-6"><label>API Key</label><input id="vendor-api-key" class="mono" placeholder="nvapi-... \u6216 sk-..."></div>
    </div>
    <div class="row">
      <div class="field span-4"><label>\u6a21\u578b (\u9017\u53f7\u5206\u9694, \u7559\u7a7a=\u81ea\u52a8)</label><input id="vendor-models" placeholder="model-a, model-b"><button type="button" class="small secondary" id="vendor-fetch-models">\u4ece\u5f53\u524d\u4e0a\u6e38\u5bfc\u5165</button></div>
      <div class="field span-4"><label>\u8def\u5f84 (\u9017\u53f7\u5206\u9694)</label><input id="vendor-paths" value="/v1/chat/completions, /v1/embeddings"></div>
      <div class="field span-2"><label>\u6743\u91cd</label><input id="vendor-weight" type="number" min="1" value="1"></div>
      <div class="field span-2"><label>\u542f\u7528</label><select id="vendor-enabled"><option value="true">\u662f</option><option value="false">\u5426</option></select></div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="close-vendor-modal">\u53d6\u6d88</button>
      <button class="good" id="create-vendor">\u6dfb\u52a0</button>
    </div>
  </div>
</div>
<div class="modal-backdrop" id="system-prompt-modal">
  <div class="modal-card prompt-modal-card">
    <h3>\u7cfb\u7edf\u63d0\u793a\u8bcd / \u5168\u5c40\u4e0a\u4e0b\u6587</h3>
    <div class="prompt-modal-grid">
      <div class="field">
        <label>\u603b\u4f53\u6587\u672c / \u5927\u6587\u672c\u62c6\u5206</label>
        <div class="prompt-splitter-row">
          <textarea id="prompt-splitter-input" class="prompt-splitter-textarea" placeholder="\u53ef\u4ee5\u628a\u4e00\u6574\u6bb5\u63d0\u793a\u8bcd\u7c98\u8d34\u5230\u8fd9\u91cc\uff0c\u6309\u6bb5\u843d\u62c6\u5206\u5230\u4e2d\u95f4\u7684\u63d0\u793a\u8bcd / \u4e0a\u4e0b\u6587\u533a\u57df\u3002"></textarea>
          <button type="button" class="secondary small" id="split-prompt-context">\u62c6\u5206\u5230\u63d0\u793a\u8bcd / \u4e0a\u4e0b\u6587</button>
        </div>
      </div>
      <div class="prompt-main-column">
        <div class="field">
          <label>\u7cfb\u7edf\u63d0\u793a\u8bcd</label>
          <textarea id="system-prompt-input" class="system-prompt-textarea" placeholder="\u7b80\u77ed\u3001\u5fc5\u987b\u7167\u505a\u7684\u6700\u9ad8\u6307\u4ee4\u3002\u7559\u7a7a\u5219\u4e0d\u6ce8\u5165\u3002"></textarea>
          <div class="context-controls">
            <button type="button" class="secondary small" id="export-prompt-config">\u5bfc\u51fa\u63d0\u793a\u8bcd</button>
            <button type="button" class="secondary small" id="import-prompt-config">\u5bfc\u5165\u63d0\u793a\u8bcd</button>
          </div>
          <input type="file" id="import-prompt-file" accept=".json,application/json,.txt,text/plain" hidden>
        </div>
        <div class="field">
          <label>\u5168\u5c40\u4e0a\u4e0b\u6587</label>
          <textarea id="global-context-input" class="context-prompt-textarea" placeholder="\u66f4\u957f\u7684\u80cc\u666f\u3001\u504f\u597d\u548c\u7ec6\u5316\u8981\u6c42\u3002\u4f1a\u4f5c\u4e3a\u53c2\u8003\u4e0a\u4e0b\u6587\u9644\u52a0\u5230 Chat/Responses/Messages \u8bf7\u6c42\u3002"></textarea>
        </div>
        <div class="context-controls">
          <label class="note"><input type="checkbox" id="context-on-demand"> \u6309\u9700\u6ce8\u5165\u7247\u6bb5</label>
          <label class="note">\u6700\u591a\u7247\u6bb5 <input id="context-item-limit" type="number" min="1" max="5" value="3"></label>
          <label class="note">\u6700\u591a\u5b57\u7b26 <input id="context-max-chars" type="number" min="500" max="20000" value="4000"></label>
          <button type="button" class="secondary small" id="add-context-item">\u65b0\u589e\u7247\u6bb5</button>
          <button type="button" class="secondary small" id="classify-context-items">\u4ece\u5927\u6587\u672c\u751f\u6210\u7247\u6bb5</button>
          <button type="button" class="secondary small" id="export-context-items">\u5bfc\u51fa\u4e0a\u4e0b\u6587</button>
          <button type="button" class="secondary small" id="import-context-items">\u5bfc\u5165\u4e0a\u4e0b\u6587</button>
        </div>
        <input type="file" id="import-context-file" accept=".json,application/json" hidden>
        <div class="context-items" id="context-items"></div>
      </div>
      <div class="prompt-scope-column">
        <div class="field">
          <label>\u7cfb\u7edf\u63d0\u793a\u8bcd\u751f\u6548\u5ba2\u6237\u7aef Key</label>
          <div class="prompt-client-scope" id="system-prompt-client-scope"></div>
        </div>
        <div class="field">
          <label>Subagent Prompt \u751f\u6548\u5ba2\u6237\u7aef Key <span class="note">\u9009\u4e2d\u540e\u5728\u7cfb\u7edf\u63d0\u793a\u8bcd\u540e\u8ffd\u52a0\u56fa\u5b9a\u82f1\u6587\u53e5\u5b50</span></label>
          <div class="prompt-client-scope" id="subagent-prompt-client-scope"></div>
        </div>
        <div class="field">
          <label>\u5168\u5c40\u4e0a\u4e0b\u6587\u751f\u6548\u5ba2\u6237\u7aef Key</label>
          <div class="prompt-client-scope" id="global-context-client-scope"></div>
        </div>
        <div class="field">
          <label>\u5168\u91cf\u6ce8\u5165\u5ba2\u6237\u7aef Key <span class="note">\u4e0d\u9009=\u4e0d\u5f3a\u5236\u5168\u91cf\uff1b\u9009\u4e2d\u540e\u5ffd\u7565\u5173\u952e\u8bcd\uff0c\u4f46\u4ecd\u6309\u6700\u591a\u5b57\u7b26\u622a\u65ad</span></label>
          <div class="prompt-client-scope" id="context-always-client-scope"></div>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="close-system-prompt-modal">\u5173\u95ed</button>
      <button class="good" id="apply-system-prompt-modal">\u5e94\u7528</button>
    </div>
  </div>
</div>

`;
}

function renderAdminScript(version) {
  return `<script>
    const API_BASE = location.pathname.replace(new RegExp("/+$"), "") + "/api";
  const state = { config: null, presets: [], clients: [], gateway: null, draftPresetId: null, lastCreatedClient: null, sessionInputTokens: 0, sessionOutputTokens: 0, modelPicker: null, speedPicker: null, logs: [], logExpanded: false, logFilter: "all" };
  const byId = (id) => document.getElementById(id);
  const text = (value) => String(value ?? "");

  function splitList(value) { return text(value).split(/[,\\n]/).map((s) => s.trim()).filter(Boolean); }
  function esc(value) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function presetById(id) { return state.presets.find((p) => p.id === id) || state.presets.find((p) => p.id === "custom") || state.presets[0]; }
  function baseUrlLocked(presetId) { const p = presetById(presetId); return !!p && p.requires_base_url === false; }
  function presetNeedsAccountId(presetId) { const p = presetById(presetId); return !!p && p.requires_account_id; }
  function presetBaseUrl(presetId, accountId) {
    const preset = presetById(presetId);
    if (!preset) return "";
    if (preset.requires_account_id) {
      const account = text(accountId).trim();
      return account
        ? text(preset.base_url || "").replace("{ACCOUNT_ID}", account).trim()
        : text(preset.base_url || "").replace("{ACCOUNT_ID}", "ACCOUNT_ID").trim();
    }
    return text(preset.base_url || "").trim();
  }
  function presetHeaders(presetId) {
    const preset = presetById(presetId);
    return preset && preset.headers && typeof preset.headers === "object" && !Array.isArray(preset.headers) ? preset.headers : {};
  }

  let toastTimer = null;
  function showToast(message) {
    const t = byId("toast"); t.textContent = message; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  async function copyText(value, successMessage) {
    if (!value) throw new Error("\u6ca1\u6709\u53ef\u590d\u5236\u7684\u5185\u5bb9");
    await navigator.clipboard.writeText(value);
    showToast(successMessage || "\u5df2\u590d\u5236");
  }

  async function withButtonBusy(button, label, task) {
    const orig = button.textContent; button.disabled = true; button.textContent = label;
    try { return await task(); }
    finally { button.disabled = false; button.textContent = orig; }
  }

  async function parseApiResponse(response) {
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json")) return response.json();
    const body = await response.text().catch(() => "(unreadable)"); throw new Error("Admin API \u8fd4\u56de\u7684\u4e0d\u662f JSON (status " + response.status + ", body=" + body.slice(0, 200) + ")");
  }

  function normalizeImportList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => text(item).trim()).filter(Boolean);
    }
    return splitList(value);
  }

  function normalizeModelContextMap(value, models) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const out = {};
    (models || []).forEach(function(model) {
      out[model] = text(source[model] || "1m").trim() || "1m";
    });
    return out;
  }

  function normalizeImportedUpstreams(payload) {
    const raw = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.upstreams)
        ? payload.upstreams
        : [];

    return raw.map(function(item, index) {
      const headers = item && typeof item.headers === "object" && !Array.isArray(item.headers) ? item.headers : {};
      const models = normalizeImportList(item && item.models);
      return {
        account_id: text(item && item.account_id).trim(),
        api_key_value: text(item && (item.api_key || item.api_key_value)).trim(),
        base_url: text(item && item.base_url).trim(),
        capability: item && item.capability ? item.capability : null,
        enabled: item && item.enabled !== false,
        headers: headers,
        models: models,
        model_contexts: normalizeModelContextMap(item && item.model_contexts, models),
        name: text(item && item.name).trim() || "upstream-" + (index + 1),
        note: text(item && item.note).trim(),
        paths: normalizeImportList(item && item.paths),
        preset: text(item && item.preset).trim() || "custom",
        priority: Number(item && item.priority || index + 1),
        weight: Number(item && item.weight || 1),
      };
    }).filter((item) => item.base_url && item.api_key_value);
  }

  function downloadJsonFile(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportUpstreams() {
    const resp = await fetch(API_BASE + "/upstreams/export");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "导出上游配置失败");
    return payload;
  }

  async function importUpstreamsFromFile(file) {
    const textValue = await file.text();
    const payload = JSON.parse(textValue);
    const upstreams = normalizeImportedUpstreams(payload);
    if (!upstreams.length) {
      throw new Error("导入文件里没有可用的上游配置");
    }
    const currentUpstreams = Array.isArray(state.config && state.config.upstreams) ? state.config.upstreams : [];
    if (currentUpstreams.length && !confirm("导入会覆盖当前上游配置，继续吗？")) {
      return;
    }
    state.config.upstreams = upstreams;
    renderUpstreams();
    await saveConfig();
    showToast("已导入 " + upstreams.length + " 个上游");
  }

  function showError(error) {
    console.error(error);
    showToast(error.message || "Error");
  }

  /* ---- Modal ---- */
  function openVendorModal() {
    if (!state.draftPresetId && state.presets.length) state.draftPresetId = state.presets[0].id;
    ["vendor-note","vendor-name","vendor-api-key","vendor-models","vendor-account-id"].forEach((id) => byId(id).value = "");
    byId("vendor-weight").value = "1"; byId("vendor-enabled").value = "true";
    renderPresets();
    applyVendorPreset();
    byId("vendor-modal").classList.add("open");
  }
  function closeVendorModal() { byId("vendor-modal").classList.remove("open"); }

  function renderPresets() {
    const sel = byId("vendor-preset");
    sel.innerHTML = state.presets.map((p) =>
      '<option value="' + esc(p.id) + '">' + esc(p.name) + (
        p.requires_account_id ? ' (REST + Account ID)' :
        p.requires_base_url === false ? ' (\u9884\u8bbe ' + esc(p.base_url || "") + ')' :
        ' (\u81ea\u5b9a\u4e49)'
      ) + '</option>'
    ).join("");
    sel.value = state.draftPresetId || (state.presets[0] ? state.presets[0].id : "custom");
    if (!sel._wired) {
      sel._wired = true;
      sel.addEventListener("change", () => { state.draftPresetId = sel.value; applyVendorPreset(); });
    }
  }

  function applyVendorPreset() {
    const baseInput = byId("vendor-base-url");
    const pathsInput = byId("vendor-paths");
    const accountWrap = byId("vendor-account-id-wrap");
    const accountInput = byId("vendor-account-id");
    const preset = presetById(state.draftPresetId);
    if (!preset) return;
    const locked = preset.requires_base_url === false;
    const needsAccountId = !!preset.requires_account_id;
    accountWrap.style.display = needsAccountId ? "" : "none";
    baseInput.readOnly = locked;
    baseInput.value = presetBaseUrl(preset.id, accountInput.value);
    if (!needsAccountId) accountInput.value = "";
    pathsInput.value = (preset.paths || []).join(", ");
  }

  function createVendorFromModal() {
    const presetId = state.draftPresetId || "custom";
    const note = byId("vendor-note").value.trim();
    const name = byId("vendor-name").value.trim();
    const baseUrl = byId("vendor-base-url").value.trim();
    const apiKey = byId("vendor-api-key").value.trim();
    const accountId = byId("vendor-account-id").value.trim();
    const suffix = Math.random().toString(36).slice(2, 7);
    const preset = presetById(presetId);

    if (!apiKey) throw new Error("API Key \u4e0d\u80fd\u4e3a\u7a7a");
    if (preset && preset.requires_account_id && !accountId) throw new Error("Account ID \u4e0d\u80fd\u4e3a\u7a7a");
    if (!baseUrl) throw new Error("Base URL \u4e0d\u80fd\u4e3a\u7a7a");

    const models = splitList(byId("vendor-models").value);
    state.config.upstreams.push({
      id: crypto.randomUUID ? crypto.randomUUID() : "u-" + suffix,
      preset: presetId,
      note, name: name || presetId + "-" + suffix,
      base_url: baseUrl, api_key_value: apiKey,
      account_id: accountId,
      headers: presetHeaders(presetId),
      models: models,
      model_contexts: normalizeModelContextMap({}, models),
      paths: splitList(byId("vendor-paths").value),
      weight: Number(byId("vendor-weight").value || 1),
      priority: 100, enabled: byId("vendor-enabled").value === "true",
    });

    renderUpstreams(); closeVendorModal();
    ["vendor-note","vendor-name","vendor-api-key","vendor-models"].forEach((id) => byId(id).value = "");
    byId("vendor-account-id").value = "";
    byId("vendor-weight").value = "1"; byId("vendor-enabled").value = "true";
    renderPresets();
  }

  /* ---- Upstreams ---- */
  function modelContextFor(upstream, model) {
    const contexts = upstream && upstream.model_contexts && typeof upstream.model_contexts === "object" ? upstream.model_contexts : {};
    return text(contexts[model] || "1m").trim() || "1m";
  }

  function modelEntryHtml(model, context) {
    return '<div class="model-entry">' +
      '<input class="mono model-name-input" value="' + esc(model || "") + '" placeholder="model-id">' +
      '<input class="mono model-context-input" value="' + esc(context || "1m") + '" placeholder="1m" title="上下文">' +
      '<button type="button" class="small danger delete-model-row">删除</button>' +
    '</div>';
  }

  function modelEditorHtml(item) {
    const models = Array.isArray(item.models) ? item.models : [];
    const rows = models.length
      ? models.map(function(model) { return modelEntryHtml(model, modelContextFor(item, model)); }).join("")
      : '<div class="note model-entry-empty">留空=自动；也可以点“添加模型”手动填写。</div>';
    return '<textarea data-field="models" hidden>' + esc(models.join("\\n")) + '</textarea>' +
      '<div class="model-entry-list">' + rows + '</div>' +
      '<button type="button" class="small secondary add-model-row" style="margin-top:6px">添加模型</button> ' +
      '<button type="button" class="small secondary fetch-models-btn" data-upstream="' + esc(item.name) + '" style="margin-top:6px">从上游导入模型</button>';
  }

  function syncModelTextarea(card) {
    const models = [...card.querySelectorAll(".model-entry")].map(function(row) {
      return row.querySelector(".model-name-input").value.trim();
    }).filter(Boolean);
    card.querySelector('[data-field="models"]').value = models.join("\\n");
  }

  function addModelRow(card, model, context) {
    const list = card.querySelector(".model-entry-list");
    list.querySelector(".model-entry-empty")?.remove();
    list.insertAdjacentHTML("beforeend", modelEntryHtml(model || "", context || "1m"));
    bindModelEntry(list.lastElementChild);
    syncModelTextarea(card);
  }

  function bindModelEntry(row) {
    if (!row || row._wired) return;
    row._wired = true;
    row.querySelector(".model-name-input").addEventListener("input", function() {
      syncModelTextarea(row.closest(".upstream-card"));
    });
    row.querySelector(".delete-model-row").addEventListener("click", function() {
      const card = row.closest(".upstream-card");
      row.remove();
      if (!card.querySelector(".model-entry")) {
        card.querySelector(".model-entry-list").innerHTML = '<div class="note model-entry-empty">留空=自动；也可以点“添加模型”手动填写。</div>';
      }
      syncModelTextarea(card);
    });
  }

  function renderModelEditor(card) {
    const textarea = card.querySelector('[data-field="models"]');
    const models = splitList(textarea.value);
    const prev = {};
    card.querySelectorAll(".model-entry").forEach(function(row) {
      const model = row.querySelector(".model-name-input").value.trim();
      if (model) prev[model] = row.querySelector(".model-context-input").value.trim() || "1m";
    });
    card.querySelector(".model-entry-list").innerHTML = models.length
      ? models.map(function(model) { return modelEntryHtml(model, prev[model] || "1m"); }).join("")
      : '<div class="note model-entry-empty">留空=自动；也可以点“添加模型”手动填写。</div>';
    card.querySelectorAll(".model-entry").forEach(bindModelEntry);
  }

  function renderUpstreams() {
    const host = byId("upstream-list");
    if (!state.config.upstreams.length) {
      host.innerHTML = '<div class="note">\u8fd8\u6ca1\u6709\u4e0a\u6e38\uff0c\u70b9\u4e0a\u65b9\u201c+ \u6dfb\u52a0\u4e0a\u6e38\u201d\u5f00\u59cb\u3002</div>';
      return;
    }

    const groups = {};
    state.config.upstreams.forEach((item) => {
      const p = presetById(item.preset);
      const key = (p ? p.name : (item.preset || "generic")) || "\u5176\u4ed6";
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    host.innerHTML = Object.keys(groups).map((groupName) =>
      '<details class="upstream-group"><summary><span>' + esc(groupName) + '</span><span class="note">' + groups[groupName].length + ' \u4e2a\u4e0a\u6e38</span><span class="note upstream-group-active"></span><span class="note upstream-group-health">\u25cb \u672a\u68c0\u67e5</span></summary><div class="upstream-group-body">' +
        groups[groupName].map(upstreamCardHtml).join("") +
      '</div></details>'
    ).join("");
    updateUpstreamGroupHealth();

    function upstreamCardHtml(item) {
      const p = presetById(item.preset);
      const badge = p ? p.name : (item.preset || "generic");
      const locked = baseUrlLocked(item.preset);
      const needsAccountId = presetNeedsAccountId(item.preset);
      const accountIdValue = text(item.account_id).trim();
      const presetOptions = state.presets.map((pr) =>
        '<option value="' + esc(pr.id) + '"' + (pr.id === item.preset ? ' selected' : '') + '>' + esc(pr.name) + '</option>'
      ).join("");
      const accountRow = needsAccountId
        ? '<div class="row"><div class="field span-12"><label>Account ID</label><input data-field="account_id" class="mono" value="' + esc(accountIdValue) + '" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div></div>'
        : '<div class="row" style="display:none"><div class="field span-12"><label>Account ID</label><input data-field="account_id" class="mono" value="' + esc(accountIdValue) + '" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div></div>';

      return '<details class="upstream-card' + (item.enabled ? '' : ' disabled') + '" data-id="' + esc(item.id) + '">' +
        '<summary>' +
          '<span class="card-badge">' + esc(badge) + '</span>' +
          '<strong>' + esc(item.note || item.name || "\u672a\u547d\u540d") + '</strong>' +
          '<span class="upstream-status-emoji" data-upstream="' + esc(item.name) + '" title="' + (item.enabled ? '' : '\u5df2\u505c\u7528') + '">' + (item.enabled ? '' : '\u26d4') + '</span>' +
          '<span class="health-dot" data-upstream="' + esc(item.name) + '"></span>' +
          (["custom","generic-openai","claude-openai"].includes(item.preset) ? '<span class="capability-badge" data-upstream="' + esc(item.name) + '">' + (item.capability === "openai" ? '\u2713 OpenAI' : item.capability === "claude" ? 'Claude' : '\u672a\u68c0\u6d4b') + '</span>' : '') +
          '<span class="card-meta">\u6743\u91cd:' + esc(item.weight) + ' | \u4f18\u5148:' + esc(item.priority) + ' | ' + (item.enabled ? '\u5df2\u542f\u7528' : '\u5df2\u505c\u7528') + '</span>' +
          (isNimConfig(item) ? '<span class="card-meta nim-rpm" data-upstream="' + esc(item.name) + '"><span class="nim-rpm-count">NIM 0/40</span><span class="nim-rpm-timer" hidden> · 60s</span></span>' : '') +
          '<button type="button" class="small upstream-enable-toggle ' + (item.enabled ? 'secondary' : 'good') + '" data-enabled="' + (item.enabled ? 'true' : 'false') + '">' + (item.enabled ? '\u505c\u7528' : '\u542f\u7528') + '</button>' +
        '</summary>' +
        '<div class="card-body">' +
          '<div class="row">' +
            '<div class="field span-4"><label>\u6a21\u677f</label><select data-field="preset">' + presetOptions + '</select></div>' +
            '<div class="field span-4"><label>\u5907\u6ce8</label><input data-field="note" value="' + esc(item.note) + '"></div>' +
            '<div class="field span-4"><label>\u5185\u90e8\u540d\u79f0</label><input data-field="name" value="' + esc(item.name) + '"></div>' +
          '</div>' +
          accountRow +
          '<div class="row">' +
            '<div class="field span-6"><label>Base URL' + (locked ? ' (\u9884\u8bbe)' : '') + '</label><input data-field="base_url" value="' + esc(item.base_url || presetBaseUrl(item.preset, accountIdValue)) + '"' + (locked ? ' readonly' : '') + '></div>' +
            '<div class="field span-6"><label>API Key (\u4fdd\u5b58\u540e\u663e\u793a\u5bc6\u6587)</label><input class="mono" data-field="api_key_value" value="' + esc(item.api_key_value) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-3"><label>\u6743\u91cd</label><input data-field="weight" type="number" min="1" value="' + esc(item.weight) + '"></div>' +
            '<div class="field span-3"><label>\u4f18\u5148\u7ea7</label><input data-field="priority" type="number" value="' + esc(item.priority) + '"></div>' +
            '<div class="field span-3"><label>\u542f\u7528</label><select data-field="enabled"><option value="true"' + (item.enabled ? ' selected' : '') + '>\u662f</option><option value="false"' + (!item.enabled ? ' selected' : '') + '>\u5426</option></select></div>' +
            '<div class="field span-3"><label>\u8def\u5f84</label><input data-field="paths" value="' + esc((item.paths || []).join(", ")) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-12"><label>\u6a21\u578b / \u4e0a\u4e0b\u6587 (\u7559\u7a7a=\u81ea\u52a8\uff0c\u9ed8\u8ba4 1m)</label>' + modelEditorHtml(item) + '</div>' +
          '</div>' +
          '<button type="button" class="danger small delete-upstream">\u5220\u9664\u4e0a\u6e38</button>' +
          (["custom","generic-openai","claude-openai"].includes(item.preset) ? '<button type="button" class="secondary small detect-upstream" data-upstream="' + esc(item.name) + '">\u68c0\u6d4b\u80fd\u529b</button>' : '') +
        '</div>' +
      '</details>';
    }

    host.querySelectorAll(".detect-upstream").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        await withButtonBusy(btn, "\u68c0\u6d4b\u4e2d...", () => detectCapability(btn.dataset.upstream));
      });
    });
    host.querySelectorAll(".upstream-enable-toggle").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = btn.closest(".upstream-card");
        const enabled = btn.dataset.enabled !== "true";
        card.querySelector('[data-field="enabled"]').value = enabled ? "true" : "false";
        await withButtonBusy(btn, enabled ? "\u542f\u7528\u4e2d..." : "\u505c\u7528\u4e2d...", saveConfig).catch(showError);
      });
    });
    host.querySelectorAll(".model-entry").forEach(bindModelEntry);
    host.querySelectorAll(".add-model-row").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        addModelRow(btn.closest(".upstream-card"), "", "1m");
      });
    });
    host.querySelectorAll(".delete-upstream").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        const card = btn.closest(".upstream-card");
        await withButtonBusy(btn, "\u5220\u9664\u4e2d...", async () => {
          state.config.upstreams = state.config.upstreams.filter((u) => u.id !== card.dataset.id);
          renderUpstreams();
          await saveConfig();
          showToast("\u5df2\u5220\u9664\u5e76\u4fdd\u5b58");
        });
      });
    });
    host.querySelectorAll(".fetch-models-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        var name = btn.dataset.upstream;
        var card = btn.closest(".upstream-card");
        var textarea = card ? card.querySelector('[data-field="models"]') : null;
        await withButtonBusy(btn, "\u5bfc\u5165\u4e2d...", async function() {
          var models = await fetchUpstreamModels(name, card);
          if (!models.length) throw new Error("\u8be5\u4e0a\u6e38\u65e0\u53ef\u7528\u6a21\u578b");
          showModelPicker(name, models, textarea, card);
        });
      });
    });

    host.querySelectorAll('select[data-field="preset"]').forEach((sel) => {
      sel.addEventListener("change", () => {
        const card = sel.closest(".upstream-card");
        const p = presetById(sel.value);
        const needsAccountId = !!p && p.requires_account_id;
        const baseInput = card.querySelector('[data-field="base_url"]');
        const pathsInput = card.querySelector('[data-field="paths"]');
        const accountRow = card.querySelector('[data-field="account_id"]')?.closest(".row");
        const accountInput = card.querySelector('[data-field="account_id"]');
        if (accountRow) accountRow.style.display = needsAccountId ? "" : "none";
        baseInput.readOnly = !!p && (p.requires_base_url === false || needsAccountId);
        baseInput.value = presetBaseUrl(sel.value, accountInput ? accountInput.value : "");
        pathsInput.value = (p?.paths || []).join(", ");
      });
    });
    host.querySelectorAll('[data-field="account_id"]').forEach((input) => {
      input.addEventListener("input", () => {
        const card = input.closest(".upstream-card");
        const presetSel = card.querySelector('select[data-field="preset"]');
        const p = presetById(presetSel.value);
        if (!p || !p.requires_account_id) return;
        const baseInput = card.querySelector('[data-field="base_url"]');
        baseInput.value = presetBaseUrl(presetSel.value, input.value);
      });
    });
  }

  function collectConfig() {
    const existingUpstreams = Array.isArray(state.config && state.config.upstreams) ? state.config.upstreams : [];
    const cards = [...document.querySelectorAll(".upstream-card")];
    const upstreams = cards.map((card, index) => {
      const prev = existingUpstreams.find((item) => String(item && item.id) === String(card.dataset.id)) || existingUpstreams[index] || {};
      const modelRows = [...card.querySelectorAll(".model-entry")];
      const models = modelRows.map((row) => row.querySelector(".model-name-input").value.trim()).filter(Boolean);
      const modelContexts = {};
      modelRows.forEach((row) => {
        const model = row.querySelector(".model-name-input").value.trim();
        if (model) modelContexts[model] = row.querySelector(".model-context-input").value.trim() || "1m";
      });
      return {
        capability: prev.capability || null,
        account_id: card.querySelector('[data-field="account_id"]')?.value.trim() || prev.account_id || "",
        id: card.dataset.id || prev.id,
        headers: prev.headers || {},
        preset: card.querySelector('[data-field="preset"]').value,
        note: card.querySelector('[data-field="note"]').value.trim(),
        name: card.querySelector('[data-field="name"]').value.trim(),
        base_url: card.querySelector('[data-field="base_url"]').value.trim(),
        api_key_value: card.querySelector('[data-field="api_key_value"]').value.trim(),
        weight: Number(card.querySelector('[data-field="weight"]').value || 1),
        priority: Number(card.querySelector('[data-field="priority"]').value || 100),
        enabled: card.querySelector('[data-field="enabled"]').value === "true",
        paths: splitList(card.querySelector('[data-field="paths"]').value),
        models,
        model_contexts: modelContexts,
      };
    });
    return {
      settings: {
        request_timeout_ms: Number(byId("request-timeout").value || 180000),
        stream_idle_timeout_ms: Number(byId("stream-idle-timeout").value || 900000),
        upstream_cooldown_ttl: Number(byId("cooldown-ttl").value || 60),
        model_cache_ttl: Number(byId("model-cache-ttl").value || 3600),
        system_prompt: byId("system-prompt-input").value,
        system_prompt_clients: selectedPromptClients("system-prompt-client-scope"),
        subagent_prompt_clients: selectedPromptClients("subagent-prompt-client-scope"),
        global_context: byId("global-context-input").value,
        global_context_clients: selectedPromptClients("global-context-client-scope"),
        context_always_clients: selectedPromptClients("context-always-client-scope"),
        context_on_demand: byId("context-on-demand").checked,
        context_item_limit: Number(byId("context-item-limit").value || 3),
        context_max_chars: Number(byId("context-max-chars").value || 4000),
        context_items: collectContextItems(),
      },
      routing: {
        load_balance: byId("routing-load-balance").checked,
        failover: byId("routing-failover").checked,
        hedge_enabled: byId("routing-hedge").checked,
        fast_routing: byId("routing-fast").checked,
        hedge_max: Number(byId("routing-hedge-max").value || 2),
      },
      upstreams,
    };
  }

  function isNimConfig(upstream) {
    return upstream && (upstream.preset === "nvidia-nim" || text(upstream.base_url).toLowerCase().includes("integrate.api.nvidia.com"));
  }

  /* ---- Settings ---- */
  function renderSettings() {
    var s = state.config && state.config.settings || {};
    var r = state.config && state.config.routing || {};
    byId("request-timeout").value = s.request_timeout_ms || "";
    byId("stream-idle-timeout").value = s.stream_idle_timeout_ms || "";
    byId("cooldown-ttl").value = s.upstream_cooldown_ttl || "";
    byId("model-cache-ttl").value = s.model_cache_ttl || "";
    byId("system-prompt-input").value = s.system_prompt || "";
    byId("global-context-input").value = s.global_context || "";
    byId("context-on-demand").checked = s.context_on_demand === true;
    byId("context-item-limit").value = s.context_item_limit || 3;
    byId("context-max-chars").value = s.context_max_chars || 4000;
    renderContextItems(s.context_items || []);
    renderPromptClientScopes();
    renderPromptContextStatus();
    byId("routing-load-balance").checked = r.load_balance !== false;
    byId("routing-failover").checked = r.failover !== false;
    byId("routing-hedge").checked = r.hedge_enabled === true;
    byId("routing-fast").checked = r.fast_routing === true;
    byId("routing-hedge-max").value = r.hedge_max || 2;
    byId("gateway-url-pill").textContent = (state.gateway && state.gateway.base_url) || "loading...";
  }

  async function loadConfig() {
    const resp = await fetch(API_BASE + "/config");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u8bfb\u53d6\u914d\u7f6e\u5931\u8d25");
    state.config = payload.config || {};
    state.presets = payload.presets || [];
    state.gateway = payload.gateway || {};
    renderSettings();
    renderUpstreams();
    loadRuntimeStatus().catch(function(){});
  }

  async function saveConfig() {
    const resp = await fetch(API_BASE + "/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(collectConfig()),
    });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u4fdd\u5b58\u5931\u8d25");
    state.config = payload.config;
    renderSettings(); renderUpstreams();
    loadRuntimeStatus().catch(function(){});
    showToast("\u914d\u7f6e\u5df2\u4fdd\u5b58");
    byId("config-status").textContent = "\u2713 \u5df2\u4fdd\u5b58";
    setTimeout(() => byId("config-status").textContent = "", 3000);
  }

  async function saveSettings() {
    await saveConfig();
    byId("settings-status").textContent = "\u2713 \u5df2\u4fdd\u5b58";
    setTimeout(() => byId("settings-status").textContent = "", 3000);
  }

  function openSystemPromptModal() {
    renderPromptClientScopes();
    renderPromptContextStatus();
    byId("system-prompt-modal").classList.add("open");
    byId("system-prompt-input").focus();
  }

  function closeSystemPromptModal() {
    byId("system-prompt-modal").classList.remove("open");
  }

  function collectContextItems() {
    return [...document.querySelectorAll(".context-item")].map(function(row) {
      return {
        id: row.dataset.id,
        enabled: row.querySelector(".context-enabled").checked,
        title: row.querySelector(".context-title").value.trim(),
        keywords: splitList(row.querySelector(".context-keywords").value),
        clients: splitList(row.querySelector(".context-clients").value),
        models: splitList(row.querySelector(".context-models").value),
        priority: Number(row.querySelector(".context-priority").value || 0),
        max_chars: Number(row.querySelector(".context-max").value || 1200),
        text: row.querySelector(".context-text").value.trim(),
      };
    }).filter((item) => item.text);
  }

  function currentContextBundle() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      global_context: byId("global-context-input").value,
      global_context_clients: selectedPromptClients("global-context-client-scope"),
      context_always_clients: selectedPromptClients("context-always-client-scope"),
      context_on_demand: byId("context-on-demand").checked,
      context_item_limit: Number(byId("context-item-limit").value || 3),
      context_max_chars: Number(byId("context-max-chars").value || 4000),
      context_items: collectContextItems(),
    };
  }

  function currentPromptBundle() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      system_prompt: byId("system-prompt-input").value,
      system_prompt_clients: selectedPromptClients("system-prompt-client-scope"),
      subagent_prompt_clients: selectedPromptClients("subagent-prompt-client-scope"),
    };
  }

  function normalizeImportedPromptBundle(payload, rawText) {
    const source = payload && (payload.prompt || payload);
    if (!source || typeof source !== "object") {
      return { system_prompt: String(rawText || "").trim(), system_prompt_clients: [], subagent_prompt_clients: [] };
    }
    return {
      system_prompt: text(source.system_prompt || source.prompt || ""),
      system_prompt_clients: normalizeImportList(source.system_prompt_clients),
      subagent_prompt_clients: normalizeImportList(source.subagent_prompt_clients),
    };
  }

  function normalizeImportedContextBundle(payload) {
    const source = payload && (payload.context || payload);
    const items = Array.isArray(source.context_items) ? source.context_items : (Array.isArray(source.items) ? source.items : []);
    return {
      global_context: text(source.global_context || source.context_text || ""),
      global_context_clients: normalizeImportList(source.global_context_clients),
      context_always_clients: normalizeImportList(source.context_always_clients),
      context_on_demand: source.context_on_demand === true || items.length > 0,
      context_item_limit: Number(source.context_item_limit || 3),
      context_max_chars: Number(source.context_max_chars || 4000),
      context_items: items.map(function(item) {
        return {
          id: text(item && item.id).trim() || crypto.randomUUID(),
          enabled: item && item.enabled !== false,
          title: text(item && item.title).trim(),
          keywords: normalizeImportList(item && item.keywords),
          clients: normalizeImportList(item && item.clients),
          models: normalizeImportList(item && item.models),
          priority: Number(item && item.priority || 0),
          max_chars: Number(item && item.max_chars || 1200),
          text: text(item && item.text).trim(),
        };
      }).filter((item) => item.text),
    };
  }

  async function importPromptFromFile(file) {
    const raw = await file.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    const bundle = normalizeImportedPromptBundle(payload, raw);
    if (!bundle.system_prompt && !bundle.subagent_prompt_clients.length) throw new Error("\u5bfc\u5165\u6587\u4ef6\u91cc\u6ca1\u6709\u63d0\u793a\u8bcd\u914d\u7f6e");
    if (byId("system-prompt-input").value.trim() && !confirm("\u5bfc\u5165\u4f1a\u8986\u76d6\u5f53\u524d\u7cfb\u7edf\u63d0\u793a\u8bcd\uff0c\u7ee7\u7eed\u5417\uff1f")) return;

    const settings = state.config.settings || (state.config.settings = {});
    settings.system_prompt_clients = bundle.system_prompt_clients;
    settings.subagent_prompt_clients = bundle.subagent_prompt_clients;
    byId("system-prompt-input").value = bundle.system_prompt;
    renderPromptClientScopes();
    renderPromptContextStatus("\u5df2\u5bfc\u5165\uff0c\u4fdd\u5b58\u4e2d");
    await saveConfig();
    showToast("\u5df2\u5bfc\u5165\u63d0\u793a\u8bcd");
  }

  async function importContextFromFile(file) {
    const payload = JSON.parse(await file.text());
    const bundle = normalizeImportedContextBundle(payload);
    if (!bundle.global_context && !bundle.context_items.length) throw new Error("\u5bfc\u5165\u6587\u4ef6\u91cc\u6ca1\u6709\u4e0a\u4e0b\u6587\u6216\u7247\u6bb5");
    if (collectContextItems().length && !confirm("\u5bfc\u5165\u4f1a\u8986\u76d6\u5f53\u524d\u4e0a\u4e0b\u6587\u7247\u6bb5\uff0c\u7ee7\u7eed\u5417\uff1f")) return;

    const settings = state.config.settings || (state.config.settings = {});
    settings.global_context_clients = bundle.global_context_clients;
    settings.context_always_clients = bundle.context_always_clients;
    byId("global-context-input").value = bundle.global_context;
    byId("context-on-demand").checked = bundle.context_on_demand;
    byId("context-item-limit").value = bundle.context_item_limit;
    byId("context-max-chars").value = bundle.context_max_chars;
    renderPromptClientScopes();
    renderContextItems(bundle.context_items);
    renderPromptContextStatus("\u5df2\u5bfc\u5165\uff0c\u4fdd\u5b58\u4e2d");
    await saveConfig();
    showToast("\u5df2\u5bfc\u5165 " + bundle.context_items.length + " \u4e2a\u4e0a\u4e0b\u6587\u7247\u6bb5");
  }

  function renderContextItems(items) {
    const host = byId("context-items");
    if (!host) return;
    host.innerHTML = (items || []).map(contextItemHtml).join("") || '<div class="note">\u6682\u65e0\u7247\u6bb5\uff0c\u53ef\u4ece\u5927\u6587\u672c\u751f\u6210\u3002</div>';
    host.querySelectorAll(".delete-context-item").forEach((btn) => btn.addEventListener("click", () => {
      btn.closest(".context-item").remove();
      renderPromptContextStatus("\u5f85\u4fdd\u5b58");
    }));
    host.querySelectorAll("input,textarea").forEach((input) => input.addEventListener("input", () => renderPromptContextStatus("\u5f85\u4fdd\u5b58")));
  }

  function contextItemHtml(item) {
    return '<div class="context-item" data-id="' + esc(item.id || crypto.randomUUID()) + '">' +
      '<div class="context-item-head">' +
        '<input class="context-enabled" type="checkbox"' + (item.enabled === false ? '' : ' checked') + '>' +
        '<input class="context-title" placeholder="\u7247\u6bb5\u6807\u9898" value="' + esc(item.title || '') + '">' +
        '<input class="context-priority" type="number" placeholder="\u4f18\u5148\u7ea7" value="' + esc(item.priority || 0) + '">' +
        '<button type="button" class="danger small delete-context-item">\u5220\u9664</button>' +
      '</div>' +
      '<div class="context-item-grid">' +
        '<input class="context-keywords" placeholder="\u5173\u952e\u8bcd\uff0c\u9017\u53f7\u5206\u9694" value="' + esc((item.keywords || []).join(", ")) + '">' +
        '<input class="context-clients" placeholder="\u5ba2\u6237\u7aef\uff0c\u7a7a=\u5168\u90e8" value="' + esc((item.clients || []).join(", ")) + '">' +
        '<input class="context-models" placeholder="\u6a21\u578b\uff0c\u7a7a=\u5168\u90e8" value="' + esc((item.models || []).join(", ")) + '">' +
        '<input class="context-max" type="number" min="200" max="8000" value="' + esc(item.max_chars || 1200) + '">' +
      '</div>' +
      '<textarea class="context-text" placeholder="\u8fd9\u4e2a\u573a\u666f\u9700\u8981\u6ce8\u5165\u7684\u4e0a\u4e0b\u6587">' + esc(item.text || '') + '</textarea>' +
    '</div>';
  }

  function addContextItem(item) {
    const host = byId("context-items");
    if (host.querySelector(".note")) host.innerHTML = "";
    host.insertAdjacentHTML("beforeend", contextItemHtml(item || { enabled: true, max_chars: 1200 }));
    renderContextItems(collectContextItems());
    renderPromptContextStatus("\u5f85\u4fdd\u5b58");
  }

  function clientScopeHtml(selected, forceAll) {
    const ids = new Set(selected || []);
    const clients = state.clients || [];
    const allActive = forceAll ? ids.has("*") || ids.has("__all__") : !ids.size;
    let html = forceAll
      ? clientScopeChip("__none__", "\u4e0d\u542f\u7528\u5168\u91cf", !ids.size) + clientScopeChip("*", "\u5168\u90e8\u5ba2\u6237\u7aef", allActive)
      : clientScopeChip("__all__", "\u5168\u90e8\u5ba2\u6237\u7aef", allActive);
    if (!clients.length) return html + '<div class="note">\u6682\u65e0\u5ba2\u6237\u7aef Key</div>';
    return html +
      clients.map(function(c) {
        const id = text(c.id || c.name || c.key).trim();
        const label = text(c.name || c.id || "client");
        return clientScopeChip(id, label, !allActive && ids.has(id));
      }).join("");
  }

  function clientScopeChip(value, label, checked) {
    const prefix = checked ? "\u2705 " : "";
    return '<label class="' + (checked ? 'active' : '') + '"><input type="checkbox" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '><span data-label="' + esc(label) + '" title="' + esc(label) + '">' + prefix + esc(label) + '</span></label>';
  }

  function bindPromptScope(host, forceAll) {
    host.querySelectorAll('input').forEach(function(input) {
      input.addEventListener("change", function() {
        if (forceAll) {
          if (["__none__", "*"].includes(input.value) && input.checked) {
            host.querySelectorAll('input').forEach((other) => { if (other !== input) other.checked = false; });
          } else if (input.checked) {
            host.querySelectorAll('input[value="__none__"],input[value="*"]').forEach((other) => { other.checked = false; });
          }
          if (!host.querySelector('input:checked')) host.querySelector('input[value="__none__"]').checked = true;
        } else {
          const all = host.querySelector('input[value="__all__"]');
          if (input.value === "__all__" && input.checked) host.querySelectorAll('input:not([value="__all__"])').forEach((other) => { other.checked = false; });
          if (input.value !== "__all__" && input.checked && all) all.checked = false;
          if (all && !host.querySelector('input:not([value="__all__"]):checked')) all.checked = true;
        }
        syncClientScopeChips(host);
        renderPromptContextStatus("\u5f85\u4fdd\u5b58");
      });
    });
    syncClientScopeChips(host);
  }

  function syncClientScopeChips(host) {
    host.querySelectorAll("label").forEach(function(label) {
      const input = label.querySelector("input");
      const span = label.querySelector("span[data-label]");
      if (!input || !span) return;
      label.classList.toggle("active", input.checked);
      span.textContent = (input.checked ? "\u2705 " : "") + span.dataset.label;
    });
  }

  function renderPromptClientScopes() {
    const s = state.config && state.config.settings || {};
    const systemHost = byId("system-prompt-client-scope");
    const subagentHost = byId("subagent-prompt-client-scope");
    const contextHost = byId("global-context-client-scope");
    const alwaysHost = byId("context-always-client-scope");
    if (!systemHost || !subagentHost || !contextHost || !alwaysHost) return;
    systemHost.innerHTML = clientScopeHtml(s.system_prompt_clients || [], false);
    subagentHost.innerHTML = clientScopeHtml(s.subagent_prompt_clients || ["__none__"], true);
    contextHost.innerHTML = clientScopeHtml(s.global_context_clients || [], false);
    alwaysHost.innerHTML = clientScopeHtml(s.context_always_clients || [], true);
    bindPromptScope(systemHost, false);
    bindPromptScope(subagentHost, true);
    bindPromptScope(contextHost, false);
    bindPromptScope(alwaysHost, true);
  }

  function selectedPromptClients(id) {
    const host = byId(id);
    if (!host) return [];
    if (id === "context-always-client-scope" || id === "subagent-prompt-client-scope") {
      if (host.querySelector('input[value="*"]:checked')) return ["*"];
      return [...host.querySelectorAll('input:checked')].map((input) => input.value).filter((value) => value && value !== "__none__");
    }
    if (host.querySelector('input[value="__all__"]:checked')) return [];
    return [...host.querySelectorAll('input:not([value="__all__"]):checked')].map((input) => input.value).filter(Boolean);
  }

  function promptScopeLabel(id, emptyLabel) {
    const values = selectedPromptClients(id);
    if (values.includes("*")) return "\u5168\u90e8";
    return values.length || emptyLabel;
  }

  function renderPromptContextStatus(prefix) {
    const systemLen = byId("system-prompt-input").value.length;
    const contextLen = byId("global-context-input").value.length;
    const itemCount = collectContextItems().length;
    const systemScope = promptScopeLabel("system-prompt-client-scope", "\u5168\u90e8");
    const subagentScope = promptScopeLabel("subagent-prompt-client-scope", "\u65e0");
    const contextScope = promptScopeLabel("global-context-client-scope", "\u5168\u90e8");
    const alwaysScope = promptScopeLabel("context-always-client-scope", "\u65e0");
    const subagentEnabled = selectedPromptClients("subagent-prompt-client-scope").length > 0;
    if (!systemLen && !contextLen && !itemCount && !subagentEnabled) {
      byId("system-prompt-status").textContent = "\u672a\u542f\u7528";
      return;
    }
    byId("system-prompt-status").textContent = (prefix || "\u5df2\u542f\u7528") + " (\u7cfb\u7edf " + systemLen + " / " + systemScope + " \u5ba2\u6237\u7aef\uff0cSubagent " + subagentScope + "\uff0c\u4e0a\u4e0b\u6587 " + contextLen + " / " + contextScope + " \u5ba2\u6237\u7aef\uff0c\u7247\u6bb5 " + itemCount + "\uff0c\u5168\u91cf " + alwaysScope + ")";
  }

  function splitPromptContextDraft() {
    const raw = byId("prompt-splitter-input").value.trim();
    if (!raw) return;
    const rulePattern = /\\b(must|always|never|required|forbidden|highest|priority|mandatory|strictly|do not|don't|cannot|should)\\b|[\u5fc5][\u987b\u9700]|\u6c38\u8fdc|\u7981\u6b62|\u4e0d\u5141\u8bb8|\u4e0d\u5f97|\u6700\u9ad8|\u4f18\u5148|\u65e0\u6761\u4ef6|\u7167\u505a/i;
    const blocks = raw.split(/\\n\\s*\\n/).map((part) => part.trim()).filter(Boolean);
    const systemParts = [];
    const contextParts = [];
    blocks.forEach((part) => {
      if (rulePattern.test(part) && part.length <= 1200) systemParts.push(part);
      else contextParts.push(part);
    });
    if (systemParts.length) byId("system-prompt-input").value = systemParts.join("\\n\\n");
    if (contextParts.length) byId("global-context-input").value = contextParts.join("\\n\\n");
    if (contextParts.length) renderContextItems(makeContextItemsFromBlocks(contextParts));
    renderPromptContextStatus("\u5df2\u62c6\u5206\uff0c\u5f85\u4fdd\u5b58");
  }

  function classifyContextItemsDraft() {
    const raw = (byId("prompt-splitter-input").value || byId("global-context-input").value).trim();
    if (!raw) return;
    const blocks = raw.split(/\\n\\s*\\n/).map((part) => part.trim()).filter(Boolean);
    renderContextItems(makeContextItemsFromBlocks(blocks));
    byId("context-on-demand").checked = true;
    renderPromptContextStatus("\u5df2\u751f\u6210\u7247\u6bb5\uff0c\u5f85\u4fdd\u5b58");
  }

  function makeContextItemsFromBlocks(blocks) {
    return blocks.map(function(part, index) {
      const title = (part.split("\\n")[0] || ("Context " + (index + 1))).replace(/^#+\\s*/, "").slice(0, 80);
      const words = (part.toLowerCase().match(/[a-z][a-z0-9_-]{3,}|[\u4e00-\u9fa5]{2,}/g) || [])
        .filter((word, i, arr) => arr.indexOf(word) === i)
        .slice(0, 8);
      return { enabled: true, title, keywords: words, clients: [], models: [], priority: 0, max_chars: 1200, text: part };
    });
  }

  async function refreshModels() {
    const resp = await fetch(API_BASE + "/refresh", { method: "POST" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u5237\u65b0\u5931\u8d25");
    const summary = (payload.result || []).map((r) => r.name + ":" + r.model_count).join(", ");
    showToast("\u6a21\u578b\u7f13\u5b58\u5df2\u5237\u65b0");
    byId("config-status").textContent = "\u2713 \u5df2\u5237\u65b0 " + summary;
    setTimeout(() => byId("config-status").textContent = "", 5000);
  }

  async function checkHealth() {
    const dots = document.querySelectorAll(".health-dot");
    dots.forEach((d) => { d.className = "health-dot checking"; d.title = "\u68c0\u67e5\u4e2d..."; });
    updateUpstreamGroupHealth();
    const resp = await fetch(API_BASE + "/health", { method: "POST" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u5065\u5eb7\u5ea6\u68c0\u67e5\u5931\u8d25");
    (payload.results || []).forEach((r) => {
      const dot = document.querySelector('.health-dot[data-upstream="' + r.name + '"]');
      if (!dot) return;
      dot.className = "health-dot " + (r.ok ? "ok" : "fail");
      dot.title = r.ok ? ("HTTP " + r.status + ", " + r.latency_ms + "ms") : ("\u5931\u8d25: " + (r.error || ("HTTP " + r.status)) + ", " + r.latency_ms + "ms");
    });
    const ok = (payload.results || []).filter((r) => r.ok).length;
    const total = (payload.results || []).length;
    updateUpstreamGroupHealth();
    showToast("\u5065\u5eb7\u5ea6: " + ok + "/" + total + " \u6b63\u5e38");
  }

  function updateUpstreamGroupHealth() {
    document.querySelectorAll(".upstream-group").forEach((group) => {
      const status = group.querySelector(".upstream-group-health");
      if (!status) return;
      const dots = [...group.querySelectorAll(".health-dot")];
      const ok = dots.filter((dot) => dot.classList.contains("ok")).length;
      const fail = dots.filter((dot) => dot.classList.contains("fail")).length;
      if (dots.some((dot) => dot.classList.contains("checking"))) status.textContent = "\u2026 \u68c0\u67e5\u4e2d";
      else if (!ok && !fail) status.textContent = "\u25cb \u672a\u68c0\u67e5";
      else if (!fail) status.textContent = "\u2705 " + ok + "/" + dots.length + " \u6b63\u5e38";
      else if (!ok) status.textContent = "\u274c 0/" + dots.length + " \u6b63\u5e38";
      else status.textContent = "\u26a0 " + ok + "/" + dots.length + " \u6b63\u5e38";
    });
  }

  async function loadRuntimeStatus() {
    const resp = await fetch(API_BASE + "/runtime");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) return;
    const active = payload.active_upstreams || {};
    const last = payload.last_successful_upstream || "";
    document.querySelectorAll(".upstream-status-emoji").forEach(function(el) {
      const card = el.closest(".upstream-card");
      const name = el.dataset.upstream;
      if (card && card.classList.contains("disabled")) {
        el.textContent = "\u26d4";
        el.title = "\u5df2\u505c\u7528";
      } else if (Number(active[name] || 0) > 0) {
        el.textContent = "\u26a1";
        el.title = "\u6b63\u5728\u8bf7\u6c42: " + active[name];
      } else if (name && name === last) {
        el.textContent = "\u2705";
        el.title = "\u4e0a\u6b21\u6210\u529f\u4f7f\u7528";
      } else {
        el.textContent = "";
        el.title = "";
      }
    });
    updateUpstreamGroupActive(active);
    const nim = payload.nim_rpm || {};
    document.querySelectorAll(".nim-rpm").forEach(function(el) {
      const item = nim[el.dataset.upstream];
      const countEl = el.querySelector(".nim-rpm-count");
      const timerEl = el.querySelector(".nim-rpm-timer");
      if (!item) {
        if (countEl) countEl.textContent = "NIM 0/40";
        if (timerEl) timerEl.hidden = true;
        el.title = "\u5c1a\u672a\u5f00\u59cb\u8ba1\u65f6";
        return;
      }
      const seconds = Math.max(0, Math.ceil(Number(item.reset_in_ms || 0) / 1000));
      if (countEl) countEl.textContent = "NIM " + item.count + "/" + item.limit;
      if (timerEl) {
        timerEl.hidden = false;
        timerEl.textContent = " · " + seconds + "s";
      }
      el.title = seconds + "s \u540e\u6e05\u96f6";
    });
  }

  function updateUpstreamGroupActive(active) {
    const now = Date.now();
    document.querySelectorAll(".upstream-group").forEach(function(group) {
      const el = group.querySelector(".upstream-group-active");
      if (!el) return;
      const names = [...group.querySelectorAll(".upstream-status-emoji")]
        .map((item) => item.dataset.upstream)
        .filter((name) => name && Number(active[name] || 0) > 0);
      if (names.length) {
        const textValue = "\u26a1 \u6d3b\u8dc3: " + names.join(", ");
        el.textContent = textValue;
        group.dataset.activeText = textValue;
        group.dataset.activeUntil = String(now + 30000);
        return;
      }
      if (Number(group.dataset.activeUntil || 0) > now && group.dataset.activeText) {
        el.textContent = group.dataset.activeText;
      } else {
        el.textContent = "";
        delete group.dataset.activeText;
        delete group.dataset.activeUntil;
      }
    });
  }

  async function speedTest() {
    const picker = state.speedPicker;
    if (!picker || !picker.model || !picker.upstream) return;
    const resp = await fetch(API_BASE + "/speed-test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: picker.model, upstreams: [picker.upstream] }),
    });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u6d4b\u901f\u5931\u8d25");
    (payload.results || []).forEach((r) => {
      const dot = document.querySelector('.health-dot[data-upstream="' + r.name + '"]');
      if (!dot) return;
      dot.className = "health-dot " + (r.ok ? "ok" : "fail");
      dot.title = (r.ok ? "\u9996\u8f93\u51fa " : "\u6d4b\u901f\u5931\u8d25 ") + (r.error || ("HTTP " + r.status)) + ", " + r.latency_ms + "ms";
    });
    const best = (payload.results || []).filter((r) => r.ok).sort((a,b) => a.latency_ms - b.latency_ms)[0];
    showToast(best ? ("\u6700\u5feb: " + best.name + " " + best.latency_ms + "ms") : "\u6ca1\u6709\u4e0a\u6e38\u901a\u8fc7\u6d4b\u901f");
    byId("speed-picker-status").textContent = best
      ? best.name + " · \u9996\u8f93\u51fa " + best.latency_ms + "ms"
      : ((payload.results || [])[0]?.error || "\u6d4b\u901f\u5931\u8d25");
  }

  async function detectCapability(upstreamName) {
    const resp = await fetch(API_BASE + "/upstreams/" + encodeURIComponent(upstreamName) + "/detect", { method: "POST" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u68c0\u6d4b\u5931\u8d25");
    const badge = document.querySelector('.capability-badge[data-upstream="' + upstreamName + '"]');
    if (badge) {
      badge.textContent = payload.capability === "openai" ? "\u2713 OpenAI" : "Claude";
    }
    showToast(upstreamName + ": " + (payload.capability === "openai" ? "OpenAI Compatible (chat+embeddings)" : "Claude Compatible (chat only)") + ", " + payload.latency_ms + "ms");
  }

  async function fetchModels(payload) {
    const resp = await fetch(API_BASE + "/fetch-models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(data?.error?.message || data?.error || "\u83b7\u53d6\u6a21\u578b\u5931\u8d25");
    return data.models || [];
  }

  async function fetchUpstreamModels(upstreamName, card) {
    const payload = { name: upstreamName };
    if (card) {
      payload.account_id = card.querySelector('[data-field="account_id"]')?.value.trim() || "";
      payload.api_key = card.querySelector('[data-field="api_key_value"]')?.value.trim() || "";
      payload.base_url = card.querySelector('[data-field="base_url"]')?.value.trim() || "";
      payload.preset = card.querySelector('[data-field="preset"]')?.value || "";
    }
    return fetchModels(payload);
  }

  async function fetchDraftUpstreamModels() {
    const baseUrl = byId("vendor-base-url").value.trim();
    const apiKey = byId("vendor-api-key").value.trim();
    const presetId = state.draftPresetId || "custom";
    const accountId = byId("vendor-account-id").value.trim();
    if (presetNeedsAccountId(presetId) && !accountId) throw new Error("Account ID \u4e0d\u80fd\u4e3a\u7a7a");
    if (!baseUrl) throw new Error("Base URL \u4e0d\u80fd\u4e3a\u7a7a");
    if (!apiKey) throw new Error("API Key \u4e0d\u80fd\u4e3a\u7a7a");
    return fetchModels({ account_id: accountId, base_url: baseUrl, api_key: apiKey, preset: presetId });
  }

  function titleParts(parts) {
    return parts.filter(Boolean).map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(" ") || "Other";
  }

  function modelDisplayName(model) {
    const value = text(model);
    return value.startsWith("@cf/") ? value.slice(4) : value;
  }

  function statModelSuffix(model) {
    const value = modelDisplayName(model);
    const parts = value.split("/");
    return parts[parts.length - 1] || value;
  }

  function statTipHtml(bucket, kind) {
    const hour = esc(bucket.hour || "");
    if (kind === "tokens") {
      return '<div class="stat-tip-title">时间段 ' + hour + '</div>' +
        '<div class="stat-tip-row"><span>总 Input</span><span class="stat-tip-value">' + esc((bucket.prompt_tokens || 0).toLocaleString()) + '</span></div>' +
        '<div class="stat-tip-row"><span>总 Output</span><span class="stat-tip-value">' + esc((bucket.completion_tokens || 0).toLocaleString()) + '</span></div>';
    }

    const statuses = bucket.model_statuses || {};
    const statusEntries = Object.entries(statuses).sort(function(a, b) {
      const av = (a[1]?.success || 0) + (a[1]?.fail || 0);
      const bv = (b[1]?.success || 0) + (b[1]?.fail || 0);
      return bv - av;
    });
    const fallbackEntries = Object.entries(bucket.models || {}).sort(function(a, b) { return b[1] - a[1]; });
    const entries = (statusEntries.length ? statusEntries : fallbackEntries).slice(0, 8);
    const more = (statusEntries.length || fallbackEntries.length) - entries.length;
    const rows = entries.length ? entries.map(function(entry) {
      const value = statusEntries.length
        ? ((entry[1]?.success || 0) + ' 成 / ' + (entry[1]?.fail || 0) + ' 败')
        : (entry[1] + ' 次');
      return '<div class="stat-tip-row"><span class="stat-tip-model">' + esc(statModelSuffix(entry[0])) + '</span><span class="stat-tip-value">' + esc(value) + '</span></div>';
    }).join("") : '<div class="stat-tip-row"><span>暂无模型</span><span class="stat-tip-value">-</span></div>';
    return '<div class="stat-tip-title">时间段 ' + hour + '</div>' +
      '<div class="stat-tip-row"><span>总成功/失败</span><span class="stat-tip-value">' + esc(bucket.success || 0) + ' / ' + esc(bucket.fail || 0) + '</span></div>' +
      rows +
      (more > 0 ? '<div class="stat-tip-row"><span>其他模型</span><span class="stat-tip-value">+' + esc(more) + '</span></div>' : '');
  }

  function placeStatTip(event, anchor) {
    const tip = byId("stat-tip");
    if (!tip || tip.hidden) return;
    const rect = anchor ? anchor.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const point = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? { x: event.clientX, y: event.clientY }
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const gap = 12;
    const tipRect = tip.getBoundingClientRect();
    let x = point.x + gap;
    let y = point.y + gap;
    if (x + tipRect.width + gap > window.innerWidth) x = Math.max(gap, window.innerWidth - tipRect.width - gap);
    if (y + tipRect.height + gap > window.innerHeight) y = Math.max(gap, point.y - tipRect.height - gap);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function showStatTip(event, bucket, kind, anchor) {
    const tip = byId("stat-tip");
    if (!tip || !bucket) return;
    tip.innerHTML = statTipHtml(bucket, kind);
    tip.hidden = false;
    placeStatTip(event, anchor);
  }

  function hideStatTip() {
    const tip = byId("stat-tip");
    if (tip) tip.hidden = true;
  }

  function bindStatBars(buckets) {
    document.querySelectorAll(".chart-bar .bar-hit[data-stat-kind]").forEach(function(bar) {
      const bucket = buckets[Number(bar.dataset.statIndex)];
      const kind = bar.dataset.statKind;
      bar.addEventListener("mouseenter", function(event) { showStatTip(event, bucket, kind, bar); });
      bar.addEventListener("mousemove", function(event) { placeStatTip(event, bar); });
      bar.addEventListener("mouseleave", hideStatTip);
      bar.addEventListener("focus", function(event) { showStatTip(event, bucket, kind, bar); });
      bar.addEventListener("blur", hideStatTip);
      bar.addEventListener("click", function(event) {
        event.stopPropagation();
        showStatTip(event, bucket, kind, bar);
      });
    });
  }

  function modelSourceName(model) {
    const value = modelDisplayName(model);
    const raw = value.includes("/") ? value.split("/")[0] : "";
    if (!raw) return "Other";
    const cleaned = raw.replace(/[-_](ai|labs?|inc|org)$/i, "");
    return titleParts(cleaned.split(/[-_.]+/));
  }

  function modelFamilyName(model) {
    const value = modelDisplayName(model);
    const raw = value.includes("/") ? value.split("/").slice(1).join("/") : value;
    const parts = raw.split(/[\/_-]+/).filter(Boolean);
    if (!parts.length) return "Other";
    const second = parts[1] || "";
    const family = second && !/^\d+(?:\.\d+)?[bkmt]?$/i.test(second) ? parts.slice(0, 2) : parts.slice(0, 1);
    return titleParts(family);
  }

  const MODEL_TAGS = [
    { id: "chat", label: "\u804a\u5929" },
    { id: "text", label: "\u5355\u6a21\u6001" },
    { id: "vision", label: "\u591a\u6a21\u6001" },
    { id: "tools", label: "\u5de5\u5177\u8c03\u7528" },
    { id: "thinking", label: "\u63a8\u7406" },
    { id: "agentic", label: "Agentic" },
  ];
  const EXCLUSIVE_MODEL_TAGS = [["text", "vision"]];

  function modelTags(model) {
    const value = modelDisplayName(model).toLowerCase();
    const tags = ["chat"];
    const vision = /(^|[\/_.-])(vl|vision|visual|image|multimodal|omni|pixtral|gemini|gpt-4o|qwen2(?:\.5)?-vl)([\/_.-]|$)/i.test(value);
    tags.push(vision ? "vision" : "text");
    if (/(function|tool|fc|tools?|gpt-|claude|gemini|qwen|glm|llama-3|mistral|mixtral|deepseek|codestral|coder|codegemma)/i.test(value)) tags.push("tools");
    if (/(^|[\/_.-])(r1|r1t|reason|reasoning|reasoner|think|thinking|qwq|marco|o1|o3|o4|grok-4|sonar-reasoning|deepseek-v3\.1|deepseek-v4|deepseek-r1|deepseek-reasoner|qwen3|glm|kimi-k2)([\/_.-]|$)/i.test(value)) tags.push("thinking");
    if (/(agent|agentic|computer-use|operator|claude|gpt-|gemini|qwen.*coder|glm|coder|codegemma|codestral|deepseek-coder|devstral|swe|opus|sonnet)/i.test(value)) tags.push("agentic");
    return tags;
  }

  function renderModelTags(model) {
    const tags = modelTags(model);
    return '<span class="model-tags">' + MODEL_TAGS.filter(function(tag) {
      return tags.includes(tag.id);
    }).map(function(tag) {
      return '<span class="model-tag">' + esc(tag.label) + '</span>';
    }).join("") + '</span>';
  }

  function showModelPicker(upstreamName, models, target, sourceCard) {
    const unique = Array.from(new Set((models || []).filter(Boolean))).sort();
    state.modelPicker = {
      title: upstreamName || "\u5f53\u524d\u4e0a\u6e38",
      models: unique,
      group: "__all__",
      family: "__all__",
      tags: new Set(),
      selected: new Set(splitList(target.value)),
      sourceCard: sourceCard || null,
      target,
      visible: unique,
    };
    byId("model-picker-search").value = "";
    byId("picker-apply-same-preset").checked = false;
    byId("model-picker-modal").classList.add("open");
    renderModelPicker();
  }

  function toggleModelTag(picker, tag) {
    if (tag === "__all__") {
      picker.tags.clear();
      return;
    }
    if (picker.tags.has(tag)) {
      picker.tags.delete(tag);
      return;
    }
    EXCLUSIVE_MODEL_TAGS.forEach(function(group) {
      if (group.includes(tag)) group.forEach(function(item) { picker.tags.delete(item); });
    });
    picker.tags.add(tag);
  }

  function renderModelPicker() {
    const picker = state.modelPicker;
    if (!picker) return;
    if (!picker.tags) picker.tags = new Set();
    const query = byId("model-picker-search").value.trim().toLowerCase();
    const groups = {};
    picker.models.forEach(function(model) {
      const group = modelSourceName(model);
      const family = modelFamilyName(model);
      if (!groups[group]) groups[group] = { models: [], families: {} };
      groups[group].models.push(model);
      if (!groups[group].families[family]) groups[group].families[family] = [];
      groups[group].families[family].push(model);
    });

    const groupNames = Object.keys(groups).sort();
    if (picker.group !== "__all__" && !groups[picker.group]) picker.group = "__all__";
    const families = picker.group === "__all__" ? {} : groups[picker.group].families;
    const familyNames = Object.keys(families).sort();
    if (picker.family !== "__all__" && !families[picker.family]) picker.family = "__all__";
    const sourceModels = picker.group === "__all__"
      ? picker.models
      : (picker.family === "__all__" ? groups[picker.group].models : families[picker.family]);
    picker.visible = sourceModels.filter(function(model) {
      const tags = modelTags(model);
      const tagOk = !picker.tags.size || Array.from(picker.tags).every(function(tag) { return tags.includes(tag); });
      const queryOk = !query || model.toLowerCase().includes(query) || modelDisplayName(model).toLowerCase().includes(query);
      return tagOk && queryOk;
    });

    byId("model-picker-title").textContent = "\u9009\u62e9\u6a21\u578b - " + picker.title;
    byId("picker-count").textContent = "\u5df2\u9009 " + picker.selected.size + " / " + picker.models.length;
    byId("picker-same-preset-wrap").hidden = !picker.sourceCard;
    byId("model-tag-filter").innerHTML =
      '<button type="button" class="small secondary' + (!picker.tags.size ? ' active' : '') + '" data-tag="__all__">' + (!picker.tags.size ? '\u2705 ' : '') + '\u5168\u90e8\u6807\u7b7e</button>' +
      MODEL_TAGS.map(function(tag) {
        const active = picker.tags.has(tag.id);
        return '<button type="button" class="small secondary' + (active ? ' active' : '') + '" data-tag="' + esc(tag.id) + '">' + (active ? '\u2705 ' : '') + esc(tag.label) + '</button>';
      }).join("");
    byId("model-picker-groups").innerHTML =
      '<button type="button" class="model-group-btn' + (picker.group === "__all__" ? ' active' : '') + '" data-group="__all__"><span>\u5168\u90e8</span><span>' + picker.models.length + '</span></button>' +
      groupNames.map(function(name) {
        return '<button type="button" class="model-group-btn' + (picker.group === name ? ' active' : '') + '" data-group="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + groups[name].models.length + '</span></button>';
      }).join("");
    byId("model-picker-subgroups").innerHTML = picker.group === "__all__"
      ? '<div class="note" style="padding:8px">\u9009\u62e9\u6765\u6e90\u540e\u7ec6\u5206</div>'
      : '<button type="button" class="model-group-btn' + (picker.family === "__all__" ? ' active' : '') + '" data-family="__all__"><span>\u5168\u90e8</span><span>' + groups[picker.group].models.length + '</span></button>' +
        familyNames.map(function(name) {
          return '<button type="button" class="model-group-btn' + (picker.family === name ? ' active' : '') + '" data-family="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + families[name].length + '</span></button>';
        }).join("");

    byId("model-picker-list").innerHTML = picker.visible.length
      ? picker.visible.map(function(model) {
          return '<label class="model-row" title="' + esc(model) + '"><input type="checkbox" class="model-pick" value="' + esc(model) + '"' + (picker.selected.has(model) ? ' checked' : '') + '><span class="mono">' + esc(modelDisplayName(model)) + '</span>' + renderModelTags(model) + '</label>';
        }).join("")
      : '<div class="note" style="padding:12px">\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b</div>';

    byId("model-tag-filter").querySelectorAll("[data-tag]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        toggleModelTag(picker, btn.dataset.tag);
        renderModelPicker();
      });
    });
    byId("model-picker-groups").querySelectorAll(".model-group-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.group = btn.dataset.group;
        picker.family = "__all__";
        renderModelPicker();
      });
    });
    byId("model-picker-subgroups").querySelectorAll(".model-group-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.family = btn.dataset.family;
        renderModelPicker();
      });
    });
    byId("model-picker-list").querySelectorAll(".model-pick").forEach(function(cb) {
      cb.addEventListener("change", function() {
        if (cb.checked) picker.selected.add(cb.value);
        else picker.selected.delete(cb.value);
        byId("picker-count").textContent = "\u5df2\u9009 " + picker.selected.size + " / " + picker.models.length;
      });
    });
  }

  function closeModelPicker() {
    state.modelPicker = null;
    byId("model-picker-modal").classList.remove("open");
  }

  function selectVisibleModels(selected) {
    const picker = state.modelPicker;
    if (!picker) return;
    picker.visible.forEach(function(model) {
      if (selected) picker.selected.add(model);
      else picker.selected.delete(model);
    });
    renderModelPicker();
  }

  function applyModelPicker() {
    const picker = state.modelPicker;
    if (!picker || !picker.target) return;
    const picked = Array.from(picker.selected).sort();
    picker.target.value = picked.join(picker.target.tagName === "TEXTAREA" ? "\\n" : ", ");
    if (picker.sourceCard) renderModelEditor(picker.sourceCard);
    if (picker.sourceCard && byId("picker-apply-same-preset").checked) {
      const preset = picker.sourceCard.querySelector('[data-field="preset"]')?.value || "";
      document.querySelectorAll(".upstream-card").forEach(function(card) {
        if (card.querySelector('[data-field="preset"]')?.value === preset) {
          card.querySelector('[data-field="models"]').value = picked.join("\\n");
          renderModelEditor(card);
        }
      });
    }
    closeModelPicker();
    showToast("\u5df2\u5bfc\u5165 " + picked.length + " \u4e2a\u6a21\u578b");
  }

  function openSpeedPicker() {
    const upstreams = collectConfig().upstreams
      .filter((upstream) => upstream.enabled !== false)
      .map((upstream) => ({ ...upstream, models: (upstream.models || []).filter((model) => model && model !== "*") }))
      .filter((upstream) => upstream.models.length);
    if (!upstreams.length) throw new Error("\u6ca1\u6709\u53ef\u6d4b\u901f\u7684\u4e0a\u6e38\u6a21\u578b\uff0c\u5148\u7ed9\u4e0a\u6e38\u5bfc\u5165\u6216\u586b\u5199\u6a21\u578b");
    state.speedPicker = {
      upstreams,
      upstream: upstreams[0].name,
      group: "__all__",
      model: upstreams[0].models[0],
      visible: upstreams[0].models,
    };
    byId("speed-picker-search").value = "";
    byId("speed-picker-status").textContent = "";
    byId("speed-picker-modal").classList.add("open");
    renderSpeedPicker();
  }

  function closeSpeedPicker() {
    state.speedPicker = null;
    byId("speed-picker-modal").classList.remove("open");
  }

  function renderSpeedPicker() {
    const picker = state.speedPicker;
    if (!picker) return;
    const upstream = picker.upstreams.find((item) => item.name === picker.upstream) || picker.upstreams[0];
    picker.upstream = upstream.name;
    const groups = {};
    upstream.models.forEach(function(model) {
      const group = modelSourceName(model);
      if (!groups[group]) groups[group] = [];
      groups[group].push(model);
    });
    const groupNames = Object.keys(groups).sort();
    if (picker.group !== "__all__" && !groups[picker.group]) picker.group = "__all__";
    const sourceModels = picker.group === "__all__" ? upstream.models : groups[picker.group];
    const query = byId("speed-picker-search").value.trim().toLowerCase();
    picker.visible = sourceModels.filter(function(model) {
      return !query || model.toLowerCase().includes(query) || modelDisplayName(model).toLowerCase().includes(query);
    });
    if (!picker.visible.includes(picker.model)) picker.model = picker.visible[0] || "";

    byId("speed-picker-upstreams").innerHTML = picker.upstreams.map(function(item) {
      return '<button type="button" class="model-group-btn' + (picker.upstream === item.name ? ' active' : '') + '" data-upstream="' + esc(item.name) + '"><span>' + esc(item.note || item.name) + '</span><span>' + item.models.length + '</span></button>';
    }).join("");
    byId("speed-picker-groups").innerHTML =
      '<button type="button" class="model-group-btn' + (picker.group === "__all__" ? ' active' : '') + '" data-group="__all__"><span>\u5168\u90e8</span><span>' + upstream.models.length + '</span></button>' +
      groupNames.map(function(name) {
        return '<button type="button" class="model-group-btn' + (picker.group === name ? ' active' : '') + '" data-group="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + groups[name].length + '</span></button>';
      }).join("");
    byId("speed-picker-models").innerHTML = picker.visible.length
      ? picker.visible.map(function(model) {
          return '<button type="button" class="model-row' + (picker.model === model ? ' active' : '') + '" data-model="' + esc(model) + '" title="' + esc(model) + '"><span class="mono">' + esc(modelDisplayName(model)) + '</span></button>';
        }).join("")
      : '<div class="note" style="padding:12px">\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b</div>';

    byId("speed-picker-upstreams").querySelectorAll("[data-upstream]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.upstream = btn.dataset.upstream;
        picker.group = "__all__";
        const next = picker.upstreams.find((item) => item.name === picker.upstream);
        picker.model = next && next.models[0] || "";
        renderSpeedPicker();
      });
    });
    byId("speed-picker-groups").querySelectorAll("[data-group]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.group = btn.dataset.group;
        renderSpeedPicker();
      });
    });
    byId("speed-picker-models").querySelectorAll("[data-model]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.model = btn.dataset.model;
        renderSpeedPicker();
      });
    });
  }

  async function loadStats(silent) {
    const resp = await fetch(API_BASE + "/stats");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "读取统计失败");
    const buckets = payload.buckets || [];

    const skeleton = buckets;

    // Aggregate totals
    var total = 0, success = 0, fail = 0, pt = 0, ct = 0;
    skeleton.forEach(function(b) { total += b.total; success += b.success; fail += b.fail; pt += b.prompt_tokens; ct += b.completion_tokens; });
    byId("stat-total").textContent = total;
    byId("stat-success").textContent = success;
    byId("stat-fail").textContent = fail;
    byId("stat-pt").textContent = pt.toLocaleString();
    byId("stat-ct").textContent = ct.toLocaleString();
    // ponytail: track session cumulative (what this page load has seen)
    state.sessionInputTokens = Math.max(state.sessionInputTokens, pt);
    state.sessionOutputTokens = Math.max(state.sessionOutputTokens, ct);
    byId("stat-pt-session").textContent = state.sessionInputTokens.toLocaleString();
    byId("stat-ct-session").textContent = state.sessionOutputTokens.toLocaleString();

    // Last model
    var currentModel = payload.last_model || "";
    var lastBucket = skeleton.slice().reverse().find(function(b) { return b.total > 0; });
    if (!currentModel && lastBucket && lastBucket.models) {
      var topModel = Object.entries(lastBucket.models).sort(function(a,b){return b[1]-a[1];})[0];
      currentModel = topModel ? topModel[0] : "";
    }
    byId("stat-current-model").textContent = currentModel;

    // Chart 1: Requests (green=success, red=fail)
    var maxReq = 1;
    skeleton.forEach(function(b) { if (b.total > maxReq) maxReq = b.total; });
    byId("chart-requests").innerHTML = skeleton.map(function(b, i) {
      var barH = Math.max(2, Math.round(b.total / maxReq * 100));
      var seg = "";
      if (b.total > 0) {
        var okH = Math.max(1, Math.round(b.success / b.total * barH));
        var failH = barH - okH;
        seg = '<div style="height:' + okH + 'px;background:var(--accent);border-radius:2px 2px 0 0"></div>';
        if (failH > 0) seg += '<div style="height:' + failH + 'px;background:#8d2f23"></div>';
      }
      return '<div class="bar-hit" data-h="' + esc((b.hour || "").slice(-2)) + '" data-stat-kind="requests" data-stat-index="' + i + '" tabindex="0" aria-label="' + esc((b.hour || "") + ': ' + b.success + ' success / ' + b.fail + ' fail') + '"><div class="bar' + (b.fail > 0 && b.success === 0 ? ' fail' : '') + '" style="height:' + barH + 'px;flex-direction:column;display:flex;justify-content:flex-end">' + seg + '</div></div>';
    }).join("");

    // Chart 2: Tokens (indigo=input, violet=output)
    var maxTok = 1;
    skeleton.forEach(function(b) { var t = b.prompt_tokens + b.completion_tokens; if (t > maxTok) maxTok = t; });
    byId("chart-tokens").innerHTML = skeleton.map(function(b, i) {
      var tok = b.prompt_tokens + b.completion_tokens;
      var barH = Math.max(2, Math.round(tok / maxTok * 100));
      var seg = "";
      if (tok > 0) {
        var inH = Math.max(1, Math.round(b.prompt_tokens / tok * barH));
        var outH = barH - inH;
        seg = '<div style="height:' + inH + 'px;background:#6366f1;border-radius:2px 2px 0 0"></div>';
        if (outH > 0) seg += '<div style="height:' + outH + 'px;background:#a78bfa"></div>';
      }
      return '<div class="bar-hit" data-h="' + esc((b.hour || "").slice(-2)) + '" data-stat-kind="tokens" data-stat-index="' + i + '" tabindex="0" aria-label="' + esc((b.hour || "") + ': ' + b.prompt_tokens + ' input / ' + b.completion_tokens + ' output tokens') + '"><div class="bar" style="height:' + barH + 'px;flex-direction:column;display:flex;justify-content:flex-end">' + seg + '</div></div>';
    }).join("");
    bindStatBars(skeleton);

    byId("stat-updated").textContent = (payload.now || "").slice(11, 19) + " HKT";
    if (!silent) showToast("统计已加载");
  }

  async function loadLogs() {
    const resp = await fetch(API_BASE + "/logs");
    const payload = await parseApiResponse(resp);
    const logs = payload.logs || [];
    state.logs = logs;
    byId("live-log").innerHTML = logs.length
      ? logs.slice(0, 20).map((l) =>
          '<div class="log-row">' +
            '<span class="log-badge ' + (l.status < 400 ? 'ok' : 'err') + '">' + esc(l.status) + '</span>' +
            '<strong>' + esc(l.upstream) + '</strong>' +
            '<span class="note">' + esc(l.model) + '</span>' +
            '<span class="note">' + esc(l.latency_ms + "ms") + '</span>' +
            '<span class="note">' + esc((l.prompt_tokens || 0) + (l.completion_tokens || 0) + " tk") + '</span>' +
            '</div>'
        ).join("")
      : '<div class="note">\u6682\u65e0\u8bf7\u6c42\u8bb0\u5f55</div>';
    renderLogs(logs);
  }

  /* ---- Logs ---- */
  
  function streamDiag(l) {
    if (!l || l.time_to_first_byte_ms == null) return "";
    return "B" + (l.time_to_first_byte_ms || 0) + "/T" + (l.time_to_first_token_ms || 0) + "/G" + (l.max_stream_gap_ms || 0) + " " + (l.close_reason || "") + (l.finish_reason ? "/" + l.finish_reason : "");
  }

  function toolDiag(l) {
    return (Number(l?.tools_count || 0)) + "/" + (Number(l?.tool_calls_count || 0));
  }

  function filterLogs(logs) {
    if (state.logFilter === "stream") return logs.filter((l) => l.time_to_first_byte_ms != null);
    if (state.logFilter === "error") return logs.filter((l) => Number(l.status || 0) >= 400 || l.close_reason === "error");
    if (state.logFilter === "slow") return logs.filter((l) => Number(l.max_stream_gap_ms || 0) >= 30000);
    return logs;
  }

  function renderLogs(logs) {
    if (!logs.length) {
      byId("log-list").innerHTML = '<div class="note">\u6682\u65e0\u8c03\u7528\u8bb0\u5f55\u3002</div>';
      byId("token-total").textContent = "";
      return;
    }
    const filtered = filterLogs(logs);
    const visibleLogs = state.logExpanded ? filtered : filtered.slice(0, 5);
    const toggle = filtered.length > 5
      ? '<button type="button" class="small secondary" id="toggle-log-expanded">' + (state.logExpanded ? '\u6536\u8d77' : '\u5c55\u5f00\u5168\u90e8 ' + filtered.length + ' \u6761') + '</button>'
      : "";
    const totalPrompt = logs.reduce((s, l) => s + (l.prompt_tokens || 0), 0);
    const totalCompletion = logs.reduce((s, l) => s + (l.completion_tokens || 0), 0);
    byId("token-total").textContent = "\u603b\u8ba1: " + totalPrompt + " input / " + totalCompletion + " output (" + logs.length + " \u8bf7\u6c42)";

    const filters = [
      ["all", "\u5168\u90e8"],
      ["stream", "\u6d41\u5f0f"],
      ["error", "\u5f02\u5e38"],
      ["slow", "\u6162\u95f4\u9694"],
    ].map((item) => '<button type="button" class="small secondary log-filter' + (state.logFilter === item[0] ? ' active' : '') + '" data-log-filter="' + item[0] + '">' + item[1] + '</button>').join("");
    byId("log-list").innerHTML = '<div class="log-tools">' + filters + '<span class="note">' + filtered.length + '/' + logs.length + '</span>' + toggle + '</div>' +
    (filtered.length ? '<table class="log-table"><thead><tr>' +
      '<th>\u65f6\u95f4</th><th>\u5ba2\u6237\u7aef</th><th>\u4e0a\u6e38</th><th>\u6a21\u578b</th><th>\u63a5\u53e3</th><th>\u72b6\u6001</th><th>\u5ef6\u8fdf</th><th>Stream</th><th>Tools</th><th>Tokens</th>' +
    '</tr></thead><tbody>' +
    visibleLogs.map((l) => '<tr>' +
      '<td>' + esc((l.ts || "").slice(11, 19)) + '</td>' +
      '<td>' + esc(l.client || "") + '</td>' +
      '<td>' + esc(l.upstream || "") + '</td>' +
      '<td class="mono">' + esc(l.model || "") + '</td>' +
      '<td class="mono">' + esc((l.path || "").replace("/v1/", "")) + '</td>' +
      '<td class="' + (l.status < 400 ? 'ok' : 'err') + '">' + esc(l.status) + '</td>' +
      '<td>' + esc(l.latency_ms) + 'ms</td>' +
      '<td class="mono">' + esc(streamDiag(l)) + '</td>' +
      '<td class="mono">' + esc(toolDiag(l)) + '</td>' +
      '<td>' + esc(l.prompt_tokens || 0) + '/' + esc(l.completion_tokens || 0) + '</td>' +
    '</tr>').join("") +
    '</tbody></table>' : '<div class="note">\u5f53\u524d\u7b5b\u9009\u65e0\u8bb0\u5f55</div>');
    byId("log-list").querySelectorAll("[data-log-filter]").forEach((btn) => btn.addEventListener("click", () => {
      state.logFilter = btn.dataset.logFilter || "all";
      state.logExpanded = false;
      renderLogs(state.logs);
    }));
    byId("toggle-log-expanded")?.addEventListener("click", () => {
      state.logExpanded = !state.logExpanded;
      renderLogs(state.logs);
    });
  }

  /* ---- Clients ---- */
  async function loadClients() {
    const resp = await fetch(API_BASE + "/clients");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u8bfb\u53d6\u5ba2\u6237\u7aef\u5931\u8d25");
    state.clients = payload;
    renderClients();
    renderPromptClientScopes();
  }

  function renderClients() {
    const host = byId("client-list");
    if (!state.clients.length) {
      host.innerHTML = '<div class="note">\u8fd8\u6ca1\u6709\u5ba2\u6237\u7aef Key\uff0c\u70b9\u201c\u751f\u6210 Key\u201d\u521b\u5efa\u3002</div>';
      return;
    }
    host.innerHTML = state.clients.map((c) =>
      '<div class="client-item">' +
        '<div class="client-meta">' +
          '<strong>' + esc(c.name) + '</strong>' +
          '<span class="mono">' + esc(c.key_preview || "") + '</span>' +
          '<div class="client-model-editor">' +
            '<input class="mono" data-client-models="' + esc(c.id) + '" value="' + esc((c.models || []).join(", ") || "*") + '" aria-label="\u5141\u8bb8\u6a21\u578b">' +
            '<button type="button" class="small secondary" data-client-save="' + esc(c.id) + '">\u4fdd\u5b58\u6a21\u578b</button>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="danger small" data-client-id="' + esc(c.id) + '">\u5220\u9664</button>' +
      '</div>'
    ).join("");
    host.querySelectorAll("button[data-client-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await withButtonBusy(btn, "\u5220\u9664\u4e2d...", async () => {
          await deleteClient(btn.dataset.clientId);
          showToast("\u5df2\u5220\u9664\u5ba2\u6237\u7aef");
        });
      });
    });
    host.querySelectorAll("button[data-client-save]").forEach((btn) => {
      btn.addEventListener("click", () => withButtonBusy(btn, "\u4fdd\u5b58\u4e2d...", async () => {
        const id = btn.dataset.clientSave;
        const input = host.querySelector('[data-client-models="' + CSS.escape(id) + '"]');
        await updateClientModels(id, splitList(input?.value || ""));
        showToast("\u5df2\u66f4\u65b0\u6a21\u578b\u6743\u9650");
      }).catch(showError));
    });
  }

  async function createClient() {
    const payload = {
      name: byId("client-name").value.trim() || "generated-client",
      models: splitList(byId("client-models").value).filter(Boolean),
      upstreams: [],
    };
    if (!payload.models.length) payload.models = ["*"];
    const resp = await fetch(API_BASE + "/clients", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(data?.error?.message || "\u521b\u5efa\u5931\u8d25");

    state.lastCreatedClient = data.client;
    byId("client-output").hidden = false;
    byId("client-output-text").textContent = JSON.stringify(data.client, null, 2);
    byId("refresh-client-key").hidden = false;
    showToast("\u5ba2\u6237\u7aef Key \u5df2\u751f\u6210");
    await loadClients();
  }

  async function updateClientModels(id, models) {
    const resp = await fetch(API_BASE + "/clients/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: models.length ? models : ["*"] }),
    });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u66f4\u65b0\u6a21\u578b\u6743\u9650\u5931\u8d25");
    await loadClients();
  }

  async function deleteClient(id) {
    const resp = await fetch(API_BASE + "/clients/" + encodeURIComponent(id), { method: "DELETE" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u5220\u9664\u5931\u8d25");
    await loadClients();
  }

  /* ---- Boot ---- */
  async function boot() {
    try {
      byId("vendor-modal").addEventListener("click", (e) => { if (e.target === byId("vendor-modal")) closeVendorModal(); });
      byId("model-picker-modal").addEventListener("click", (e) => { if (e.target === byId("model-picker-modal")) closeModelPicker(); });
      byId("speed-picker-modal").addEventListener("click", (e) => { if (e.target === byId("speed-picker-modal")) closeSpeedPicker(); });
      byId("system-prompt-modal").addEventListener("click", (e) => { if (e.target === byId("system-prompt-modal")) closeSystemPromptModal(); });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        hideStatTip();
        if (state.speedPicker) closeSpeedPicker();
        else if (state.modelPicker) closeModelPicker();
        else if (byId("system-prompt-modal").classList.contains("open")) closeSystemPromptModal();
        else closeVendorModal();
      });
      byId("open-vendor-modal").addEventListener("click", openVendorModal);
      byId("open-system-prompt-modal").addEventListener("click", openSystemPromptModal);
      byId("close-system-prompt-modal").addEventListener("click", closeSystemPromptModal);
      byId("split-prompt-context").addEventListener("click", splitPromptContextDraft);
      byId("add-context-item").addEventListener("click", () => addContextItem());
      byId("classify-context-items").addEventListener("click", classifyContextItemsDraft);
      byId("export-prompt-config").addEventListener("click", () => {
        const payload = currentPromptBundle();
        downloadJsonFile("llmmerge-prompt-" + payload.exported_at.slice(0, 10) + ".json", payload);
        showToast("\u5df2\u5bfc\u51fa\u63d0\u793a\u8bcd");
      });
      byId("import-prompt-config").addEventListener("click", () => {
        const input = byId("import-prompt-file");
        input.value = "";
        input.click();
      });
      byId("import-prompt-file").addEventListener("change", (e) =>
        withButtonBusy(byId("import-prompt-config"), "\u5bfc\u5165\u4e2d...", async () => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          await importPromptFromFile(file);
        }).catch(showError)
      );
      byId("export-context-items").addEventListener("click", () => {
        const payload = currentContextBundle();
        downloadJsonFile("llmmerge-context-" + payload.exported_at.slice(0, 10) + ".json", payload);
        showToast("\u5df2\u5bfc\u51fa " + payload.context_items.length + " \u4e2a\u7247\u6bb5");
      });
      byId("import-context-items").addEventListener("click", () => {
        const input = byId("import-context-file");
        input.value = "";
        input.click();
      });
      byId("import-context-file").addEventListener("change", (e) =>
        withButtonBusy(byId("import-context-items"), "\u5bfc\u5165\u4e2d...", async () => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          await importContextFromFile(file);
        }).catch(showError)
      );
      ["context-on-demand", "context-item-limit", "context-max-chars"].forEach((id) =>
        byId(id).addEventListener("input", () => renderPromptContextStatus("\u5f85\u4fdd\u5b58"))
      );
      byId("apply-system-prompt-modal").addEventListener("click", () => {
        renderPromptContextStatus("\u5f85\u4fdd\u5b58");
        closeSystemPromptModal();
      });
      byId("upstream-actions-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        byId("upstream-actions").classList.toggle("open");
      });
      document.addEventListener("click", () => { byId("upstream-actions").classList.remove("open"); hideStatTip(); });
      byId("close-vendor-modal").addEventListener("click", closeVendorModal);
      byId("model-picker-close").addEventListener("click", closeModelPicker);
      byId("speed-picker-close").addEventListener("click", closeSpeedPicker);
      byId("speed-picker-cancel").addEventListener("click", closeSpeedPicker);
      byId("speed-picker-search").addEventListener("input", renderSpeedPicker);
      byId("speed-picker-run").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6d4b\u901f\u4e2d...", speedTest).catch(showError)
      );
      byId("picker-cancel").addEventListener("click", closeModelPicker);
      byId("picker-apply").addEventListener("click", applyModelPicker);
      byId("picker-select-visible").addEventListener("click", () => selectVisibleModels(true));
      byId("picker-clear-visible").addEventListener("click", () => selectVisibleModels(false));
      byId("model-picker-search").addEventListener("input", renderModelPicker);
      byId("vendor-account-id").addEventListener("input", applyVendorPreset);
      byId("vendor-fetch-models").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5bfc\u5165\u4e2d...", async () => {
          const models = await fetchDraftUpstreamModels();
          if (!models.length) throw new Error("\u8be5\u4e0a\u6e38\u65e0\u53ef\u7528\u6a21\u578b");
          showModelPicker(byId("vendor-name").value.trim() || "\u5f53\u524d\u4e0a\u6e38", models, byId("vendor-models"));
        }).catch(showError)
      );

      byId("create-vendor").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6dfb\u52a0\u4e2d...", async () => {
          createVendorFromModal();
          await saveConfig();
          showToast("\u4e0a\u6e38\u5df2\u6dfb\u52a0\u5e76\u4fdd\u5b58");
        }).catch(showError)
      );
      byId("save-config").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u4fdd\u5b58\u4e2d...", saveConfig).catch(showError)
      );
      byId("save-settings").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u4fdd\u5b58\u4e2d...", saveSettings).catch(showError)
      );
      byId("export-upstreams").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5bfc\u51fa\u4e2d...", async () => {
          const payload = await exportUpstreams();
          const stamp = (payload.exported_at || "export").slice(0, 10);
          downloadJsonFile("llmmerge-upstreams-" + stamp + ".json", payload);
          showToast("\u5df2\u5bfc\u51fa " + ((payload.upstreams || []).length || 0) + " \u4e2a\u4e0a\u6e38");
        }).catch(showError)
      );
      byId("import-upstreams").addEventListener("click", () => {
        const input = byId("import-upstreams-file");
        input.value = "";
        input.click();
      });
      byId("import-upstreams-file").addEventListener("change", (e) =>
        withButtonBusy(byId("import-upstreams"), "\u5bfc\u5165\u4e2d...", async () => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          await importUpstreamsFromFile(file);
        }).catch(showError)
      );
      byId("refresh-models").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5237\u65b0\u4e2d...", refreshModels).catch(showError)
      );
      byId("check-health").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u68c0\u67e5\u4e2d...", checkHealth).catch(showError)
      );
      byId("speed-test").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6253\u5f00\u4e2d...", openSpeedPicker).catch(showError)
      );
      byId("load-stats").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u52a0\u8f7d\u4e2d...", loadStats).catch(showError)
      );
      byId("load-logs").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u52a0\u8f7d\u4e2d...", loadLogs).catch(showError)
      );

      byId("create-client").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u751f\u6210\u4e2d...", createClient).catch(showError)
      );
      byId("refresh-client-key").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u751f\u6210\u4e2d...", createClient).catch(showError)
      );
      byId("copy-client-key").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u590d\u5236\u4e2d...", () =>
          copyText(state.lastCreatedClient?.api_key, "API Key \u5df2\u590d\u5236")
        ).catch(showError)
      );
      byId("copy-client-json").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u590d\u5236\u4e2d...", () =>
          copyText(byId("client-output-text").textContent, "JSON \u5df2\u590d\u5236")
        ).catch(showError)
      );
      byId("copy-gateway-url").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u590d\u5236\u4e2d...", () =>
          copyText(state.gateway?.base_url, "Gateway URL \u5df2\u590d\u5236")
        ).catch(showError)
      );

      byId("refresh-logs").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5237\u65b0\u4e2d...", loadLogs).catch(showError)
      );

      // ponytail: parallel boot — config + clients fetch together
      var hero = document.querySelector('.hero');
      var bootSpan = document.createElement('span');
      bootSpan.className = 'note';
      bootSpan.textContent = ' 加载中...';
      if (hero) hero.querySelector('h1')?.appendChild(bootSpan);
      await Promise.all([loadConfig(), loadClients()]);
      if (bootSpan.parentNode) bootSpan.remove();
      loadRuntimeStatus().catch(function(){});
      loadStats(true).catch(function(){}); // ponytail: don't block boot on stats
      loadLogs().catch(function(){});  // don't block on logs either
      // ponytail: AE path is cheap enough; only refresh visible panels.
      var statsPanel = byId("stats-panel");
      var logPanel = byId("log-panel");
      setInterval(function() {
        if (document.visibilityState !== "visible") return;
        var statsVisible = !statsPanel || statsPanel.offsetParent !== null;
        var logVisible = !logPanel || logPanel.offsetParent !== null;
        if (statsVisible) loadStats(true).catch(function(){});
        if (logVisible) loadLogs().catch(function(){});
      }, 2000);
      setInterval(function() { if (document.visibilityState === "visible") loadRuntimeStatus().catch(function(){}); }, 2000);


    } catch (error) {
      showError(error);
      // ponytail: visible fallback so user sees something is wrong
      var hero = document.querySelector('.hero');
      if (hero) {
        var banner = document.createElement('div');
        banner.style.cssText = 'margin-top:12px;padding:12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;color:#991b1b;font-size:13px';
        banner.textContent = '[Boot Error] ' + (error.message || 'Unknown') + ' — check browser console (F12)';
        hero.appendChild(banner);
      }
    }
  }

  boot();
</script>`;
}


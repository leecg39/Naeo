/** Styles are scoped to the home adapter so other captured routes are unchanged. */
export const homeStyles = `
[data-naeo-home-ranking] {max-width:920px;margin:0 auto;color:inherit}
.naeo-home-podium {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:0;padding:0;list-style:none;align-items:end}
.naeo-home-rank-card {min-width:0;padding:28px 20px;border:1px solid rgba(128,128,128,.22);border-radius:20px;background:rgba(128,128,128,.04);text-align:center;overflow-wrap:anywhere}
.naeo-home-rank-card:first-child {border-color:#03c75a;padding-top:40px;padding-bottom:40px}
.naeo-home-rank-card a,.naeo-home-rank-row a {color:inherit;text-decoration:none;font-weight:800}
.naeo-home-rank-card strong {display:block;color:#03c75a;font-size:30px;margin-top:14px}
.naeo-home-rank-card p {margin:8px 0;color:#a3a3a3;font-size:13px}
.naeo-home-rank-avatar {display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:rgba(3,199,90,.12);color:#03c75a;font-size:22px;font-weight:800;margin:12px auto}
.naeo-home-rank-list {margin:28px 0 0;padding:0;list-style:none}
.naeo-home-rank-row {display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:14px;align-items:center;padding:18px;border-bottom:1px solid rgba(128,128,128,.15);overflow-wrap:anywhere}
.naeo-home-rank-row small {display:block;color:#a3a3a3;margin-top:4px}
.naeo-home-rank-rules,.naeo-home-rank-empty {border:1px solid rgba(128,128,128,.2);border-radius:16px;padding:28px;margin-top:28px;line-height:1.8}
.naeo-home-rank-empty {text-align:center;margin:0}
.naeo-home-rank-rules h3,.naeo-home-rank-empty h3 {font-size:18px;margin:0 0 12px}
.naeo-home-rank-rules p,.naeo-home-rank-empty p {color:#a3a3a3;font-size:14px;margin:8px 0}
.naeo-home-rank-empty a {display:inline-block;color:#03c75a;font-weight:700;margin-top:10px}
.naeo-home-demo-controls {display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;margin:16px auto;color:inherit}
.naeo-home-demo-controls button {appearance:none;border:1px solid rgba(128,128,128,.3);border-radius:999px;padding:8px 12px;color:inherit;background:transparent;font:inherit;font-size:12px;cursor:pointer;max-width:100%}
.naeo-home-demo-controls button[aria-pressed="true"] {color:#03c75a;border-color:#03c75a;background:rgba(3,199,90,.1)}
.naeo-home-demo-controls button:focus-visible {outline:2px solid #03c75a;outline-offset:3px}
[data-naeo-home-demo] [data-naeo-demo-panel][aria-hidden="true"] {visibility:hidden!important;opacity:0!important;pointer-events:none!important}
[data-naeo-home-demo] [data-naeo-demo-panel][aria-hidden="false"] {visibility:visible!important;opacity:1!important;pointer-events:auto!important}
[data-naeo-home-demo] [data-naeo-demo-panel] {transition:opacity 250ms ease}
[data-naeo-home-demo] [data-naeo-demo-scroll] {overflow-y:auto!important;overscroll-behavior:contain}
[data-naeo-home-demo] [data-naeo-demo-action] {cursor:pointer;pointer-events:auto}
[data-naeo-home-demo] [data-naeo-demo-action]:focus-visible {outline:2px solid #03c75a;outline-offset:3px}
[data-naeo-home-demo] [data-naeo-demo-panel="2"] .mui-1lgiddr {overflow-y:auto}
[data-naeo-home-demo] [data-naeo-demo-panel="3"] .mui-wcms2q {pointer-events:auto}
[data-naeo-home-demo] [data-naeo-demo-panel="3"] .mui-znwecn {transform:none!important}
[data-naeo-home-demo] [data-naeo-demo-panel="3"] .mui-1k9kkdk > :nth-child(2) {overflow-y:auto;overscroll-behavior:contain}
[data-naeo-home-mcp] [hidden] {display:none!important}
[data-naeo-home-mcp] [aria-hidden="true"][style*="opacity:0"] {visibility:hidden;pointer-events:none}
@media(max-width:599px) {.naeo-home-podium{grid-template-columns:1fr}.naeo-home-rank-card,.naeo-home-rank-card:first-child{padding:22px}.naeo-home-rank-rules,.naeo-home-rank-empty{padding:22px}.naeo-home-demo-controls{gap:6px}.naeo-home-demo-controls button{padding:8px 10px}}
@media(prefers-reduced-motion:reduce) {[data-naeo-home-demo] [data-naeo-demo-panel]{transition:none}}
`;

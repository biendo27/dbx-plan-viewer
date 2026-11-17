import { parseShowplan, plansFromContext, layoutPlan, MAX_BYTES } from './showplan.js';
const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let plans = [], current, layout, layer, scale = 1, minimumScale = .02, offset = { x: 0, y: 0 }, loadVersion = 0, sourceNotice = '';
const format = n => n === null ? 'Not supplied' : new Intl.NumberFormat('en', { maximumSignificantDigits: 6 }).format(n);
const percent = value => value === null ? 'Unavailable' : value > 0 && value < .1 ? '<0.1%' : `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)}%`;
function text(tag, value, parent) { const el = document.createElement(tag); el.textContent = value; parent?.append(el); return el; }
function svg(tag, attributes, parent) { const el = document.createElementNS(svgNS, tag); for (const [k,v] of Object.entries(attributes)) el.setAttribute(k,v); parent?.append(el); return el; }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function clear() { current = null; layout = null; layer = null; $('viewer').hidden = true; $('empty').hidden = false; $('graph').replaceChildren(); $('properties').replaceChildren(); $('xml-view').textContent = ''; $('statement-sql').textContent = ''; }
function fail(error) { clear(); notice(error.message || String(error)); }
function options(select, entries) { select.replaceChildren(...entries.map((label, i) => { const el = text('option', label); el.value = i; return el; })); }
function receive(inputs, message = '') {
  clear(); plans = inputs; sourceNotice = message; notice(message);
  options($('plan-choice'), inputs.map(p => p.label));
  if (!inputs.length) return;
  $('plan-choice').value = '0'; showPlan();
}
function showPlan() {
  clear();
  try {
    current = parseShowplan(plans[Number($('plan-choice').value)].xml);
    $('viewer').hidden = false; $('empty').hidden = true;
    options($('statement-choice'), current.statements.map((s, i) => `${i + 1}. ${s.type} · ${s.text.replace(/\s+/g, ' ').slice(0, 120)}`));
    $('xml-view').textContent = current.xml; showStatement();
  } catch (error) {
    fail(error);
    // Keep the plan selector accessible so one bad cell cannot hide other plans.
    if (plans.length > 1) { $('viewer').hidden = false; $('empty').hidden = true; options($('statement-choice'), []); $('counts').textContent = ''; $('plan-kind').textContent = ''; $('no-operators').hidden = true; }
  }
}
function transform() { if (layer) layer.setAttribute('transform', `translate(${offset.x} ${offset.y}) scale(${scale})`); $('zoom-level').textContent = `${(scale < .01 ? (scale * 100).toFixed(2) : Math.round(scale * 100))}%`; }
function fit() { if (!layout) return; const box = $('canvas').getBoundingClientRect(); if (box.width <= 32 || box.height <= 32) return; scale = Math.min(1, (box.width - 32) / layout.width, (box.height - 120) / layout.height); minimumScale = Math.min(.02, scale); offset = { x: (box.width - layout.width * scale) / 2, y: 48 + (box.height - 120 - layout.height * scale) / 2 }; transform(); }
function zoom(factor) { const box = $('canvas').getBoundingClientRect(); const next = Math.max(minimumScale, Math.min(4, scale * factor)); offset = { x: box.width / 2 - (box.width / 2 - offset.x) * next / scale, y: box.height / 2 - (box.height / 2 - offset.y) * next / scale }; scale = next; transform(); }
function properties(node) {
  const panel = $('properties'); panel.replaceChildren(); text('h3', node.operator, panel);
  const list = text('dl', '', panel);
  const pair = (key, value) => { text('dt', key, list); text('dd', value, list); };
  pair('Estimated operator cost (% of statement)', percent(node.costPercent));
  const object = node.objects[0];
  if (object) { pair('Object', [object.Database, object.Schema, object.Table].filter(Boolean).join('.')); if (object.Index) pair('Index', object.Index); }
  pair('Physical operation', node.attributes.PhysicalOp || 'Not supplied');
  pair('Logical operation', node.attributes.LogicalOp || 'Not supplied');
  pair('Estimated rows', format(node.estimatedRows));
  pair('Actual rows (all reported threads)', format(node.actualRows));
  pair('Estimated operator cost (exclusive)', node.operatorCost === null ? 'Unavailable' : format(node.operatorCost));
  pair('StatementSubTreeCost (denominator)', format(node.statementCost));
  pair('Estimated subtree cost', format(node.cost));
  for (const detail of node.details.filter(d => /predicate/i.test(d.path) && d.values.ScalarString)) pair('Predicate', detail.values.ScalarString);
  text('p', 'Cost % = (operator subtree cost − immediate child subtree costs) / StatementSubTreeCost × 100. Estimated optimizer units, not elapsed time. Unavailable when source costs are missing or inconsistent.', panel);
  const raw = text('details', '', panel); raw.className = 'raw-properties'; text('summary', 'All source properties', raw);
  const attributes = text('dl', '', raw);
  for (const [key,value] of Object.entries(node.attributes)) { text('dt',key,attributes); text('dd',value,attributes); }
  for (const detail of node.details) { text('h3', detail.path, raw); const dl = text('dl', '', raw); for (const [key,value] of Object.entries(detail.values)) { text('dt', key, dl); text('dd', value, dl); } }

}
function selectNode(node, group) { $('graph').querySelectorAll('.node').forEach(el => { el.classList.toggle('selected', el === group); el.setAttribute('aria-pressed', String(el === group)); }); properties(node); }
function showStatement() {
  if (!current) return;
  const statement = current.statements[Number($('statement-choice').value)];
  $('statement-sql').textContent = statement.text; $('sql-summary').textContent = `Statement SQL · ${statement.type}`;
  $('plan-kind').textContent = statement.nodes.some(n => n.counters.length) ? 'Runtime counters present' : 'Estimated plan';
  $('counts').textContent = `${statement.nodes.length} operators`; $('properties').replaceChildren(text('p','Select an operator to inspect its properties.'));
  const graph = $('graph'); graph.replaceChildren(); const defs = svg('defs', {}, graph); const marker = svg('marker', { id:'arrow', viewBox:'0 0 10 10', refX:9, refY:5, markerWidth:7, markerHeight:7, orient:'auto-start-reverse' }, defs); svg('path', {d:'M 0 0 L 10 5 L 0 10 z',class:'arrow'}, marker);
  layer = svg('g', {id:'graph-layer'}, graph); layout = layoutPlan(statement.roots);
  $('no-operators').hidden = !!statement.nodes.length;
  for (const edge of layout.edges) { const x1 = edge.from.x, x2 = edge.to.x + layout.nodeWidth, y1 = edge.from.y + layout.nodeHeight / 2, y2 = edge.to.y + layout.nodeHeight / 2, mid = (x1 + x2) / 2; svg('path',{class:'edge',d:`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,'marker-end':'url(#arrow)'},layer); }
  let defaultGroup;
  const defaultNode = statement.nodes.reduce((best, node) => node.costPercent !== null && (best?.costPercent === null || !best || node.costPercent > best.costPercent) ? node : best, statement.roots[0]);
  for (const pos of layout.positions) {
    const node = pos.node, group = svg('g',{class:'node',transform:`translate(${pos.x} ${pos.y})`,tabindex:0,role:'button','aria-label':`${node.operator}, estimated rows ${format(node.estimatedRows)}, estimated operator cost ${percent(node.costPercent)}`,'aria-pressed':false},layer);
    svg('rect',{width:layout.nodeWidth,height:layout.nodeHeight,rx:8},group);
    const object = node.objects[0]; const objectLabel = object ? [object.Table,object.Index].filter(Boolean).join(' · ') : node.attributes.LogicalOp || '';
    const icon = svg('g',{class:'node-icon',transform:'translate(14 14)'},group);
    const paths = /seek|scan|lookup|spool/i.test(node.operator) ? ['M2 5C2 1 22 1 22 5S2 9 2 5V19C2 23 22 23 22 19V5','M2 12C2 16 22 16 22 12']
      : /join|loop|parallel|concatenation/i.test(node.operator) ? ['M3 3H9V12H21','M3 21H9V12','M17 8L21 12L17 16']
      : /aggregate/i.test(node.operator) ? ['M20 3H5L14 12L5 21H20']
      : /sort/i.test(node.operator) ? ['M4 5H20M4 12H15M4 19H10','M19 12V22M16 19L19 22L22 19']
      : /filter/i.test(node.operator) ? ['M2 3H22L14 13V21L10 19V13Z']
      : /compute|scalar/i.test(node.operator) ? ['M19 3H12L8 21H3','M5 10H17','M17 15L23 21M23 15L17 21']
      : ['M3 3H21V21H3ZM7 8H17M7 13H17M7 18H12'];
    for (const d of paths) svg('path',{d},icon);
    const labels = [node.operator, objectLabel, `Est. rows ${format(node.estimatedRows)}`, `Est. cost ${percent(node.costPercent)}`];
    labels.forEach((label,i) => { const t = svg('text',{x:14,y:[64,86,109,135][i],class:i === 0 ? 'node-title' : i === 3 ? 'node-cost' : 'node-meta'},group); const max = i === 0 ? 24 : 27; t.textContent = label.length > max ? `${label.slice(0,max-1)}…` : label; });
    const title = svg('title',{},group); title.textContent = labels.join('\n');
    if (node === defaultNode) defaultGroup = group;
    group.addEventListener('click',() => selectNode(node,group));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node,group); } });
    group.addEventListener('focus', () => { const box = $('canvas').getBoundingClientRect(); const x = offset.x + pos.x * scale, y = offset.y + pos.y * scale; if (x < 0 || y < 0 || x + layout.nodeWidth * scale > box.width || y + layout.nodeHeight * scale > box.height) { offset = {x:box.width / 2 - (pos.x + layout.nodeWidth / 2) * scale,y:box.height / 2 - (pos.y + layout.nodeHeight / 2) * scale}; transform(); } });
  }
  if (defaultGroup) selectNode(defaultNode, defaultGroup);
  requestAnimationFrame(fit);
}
function tab(source) { $('xml-view').hidden = !source; $('diagram-view').hidden = source; $('zoom-tools').hidden = source; $('diagram-tab').setAttribute('aria-pressed', String(!source)); $('xml-tab').setAttribute('aria-pressed', String(source)); if (!source) requestAnimationFrame(fit); }
$('paste').onclick = () => $('paste-dialog').showModal(); $('cancel-paste').onclick = () => $('paste-dialog').close();
$('paste-form').onsubmit = event => { event.preventDefault(); loadVersion++; $('paste-dialog').close(); receive([{label:'Pasted XML',xml:$('xml-input').value}]); };
$('open-file').onclick = () => $('file').click();
$('file').onchange = async () => { const file = $('file').files[0]; if (!file) return; const version = ++loadVersion; clear(); notice('Reading file…'); try { if (file.size > MAX_BYTES) throw new Error('Plan exceeds the 10 MiB limit. Open a smaller plan.'); const xml = await file.text(); if (version === loadVersion) receive([{label:file.name,xml}]); } catch (error) { if (version === loadVersion) fail(error); } finally { $('file').value = ''; } };
$('plan-choice').onchange = () => { notice(sourceNotice); showPlan(); }; $('statement-choice').onchange = showStatement;
$('diagram-tab').onclick = () => tab(false); $('xml-tab').onclick = () => tab(true);
$('zoom-in').onclick = () => zoom(1.25); $('zoom-out').onclick = () => zoom(.8); $('fit').onclick = fit;
const canvas = $('canvas'); canvas.tabIndex = 0; let drag;
canvas.addEventListener('pointerdown',event => { if (event.button !== 0 || event.target.closest('.node')) return; drag = {x:event.clientX,y:event.clientY,offset:{...offset}}; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); });
canvas.addEventListener('pointermove',event => { if (!drag) return; offset = {x:drag.offset.x + event.clientX - drag.x,y:drag.offset.y + event.clientY - drag.y}; transform(); });
for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,() => {drag = null; canvas.classList.remove('dragging');});
canvas.addEventListener('wheel',event => { if (!layout) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); },{passive:false});
canvas.addEventListener('keydown',event => { if (event.target !== canvas) return; if (event.key === '+' || event.key === '=') zoom(1.25); else if (event.key === '-') zoom(.8); else if (event.key.toLowerCase() === 'f') fit(); else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { offset.x += event.key === 'ArrowRight' ? 40 : event.key === 'ArrowLeft' ? -40 : 0; offset.y += event.key === 'ArrowDown' ? 40 : event.key === 'ArrowUp' ? -40 : 0; transform(); } else return; event.preventDefault(); });
new ResizeObserver(() => { if (layout && !$('diagram-view').hidden) fit(); }).observe(canvas);
function loadContext(context) { loadVersion++; const {plans:inputs,truncated} = plansFromContext(context); receive(inputs, truncated ? 'DBX supplied only the first 500 result rows. Plans from later rows are unavailable; narrow your query or open the original file.' : context?.result && !inputs.length ? 'No ShowPlan XML cells found in this result. Return complete SQL Server plan XML, paste XML, or open a file.' : ''); }
const sdk = window.dbxPlugin;
if (sdk) { sdk.onContext(loadContext); sdk.ready.then(loadContext).catch(error => fail(error)); }

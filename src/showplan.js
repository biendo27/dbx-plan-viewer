export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_NODES = 5000;
const NS = 'http://schemas.microsoft.com/sqlserver/2004/07/showplan';
const name = el => el.localName || el.nodeName.split(':').pop();
const children = el => Array.from(el.childNodes || []).filter(n => n.nodeType === 1);
const attrs = el => Object.fromEntries(Array.from(el.attributes || []).filter(a => !a.name.startsWith('xmlns')).map(a => [a.name, a.value]));
function elements(root) {
  const result = [], stack = [root];
  while (stack.length) {
    const el = stack.pop(); result.push(el);
    if (result.length > 150000) throw new Error('Plan has too many XML elements. Open a smaller plan.');
    for (const child of children(el).reverse()) stack.push(child);
  }
  return result;
}
function num(value) {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function owner(el, lookup, stop) {
  for (let p = el.parentNode; p && p !== stop; p = p.parentNode) if (lookup.has(p)) return lookup.get(p);
  return null;
}
function localDetails(el) {
  const details = [], objects = [], counters = [], stack = children(el).reverse().map(e => [e, name(e)]);
  while (stack.length) {
    const [item, path] = stack.pop();
    if (name(item) === 'RelOp' || /^Stmt/.test(name(item))) continue;
    const values = attrs(item);
    if (Object.keys(values).length) details.push({ path, values });
    if (name(item) === 'Object') objects.push(values);
    if (name(item) === 'RunTimeCountersPerThread') counters.push(values);
    for (const child of children(item).reverse()) stack.push([child, `${path} / ${name(child)}`]);
  }
  return { details, objects, counters };
}
export function parseShowplan(xml, Parser = globalThis.DOMParser) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('No XML supplied. Paste a ShowPlan XML document or open a .sqlplan file.');
  if (new TextEncoder().encode(xml).length > MAX_BYTES) throw new Error('Plan exceeds the 10 MiB limit. Open a smaller plan.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are not supported. Supply plain SQL Server ShowPlan XML.');
  let document; const issues = [];
  try { document = new Parser({ onError: (_level, message) => issues.push(message) }).parseFromString(xml, 'application/xml'); }
  catch { throw new Error('Invalid or incomplete XML. Copy the complete value or open the original .sqlplan file.'); }
  if (!document.documentElement || issues.length || document.getElementsByTagName('parsererror').length) throw new Error('Invalid or incomplete XML. Copy the complete value or open the original .sqlplan file.');
  const root = document.documentElement;
  if (name(root) !== 'ShowPlanXML' || root.namespaceURI !== NS) throw new Error('This is not a SQL Server ShowPlan XML document.');
  const all = elements(root);
  if (all.some(el => el.namespaceURI !== NS)) throw new Error('Unsupported XML namespace inside the plan. Supply SQL Server ShowPlan XML only.');
  const statementElements = all.filter(e => /^Stmt/.test(name(e)));
  if (!statementElements.length) throw new Error('The XML contains no SQL statements.');
  const statementMap = new Map(statementElements.map((el, index) => [el, { key: `statement-${index}`, attributes: attrs(el), text: el.getAttribute('StatementText') || '(SQL text unavailable)', type: el.getAttribute('StatementType') || name(el), roots: [], nodes: [] }]));
  const relOps = all.filter(e => name(e) === 'RelOp');
  if (relOps.length > MAX_NODES) throw new Error('Plan exceeds 5,000 operators. Open a smaller plan.');
  const nodeMap = new Map();
  for (const [index, el] of relOps.entries()) {
    const statement = owner(el, statementMap, root);
    if (!statement) continue;
    const attributes = attrs(el), local = localDetails(el);
    const actualRows = local.counters.length && local.counters.every(c => num(c.ActualRows) !== null) ? local.counters.reduce((n, c) => n + Number(c.ActualRows), 0) : null;
    const node = { key: `node-${index}`, attributes, ...local, operator: local.details.some(d => d.values.Lookup === '1' || d.values.Lookup === 'true') ? (attributes.PhysicalOp === 'Clustered Index Seek' ? 'Key Lookup' : attributes.PhysicalOp || 'Lookup') : attributes.PhysicalOp || attributes.LogicalOp || 'Operator', estimatedRows: num(attributes.EstimateRows), actualRows, cost: num(attributes.EstimatedTotalSubtreeCost), children: [] };
    nodeMap.set(el, node); statement.nodes.push(node);
  }
  for (const [el, node] of nodeMap) {
    const statement = owner(el, statementMap, root);
    // Do not connect operators across nested statement boundaries.
    let parent = null;
    for (let p = el.parentNode; p && !statementMap.has(p); p = p.parentNode) if (nodeMap.has(p)) { parent = nodeMap.get(p); break; }
    if (parent) parent.children.push(node); else statement.roots.push(node);
  }
  for (const statement of statementMap.values()) calculateOperatorCosts(statement);
  return { xml, attributes: attrs(root), statements: [...statementMap.values()] };
}
// ShowPlan subtree costs are cumulative. Subtract only immediate children so
// repeated execution estimates remain represented by their source subtree costs.
function calculateOperatorCosts(statement) {
  const total = num(statement.attributes.StatementSubTreeCost);
  statement.cost = total;
  const epsilon = Math.abs(total || 0) * 1e-6;
  const known = cost => cost !== null && cost >= 0 && Number.isFinite(cost);
  const rootSum = statement.roots.reduce((sum, node) => sum + (known(node.cost) ? node.cost : 0), 0);
  const validTotal = total !== null && total > 0 && Number.isFinite(rootSum) && rootSum <= total + epsilon;
  for (const node of statement.nodes) {
    node.statementCost = total;
    node.operatorCost = null;
    node.costPercent = null;
    if (!validTotal || !known(node.cost) || node.cost > total + epsilon || node.children.some(child => !known(child.cost))) continue;
    const childCost = node.children.reduce((sum, child) => sum + child.cost, 0);
    const difference = node.cost - childCost;
    const localEpsilon = Math.max(node.cost, childCost) * 1e-6;
    if (!Number.isFinite(difference) || difference < -localEpsilon) continue;
    node.operatorCost = Math.min(total, Math.max(0, difference));
    node.costPercent = node.operatorCost / total * 100;
  }
}
export function plansFromContext(context) {
  const result = context?.result;
  if (!Array.isArray(result?.rows)) return { plans: [], truncated: false };
  const plans = [];
  for (const [rowIndex, row] of result.rows.entries()) {
    if (!Array.isArray(row)) continue;
    for (const [colIndex, cell] of row.entries()) {
      if (typeof cell === 'string' && /<(?:[\w.-]+:)?ShowPlanXML\b/.test(cell)) {
        plans.push({ label: `Row ${rowIndex + 1} · ${result.columns?.[colIndex] || `Column ${colIndex + 1}`}`, xml: cell });
      }
    }
  }
  return { plans, truncated: result.truncated === true };
}
export function layoutPlan(roots) {
  const positions = [], edges = [], stack = roots.slice().reverse().map(node => ({ node, depth: 0, visited: false }));
  const placed = new Map(); let leaf = 0, maxDepth = 0;
  while (stack.length) {
    const frame = stack.pop(); const { node, depth } = frame;
    if (!frame.visited) {
      stack.push({ ...frame, visited: true });
      for (const child of node.children.slice().reverse()) stack.push({ node: child, depth: depth + 1, visited: false });
    } else {
      const y = node.children.length ? node.children.reduce((sum, child) => sum + placed.get(child.key).y, 0) / node.children.length : 24 + leaf++ * 176;
      const position = { node, x: 24 + depth * 236, y };
      placed.set(node.key, position); positions.push(position); maxDepth = Math.max(maxDepth, depth);
      for (const child of node.children) edges.push({ from: placed.get(child.key), to: position });
    }
  }
  return { positions, edges, width: maxDepth * 236 + 256, height: leaf * 176 + 24, nodeWidth: 208, nodeHeight: 152 };
}

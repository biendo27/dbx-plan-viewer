import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseShowplan, plansFromContext, layoutPlan, MAX_BYTES } from '../src/showplan.js';
import { plan, ns } from './fixtures.js';
const parse = xml => parseShowplan(xml, DOMParser);
test('preserves nested and operatorless statements; keeps properties with their operator', () => {
 const parsed = parse(plan); assert.equal(parsed.statements.length, 3);
 const [parent, conditional, nested] = parsed.statements;
 assert.equal(conditional.nodes.length, 0); assert.equal(nested.nodes.length, 1);
 assert.equal(parent.nodes[0].actualRows, null); assert.equal(parent.nodes[0].objects.length, 0);
 assert.equal(parent.nodes[0].details.filter(d => d.values.ScalarString).length, 1);
 assert.equal(parent.nodes[1].actualRows, 7); assert.equal(parent.nodes[1].objects[0].Index, '[IX_Items]');
 assert.equal(parent.roots.length, 1); assert.equal(parent.roots[0].children.length, 1);
});
test('rejects malformed, unsupported, oversized and entity inputs', () => {
 for (const xml of ['', '<ShowPlanXML', '<root/>', '<!DOCTYPE x><x/>', `<ShowPlanXML xmlns="${ns}"/>`, ' '.repeat(MAX_BYTES + 1) + '<x/>']) assert.throws(() => parse(xml));
});
test('supports namespace prefixes, missing estimates, and preserves source exactly', () => {
 const xml = `<s:ShowPlanXML xmlns:s="${ns}"><s:StmtSimple StatementText="a"><s:QueryPlan><s:RelOp PhysicalOp="Future Operator"/></s:QueryPlan></s:StmtSimple></s:ShowPlanXML>`;
 const parsed = parse(xml); assert.equal(parsed.xml, xml); assert.equal(parsed.statements[0].nodes[0].estimatedRows, null);
});
test('extracts every XML cell and keeps host truncation explicit', () => {
 const result = plansFromContext({result:{columns:['a','b'],rows:[[plan,plan],['x',plan]],truncated:true}});
 assert.equal(result.plans.length, 3); assert.equal(result.truncated,true); assert.equal(result.plans[2].label,'Row 2 · b');
});
test('layout edges flow from right to left and sibling rectangles do not overlap', () => {
 const node = (key, children = []) => ({key,children}); const layout = layoutPlan([node('a',[node('b',[node('d')]),node('c')])]);
 for (const edge of layout.edges) assert.ok(edge.from.x > edge.to.x + layout.nodeWidth);
 for (const a of layout.positions) for (const b of layout.positions) if (a !== b && a.x === b.x) assert.ok(Math.abs(a.y-b.y) >= layout.nodeHeight);
});
test('resource bounds reject too many operators and elements', () => {
 assert.throws(() => parse(`<ShowPlanXML xmlns="${ns}"><StmtSimple>${'<RelOp/>'.repeat(5001)}</StmtSimple></ShowPlanXML>`), /5,000 operators/);
 assert.throws(() => parse(`<ShowPlanXML xmlns="${ns}">${'<X/>'.repeat(150000)}</ShowPlanXML>`), /too many XML elements/);
});
test('deep chains and many siblings lay out without recursion or overlap', () => {
 const xml = `<ShowPlanXML xmlns="${ns}"><StmtSimple>${'<RelOp>'.repeat(600)}${'</RelOp>'.repeat(600)}</StmtSimple></ShowPlanXML>`;
 const parsed = parse(xml); assert.equal(layoutPlan(parsed.statements[0].roots).positions.length,600);
 const root = {key:'root',children:Array.from({length:100},(_,i) => ({key:`child-${i}`,children:[]}))};
 const result = layoutPlan([root,{key:'other-root',children:[]}]);
 assert.equal(result.positions.length,102); assert.equal(result.edges.length,100);
 const siblings = result.positions.filter(p => p.x === 322); for (let i=1;i<siblings.length;i++) assert.ok(siblings[i].y-siblings[i-1].y >= result.nodeHeight);
});
test('incomplete runtime rows are unknown rather than a misleading partial sum', () => {
 const parsed = parse(plan.replace('Thread="1" ActualRows="4"','Thread="1" ActualExecutions="1"'));
 assert.equal(parsed.statements[0].nodes[1].actualRows,null);
});

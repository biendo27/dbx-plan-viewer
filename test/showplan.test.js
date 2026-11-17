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
 const siblings = result.positions.filter(p => p.x === 260); for (let i=1;i<siblings.length;i++) assert.ok(siblings[i].y-siblings[i-1].y >= result.nodeHeight);
});
test('incomplete runtime rows are unknown rather than a misleading partial sum', () => {
 const parsed = parse(plan.replace('Thread="1" ActualRows="4"','Thread="1" ActualExecutions="1"'));
 assert.equal(parsed.statements[0].nodes[1].actualRows,null);
});
test('rejects foreign namespace statements, operators and runtime counters', () => {
 for (const foreign of ['<x:StmtSimple><x:RelOp/></x:StmtSimple>', '<x:RelOp/>', '<x:RunTimeCountersPerThread ActualRows="999"/>']) {
  const xml = `<ShowPlanXML xmlns="${ns}" xmlns:x="urn:other"><StmtSimple><QueryPlan><RelOp>${foreign}</RelOp></QueryPlan></StmtSimple></ShowPlanXML>`;
  assert.throws(() => parse(xml), /Unsupported XML namespace/);
 }
});
const costPlan = (total, body) => parse(`<ShowPlanXML xmlns="${ns}"><StmtSimple ${total === null ? '' : `StatementSubTreeCost="${total}"`}><QueryPlan>${body}</QueryPlan></StmtSimple></ShowPlanXML>`).statements[0];
const costNode = (cost, children = '') => `<RelOp ${cost === null ? '' : `EstimatedTotalSubtreeCost="${cost}"`}>${children}</RelOp>`;
test('exclusive cost percentage subtracts immediate children once, scoped to each statement', () => {
 const statement = costPlan('10',costNode('10',costNode('6',costNode('4')) + costNode('3')));
 assert.deepEqual(statement.nodes.map(n => n.operatorCost),[1,2,4,3]);
 assert.deepEqual(statement.nodes.map(n => n.costPercent),[10,20,40,30]);
 const parsed = parse(plan); assert.ok(Math.abs(parsed.statements[0].nodes[0].costPercent - 100/3) < 1e-10);
 assert.equal(parsed.statements[2].nodes[0].costPercent,100);
 assert.equal(parsed.statements[0].nodes[1].statementCost,.3); assert.equal(parsed.statements[2].nodes[0].statementCost,.2);
});
test('cost percentages retain legitimate zero and reject unknown or inconsistent inputs', () => {
 assert.equal(costPlan('1',costNode('0')).nodes[0].costPercent,0);
 for (const total of [null,'0','-1','NaN']) assert.equal(costPlan(total,costNode('1')).nodes[0].costPercent,null);
 for (const tree of [costNode(null),costNode('-1'),costNode('2'),costNode('1',costNode(null)),costNode('.5',costNode('.8')),costNode('.8') + costNode('.8')]) assert.equal(costPlan('1',tree).nodes[0].costPercent,null);
});
test('cost tolerates only tiny relative serialization rounding and keeps raw costs', () => {
 const tiny = costPlan('1',costNode('.3',costNode('.30000001'))).nodes[0];
 assert.equal(tiny.costPercent,0); assert.equal(tiny.attributes.EstimatedTotalSubtreeCost,'.3');
 assert.equal(costPlan('1',costNode('.3',costNode('.30001'))).nodes[0].costPercent,null);
 assert.equal(costPlan('1e-12',costNode('1e-13',costNode('2e-13'))).nodes[0].costPercent,null);
});
test('cost attributes accept finite decimal/scientific notation, never JS radix syntax', () => {
 for (const value of ['0x10','0b10','0o10','Infinity','NaN','1_000','1e999','']) {
  const node = costPlan(value,costNode(value)).nodes[0];
  assert.equal(node.cost,null); assert.equal(node.costPercent,null); assert.equal(node.attributes.EstimatedTotalSubtreeCost,value);
 }
 for (const value of ['1.','.1','+1e-3','1.E+2',' 2.5 ']) assert.equal(costPlan(value,costNode(value)).nodes[0].costPercent,100);
});

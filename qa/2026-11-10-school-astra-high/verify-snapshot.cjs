// Reproduces selected review findings against the frozen, supplied source.
// No network, credentials, real payments, database writes, or app changes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const bundle = fs.readFileSync(path.join(__dirname, 'source-snapshot.txt'), 'utf8');
const pieces = bundle.split(/\n===== FILE: (.+?) =====\n/);
const sources = {};
for (let i = 1; i < pieces.length; i += 2) {
  sources[pieces[i]] = pieces[i + 1].split('\n===== WORKING TREE DIFF =====')[0]
    .split('\n').flatMap(line => {
      const match = line.match(/^\s*\d+ \| (.*)$/);
      return match ? [match[1]] : [];
    }).join('\n');
}
function load(name, mocks = {}, cache = {}) {
  if (cache[name]) return cache[name];
  assert.ok(sources[name], `Snapshot file missing: ${name}`);
  const module = { exports: {} };
  cache[name] = module.exports;
  const requireMock = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), id));
      return load(target + (sources[target + '.ts'] ? '.ts' : '.tsx'), mocks, cache);
    }
    throw new Error(`Unmocked dependency: ${id}`);
  };
  const code = ts.transpileModule(sources[name], { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
    esModuleInterop: true, target: ts.ScriptTarget.ES2020,
  }}).outputText;
  vm.runInNewContext(code, { exports: module.exports, module, require: requireMock,
    console, process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.invalid',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-test-value' } },
  }, { filename: name });
  cache[name] = module.exports;
  return module.exports;
}
const calc = load('src/utils/calculations.ts');
const user = id => ({ id, name: id, neighborhood: 'Demo', avatarColor: '#000', paidStatus: 'pending' });
const claim = (id, quantity) => ({ userId: id, userName: id, avatarColor: '#000', quantity });
const item = (id, mode, price, claims, caseSize) => ({ id, name: id, emoji: 'x', category: 'Demo',
  unitLabel: 'unit', mode, unitPrice: price, retailPrice: price, caseSize, claims });
const pool = items => ({ id: 'test', title: 'Synthetic QA', hostVenmoHandle: 'test-host',
  minimumOrderAmount: 300, freeDeliveryThreshold: 300, deliveryFee: 24, status: 'open',
  participants: [user('a')], items, messages: [] });
async function main() {
  const evidence = [];
  const p = pool([item('direct', 'individual', 290, [claim('a', 1)]),
    item('partial', 'case_split', 15, [claim('a', 1)], 6)]);
  const summary = calc.getPoolProgressSummary(p);
  const manifest = calc.getWholesaleOrderManifest(p);
  const charged = calc.getParticipantBreakdowns(p).reduce((sum, b) => sum + b.totalDue, 0);
  assert.equal(summary.committedPoolTotal, 290);
  assert.equal(summary.combinedPoolTotal, 305);
  assert.equal(summary.isMinimumMet, true);
  assert.equal(summary.isFreeDeliveryUnlocked, true);
  assert.equal(manifest.grandTotalSupplierInvoice, 290);
  assert.equal(charged, 305);
  evidence.push({ finding: 'Threshold/checkout/manifest mismatch', committed: 290,
    thresholdTotal: 305, displayedSupplierInvoice: 290, participantTotalDue: charged,
    supplierCostUnderConfiguredFeeRule: 314 });

  const seven = pool([item('case', 'case_split', 3, [claim('a', 7)], 6)]);
  const breakdown = calc.getParticipantBreakdowns(seven)[0];
  assert.equal(calc.getPoolProgressSummary(seven).committedPoolTotal, 18);
  assert.equal(breakdown.committedSubtotal, 0);
  assert.equal(breakdown.pendingCaseSubtotal, 21);
  evidence.push({ finding: 'Full-case shares classified pending after rollover',
    poolCommitted: 18, participantCommitted: 0, participantPending: 21 });

  const thirds = pool([item('direct', 'individual', 1,
    [claim('a', 1), claim('b', 1), claim('c', 1)])]);
  thirds.participants = ['a','b','c'].map(user); thirds.deliveryFee = 20;
  const displayedTotal = calc.getParticipantBreakdowns(thirds)
    .reduce((sum, b) => sum + Math.round(b.totalDue * 100), 0);
  assert.equal(displayedTotal, 2301);
  evidence.push({ finding: 'Cent rounding does not reconcile', displayedTotalCents: displayedTotal,
    supplierInvoiceCents: 2300 });

  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const opened = [], paid = [];
  const ledger = load('src/components/SplitLedgerView.tsx', { react,
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
      StyleSheet: { create: x => x }, Alert: { alert() {} },
      Linking: { canOpenURL: async () => true, openURL: async url => { opened.push(url); } } } });
  const tree = ledger.SplitLedgerView({ pool: p, currentUserId: 'a', onTogglePaidStatus: id => paid.push(id) });
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === 'object') { nodes.push(node); visit(node.children); }
  }
  visit(tree);
  const payButton = nodes.find(n => n.type === 'TouchableOpacity' && n.props.style?.backgroundColor === '#3D95CE')
    || nodes.find(n => n.type === 'TouchableOpacity' && JSON.stringify(n.children).includes('via Venmo'));
  assert.ok(payButton);
  await payButton.props.onPress();
  assert.equal(opened.length, 1); assert.deepEqual(paid, ['a']);
  evidence.push({ finding: 'Venmo navigation immediately marks paid',
    paymentConfirmationProvided: false, paidCallbackCount: paid.length });

  const writes = [];
  const client = { rpc: async () => ({ data: null, error: { message: 'Pool is locked' } }),
    from: table => ({ upsert: async row => { writes.push({ table, row }); return { error: null }; } }) };
  const repo = load('src/services/repository.ts', {
    '@react-native-async-storage/async-storage': {}, '@supabase/supabase-js': { createClient: () => client } });
  const result = await repo.PoolRepository.syncAtomicClaimDelta('test','case',user('a'),1,7);
  assert.equal(result.error, undefined);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].row.quantity, 7);
  evidence.push({ finding: 'RPC lock rejection falls back to unrestricted absolute write',
    rpcError: 'Pool is locked', fallbackWrites: writes.length, finalQuantity: 7 });

  const report = { status: 'All five selected defects reproduced', tests: evidence,
    limits: 'Frozen snapshot; mocked native navigation and Supabase transport. No PostgreSQL, live backend, device, or full-app runtime was used.' };
  fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { gnomonIndexQuery, formatGnomonDiscovery } from './gnomon';

// ─── gnomonIndexQuery ─────────────────────────────────────────────────────

const similar = gnomonIndexQuery({ kind: 'similar-contracts', filter: 'token' });
assert.ok(similar.includes('Similar DERO'));
assert.ok(similar.includes('token'));

const byFn = gnomonIndexQuery({ kind: 'by-function', filter: 'Initialize' });
assert.ok(byFn.includes('Contracts containing function'));
assert.ok(byFn.includes('Initialize'));

const byTx = gnomonIndexQuery({ kind: 'by-transaction', filter: 'abc123' });
assert.ok(byTx.includes('Transactions involving contract'));
assert.ok(byTx.includes('abc123'));

const telaApps = gnomonIndexQuery({ kind: 'tela-apps', limit: 5 });
assert.ok(telaApps.includes('TELA dApps'));
assert.ok(telaApps.includes('5'));

// default limit
const telaDefault = gnomonIndexQuery({ kind: 'tela-apps' });
assert.ok(telaDefault.includes('10'));

// default case (unknown kind)
const unknown = gnomonIndexQuery({ kind: 'unknown-kind' as any, filter: '' });
assert.ok(unknown.includes('Gnomon index query'));

// no filter
const noFilter = gnomonIndexQuery({ kind: 'by-function' });
assert.ok(noFilter.includes(': '));

// ─── formatGnomonDiscovery ────────────────────────────────────────────────

const empty = formatGnomonDiscovery([]);
assert.equal(empty, 'No contracts discovered.');

const one = formatGnomonDiscovery([{
  scid: 'abc123def456',
  name: 'Token Contract',
  deployHeight: 1000,
  functions: ['Initialize', 'Transfer'],
  relatedContracts: ['xyz789'],
  lastActivity: 5000000
}]);
assert.ok(one.includes('Token Contract'));
assert.ok(one.includes('abc123def456'));
assert.ok(one.includes('Initialize'));
assert.ok(one.includes('Transfer'));
assert.ok(one.includes('xyz789'));

const withTela = formatGnomonDiscovery([{
  scid: 'tela123',
  name: 'My dApp',
  deployHeight: 500,
  functions: ['Initialize'],
  relatedContracts: [],
  lastActivity: 6000000,
  telaApp: { entry: 'index.tela', documents: ['page1.tela'] }
}]);
assert.ok(withTela.includes('TELA app'), `Expected "TELA app" in output, got: ${JSON.stringify(withTela)}`);
assert.ok(withTela.includes('index.tela'));

const unnamed = formatGnomonDiscovery([{
  scid: 'onlyscid',
  name: 'onlyscid',
  deployHeight: 0,
  functions: [],
  relatedContracts: [],
  lastActivity: 0
}]);
assert.ok(unnamed.includes('onlyscid'));

console.log('gnomon tests passed');

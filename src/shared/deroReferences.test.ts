import assert from 'node:assert/strict';
import {
  extractDeroReferences,
  extractDeroReferenceItems,
  hasDeroReferences,
  formatDeroReferenceReceipt,
  formatChainContextReceipt,
  confidenceLabel
} from './deroReferences';

const SCID_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// ─── extractDeroReferences ────────────────────────────────────────────────

const withScid = `Check contract ${SCID_HEX}`;
const refs = extractDeroReferences(withScid);
assert.equal(refs.scids.length, 1);
assert.ok(refs.scids[0].startsWith('dead'));
assert.equal(refs.addresses.length, 0);
assert.equal(refs.telaUrls.length, 0);

const withAddress = 'Send to dero1qwertyuiopasdfghjklzxcvbnm1234567890';
const addrRefs = extractDeroReferences(withAddress);
assert.equal(addrRefs.addresses.length, 1);
assert.ok(addrRefs.addresses[0].startsWith('dero1'));

const withTela = 'Open tela://app.example.com/landing';
const telaRefs = extractDeroReferences(withTela);
assert.equal(telaRefs.telaUrls.length, 1);
assert.equal(telaRefs.telaUrls[0], 'tela://app.example.com/landing');

const empty = extractDeroReferences('Just regular text.');
assert.equal(empty.scids.length, 0);
assert.equal(empty.transactions.length, 0);
assert.equal(empty.addresses.length, 0);
assert.equal(empty.telaUrls.length, 0);

// unique handling
const duplicate = extractDeroReferences(`${withScid} and again ${SCID_HEX}`);
assert.equal(duplicate.scids.length, 1);

// testnet address
const testnetRefs = extractDeroReferences('derotest1abcdefghijklmnopqrstuvwxyz1234567');
assert.equal(testnetRefs.addresses.length, 1);
assert.ok(testnetRefs.addresses[0].startsWith('derotest1'));

// ─── extractDeroReferenceItems ────────────────────────────────────────────

const items = extractDeroReferenceItems(withScid);
assert.equal(items.length, 1);
assert.equal(items[0].type, 'scid');
assert.equal(items[0].label, 'SCID/TX');

const multi = extractDeroReferenceItems(`${withScid} and ${withAddress}`);
assert.equal(multi.length, 2);
assert.ok(multi.some((i) => i.type === 'scid'));
assert.ok(multi.some((i) => i.type === 'address'));

// ─── hasDeroReferences ────────────────────────────────────────────────────

assert.equal(hasDeroReferences(refs), true);
assert.equal(hasDeroReferences(extractDeroReferences('nothing here')), false);
assert.equal(hasDeroReferences({ scids: [], transactions: [], addresses: [], telaUrls: [] }), false);

// ─── formatDeroReferenceReceipt ───────────────────────────────────────────

const receipt = formatDeroReferenceReceipt(refs);
assert.ok(receipt.includes('<dero_reference_receipt'));
assert.ok(receipt.includes('unverified-user-input'));
assert.ok(receipt.includes(SCID_HEX));
assert.ok(receipt.includes('</dero_reference_receipt>'));

const emptyReceipt = formatDeroReferenceReceipt(empty);
assert.equal(emptyReceipt.includes('Possible SCID'), false);
assert.equal(emptyReceipt.includes('<dero_reference_receipt'), true);

// ─── formatChainContextReceipt ────────────────────────────────────────────

const emptyChain = formatChainContextReceipt([]);
assert.equal(emptyChain, '');

const singleAttachment = formatChainContextReceipt([{
  type: 'contract-source',
  label: 'Token Contract',
  content: 'source code here',
  source: 'daemon',
  provenance: 'local-simulator',
  confidence: 'verified',
  timestamp: 1000
}]);
assert.ok(singleAttachment.includes('<dero_chain_context>'));
assert.ok(singleAttachment.includes('Token Contract'));
assert.ok(singleAttachment.includes('DAEMON EVIDENCE'));
assert.ok(singleAttachment.includes('</dero_chain_context>'));

// ─── confidenceLabel ──────────────────────────────────────────────────────

assert.equal(confidenceLabel('verified'), '✓ Verified (daemon-confirmed)');
assert.equal(confidenceLabel('high'), '◉ High confidence (from docs/known patterns)');
assert.equal(confidenceLabel('medium'), '○ Medium confidence (partial evidence)');
assert.equal(confidenceLabel('low'), '◌ Low confidence (model inference, unverified)');

console.log('deroReferences tests passed');

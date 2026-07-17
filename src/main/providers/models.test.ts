import assert from 'node:assert/strict';
import { parseOpenRouterPricing } from './models';

// ─── parseOpenRouterPricing ───────────────────────────────────────────────

// typical OpenRouter values (USD-per-token decimal strings) → $/1M numbers
{
  const p = parseOpenRouterPricing({ prompt: '0.000003', completion: '0.000015' });
  assert.equal(p.inputPrice, 3);
  assert.equal(p.outputPrice, 15);
}

// fractional per-1M prices survive (e.g. gpt-4o-mini: $0.15 / $0.60)
{
  const p = parseOpenRouterPricing({ prompt: '0.00000015', completion: '0.0000006' });
  assert.equal(p.inputPrice, 0.15);
  assert.equal(p.outputPrice, 0.6);
}

// extra pricing fields (image/request/internal) are ignored
{
  const p = parseOpenRouterPricing({ prompt: '0.000001', completion: '0.000002', image: '0.001', request: '0.01' });
  assert.deepEqual(p, { inputPrice: 1, outputPrice: 2 });
}

// missing pricing object / wrong shapes → no prices
assert.deepEqual(parseOpenRouterPricing(undefined), {});
assert.deepEqual(parseOpenRouterPricing(null), {});
assert.deepEqual(parseOpenRouterPricing('0.000003'), {});
assert.deepEqual(parseOpenRouterPricing(42), {});
assert.deepEqual(parseOpenRouterPricing({}), {});

// only one side present → only that side set
assert.deepEqual(parseOpenRouterPricing({ prompt: '0.000001' }), { inputPrice: 1 });
assert.deepEqual(parseOpenRouterPricing({ completion: '0.000002' }), { outputPrice: 2 });

// zero stays undefined — a 0 would render as "free" in the cost dashboard
assert.deepEqual(parseOpenRouterPricing({ prompt: '0', completion: '0.000000' }), {});
assert.deepEqual(parseOpenRouterPricing({ prompt: 0, completion: 0 }), {});

// negative values are nonsense → undefined, valid side still parsed
assert.deepEqual(parseOpenRouterPricing({ prompt: '-0.000003', completion: '0.000015' }), { outputPrice: 15 });

// garbage strings → undefined, never NaN
{
  const p = parseOpenRouterPricing({ prompt: 'abc', completion: '' });
  assert.deepEqual(p, {});
  assert.ok(!Number.isNaN(p.inputPrice));
  assert.ok(!Number.isNaN(p.outputPrice));
}

// numeric (non-string) values are accepted too
assert.deepEqual(parseOpenRouterPricing({ prompt: 0.000002, completion: 0.000008 }), { inputPrice: 2, outputPrice: 8 });

console.log('models pricing tests passed');

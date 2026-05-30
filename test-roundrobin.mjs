/**
 * Standalone Round-Robin Redirect Test (v3 - fixed)
 * Run: node test-roundrobin.mjs
 */

// ── Mock KV Store ──────────────────────────────────────────────
class MockKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

function createMockEvent() {
  const kv = new MockKV();
  return { context: { cloudflare: { env: { KV: kv } } } };
}

// ── Round-Robin Functions ─────────────────────────────────────

async function getRoundRobinIndex(event, slug) {
  const KV = event.context.cloudflare.env.KV;
  const value = await KV.get(`link-roundrobin:${slug}`);
  return value ? Number.parseInt(value, 10) || 0 : 0;
}

async function incrementRoundRobinIndex(event, slug, max) {
  const KV = event.context.cloudflare.env.KV;
  const current = await getRoundRobinIndex(event, slug);
  const next = (current + 1) % max;
  await KV.put(`link-roundrobin:${slug}`, String(next));
}

// ── Simulate middleware redirect logic (with try-catch guard) ──
async function simulateRedirect(event, slug, link) {
  let targetUrl = link.url; // default

  if (link.redeemMode === 'sequential' && link.urls && link.urls.length > 0) {
    try {
      const index = await getRoundRobinIndex(event, slug);
      if (link.urls[index]) {
        targetUrl = link.urls[index];
      } else {
        console.log(`  ⚠️ index ${index} out of bounds (max ${link.urls.length}), falling back to default`);
      }
      await incrementRoundRobinIndex(event, slug, link.urls.length);
    } catch (err) {
      console.log(`  ⚠️ Round-robin failed: ${err.message}, falling back to default`);
    }
  }

  return targetUrl;
}

// ── Tests ─────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ FAIL: ${msg}`); failed++; }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Round-Robin Multi-URL Redirect Tests   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Test 1: 正常轮询: A→B→C→A 循环 ─────────────────────────
  console.log('【Test 1】正常轮询: A→B→C→A 循环');
  {
    const event = createMockEvent();
    const link = {
      url: 'https://default.example.com',
      slug: 'cycle-link',
      urls: ['https://a.com', 'https://b.com', 'https://c.com'],
      redeemMode: 'sequential',
    };

    const r1 = await simulateRedirect(event, 'cycle-link', link);
    assert(r1 === 'https://a.com', `Visit 1 → a.com (got ${r1.split('/').pop()})`);

    const r2 = await simulateRedirect(event, 'cycle-link', link);
    assert(r2 === 'https://b.com', `Visit 2 → b.com (got ${r2.split('/').pop()})`);

    const r3 = await simulateRedirect(event, 'cycle-link', link);
    assert(r3 === 'https://c.com', `Visit 3 → c.com (got ${r3.split('/').pop()})`);

    const r4 = await simulateRedirect(event, 'cycle-link', link);
    assert(r4 === 'https://a.com', `Visit 4 → a.com wraps back (got ${r4.split('/').pop()})`);
  }

  // ── Test 2: 新链接默认从 URL[0] 开始 ─────────────────────────
  console.log('\n【Test 2】新链接默认从 URL[0] 开始');
  {
    const event = createMockEvent();
    const link = { url: 'https://fallback.com', slug: 'new', urls: ['https://x.com', 'https://y.com'], redeemMode: 'sequential' };
    const r = await simulateRedirect(event, 'new', link);
    assert(r === 'https://x.com', `returns x.com (got ${r})`);
  }

  // ── Test 3: KV计数器越界，回退默认URL ────────────────────────
  console.log('\n【Test 3】计数器越界 → 回退默认 URL');
  {
    const event = createMockEvent();
    // Simulate: link used to have 4+ URLs, counter at 3. URLs reduced to 2.
    await event.context.cloudflare.env.KV.put('link-roundrobin:shrink', '3');
    const link = { url: 'https://default.example.com', slug: 'shrink', urls: ['https://new1.com', 'https://new2.com'], redeemMode: 'sequential' };

    const r1 = await simulateRedirect(event, 'shrink', link);
    assert(r1 === 'https://default.example.com', `Returns default (got ${r1})`);

    const r2 = await simulateRedirect(event, 'shrink', link);
    assert(r2 === 'https://new1.com', `Self-corrects to new1.com (got ${r2})`);
  }

  // ── Test 4: single 模式不启用轮询 ────────────────────────────
  console.log('\n【Test 4】redeemMode=single → 只用默认 URL');
  {
    const event = createMockEvent();
    const link = { url: 'https://main.com', slug: 'single', urls: ['https://alt.com'], redeemMode: 'single' };
    const r = await simulateRedirect(event, 'single', link);
    assert(r === 'https://main.com', `returns main.com (got ${r})`);
  }

  // ── Test 5: urls 为空数组 → 回退默认 ────────────────────────
  console.log('\n【Test 5】urls=[] → 用默认 URL');
  {
    const event = createMockEvent();
    const link = { url: 'https://only.com', slug: 'empty-urls', urls: [], redeemMode: 'sequential' };
    const r = await simulateRedirect(event, 'empty-urls', link);
    assert(r === 'https://only.com', `returns only.com (got ${r})`);
  }

  // ── Test 6: 无 urls 字段 → 用默认 URL ───────────────────────
  console.log('\n【Test 6】无 urls 字段 → 用默认 URL');
  {
    const event = createMockEvent();
    const link = { url: 'https://solo.com', slug: 'no-urls', redeemMode: 'sequential' };
    const r = await simulateRedirect(event, 'no-urls', link);
    assert(r === 'https://solo.com', `returns solo.com (got ${r})`);
  }

  // ── Test 7: KV 异常 → 回退默认（不崩溃）─────────────────────
  console.log('\n【Test 7】KV 异常 → try-catch 保护');
  {
    const brokenKV = {
      async get() { throw new Error('KV read failed'); },
      async put() {},
    };
    const event = { context: { cloudflare: { env: { KV: brokenKV } } } };
    const link = { url: 'https://safe.com', slug: 'err', urls: ['https://bad.com'], redeemMode: 'sequential' };

    const r = await simulateRedirect(event, 'err', link);
    assert(r === 'https://safe.com', `Returns safe.com (got ${r})`);
  }

  // ── Test 8: 6次访问3个URL — 均匀分布 ─────────────────────────
  console.log('\n【Test 8】6次访问 3 URL → 每 URL 2 次');
  {
    const event = createMockEvent();
    const link = { url: 'https://d.com', slug: 'dist', urls: ['https://U1.com', 'https://U2.com', 'https://U3.com'], redeemMode: 'sequential' };
    const counts = {};
    for (let i = 0; i < 6; i++) {
      const url = await simulateRedirect(event, 'dist', link);
      counts[url] = (counts[url] || 0) + 1;
    }
    assert(counts['https://U1.com'] === 2, `U1: ${counts['https://U1.com']} (expected 2)`);
    assert(counts['https://U2.com'] === 2, `U2: ${counts['https://U2.com']} (expected 2)`);
    assert(counts['https://U3.com'] === 2, `U3: ${counts['https://U3.com']} (expected 2)`);
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(45)}`);
  console.log(`  Total: ${passed + failed}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
  console.log(`${'─'.repeat(45)}\n`);
  return failed === 0;
}

runTests().then(s => process.exit(s ? 0 : 1));

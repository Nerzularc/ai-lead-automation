const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLead, parseBudget } = require('../src/normalize');
const { ruleBasedScore, tierFor } = require('../src/scoring');
const { extractJson, parseAiResponse } = require('../src/parseAi');
const samples = require('../data/sample-leads.json');

test('validateLead accepts a complete lead and normalizes fields', () => {
  const { valid, errors, lead } = validateLead({
    name: '  Jane   Doe ',
    email: 'Jane@Acme.io',
    company: 'Acme',
    role: 'Head of Operations',
    budget: '5k-15k',
    timeline: '1 month',
    message: 'We need to automate invoice processing between Stripe and Xero.',
  });
  assert.equal(valid, true, errors.join(','));
  assert.equal(lead.name, 'Jane Doe');
  assert.equal(lead.email, 'jane@acme.io');
  assert.equal(lead.is_business_email, true);
  assert.equal(lead.budget_band, '5k-15k');
  assert.match(lead.lead_id, /^L-/);
});

test('validateLead rejects missing email, short message and honeypot spam', () => {
  const r = validateLead({ name: 'Bot', message: 'hi', website_confirm: 'x' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('email is required'));
  assert.ok(r.errors.includes('spam detected'));
  assert.ok(r.errors.some((e) => e.startsWith('message')));
});

test('parseBudget handles bands, raw numbers and junk', () => {
  assert.deepEqual(parseBudget('$12,000'), { band: '5k-15k', estimate: 12000 });
  assert.deepEqual(parseBudget('20k'), { band: '15k-50k', estimate: 20000 });
  assert.equal(parseBudget('not sure').band, 'unknown');
});

test('ruleBasedScore ranks a strong lead hot and a student cold', () => {
  const hot = validateLead(samples[0]).lead;
  const cold = validateLead(samples.find((s) => /student/i.test(s.message))).lead;
  assert.equal(ruleBasedScore(hot).tier, 'hot');
  assert.equal(ruleBasedScore(cold).tier, 'cold');
});

test('negated urgency ("not urgent") does not count as buying intent', () => {
  const base = { budget_band: 'unknown', role: '', is_business_email: false };
  const negated = ruleBasedScore({ ...base, message: 'Exploring options. Not urgent, just gathering information.' });
  const urgent = ruleBasedScore({ ...base, message: 'This is urgent, we need help this month.' });
  assert.ok(!negated.reasons.some((r) => r.startsWith('buying-intent')));
  assert.ok(urgent.reasons.some((r) => r.startsWith('buying-intent')));
});

test('tierFor thresholds', () => {
  assert.equal(tierFor(70), 'hot');
  assert.equal(tierFor(69), 'warm');
  assert.equal(tierFor(39), 'cold');
});

test('extractJson handles fences, prose and truncation', () => {
  assert.deepEqual(extractJson('```json\n{"score": 80}\n```'), { score: 80 });
  assert.deepEqual(extractJson('Sure! Here it is: {"score": 55, "tier": "warm"} hope it helps'), { score: 55, tier: 'warm' });
  const truncated = extractJson('{"score": 72, "tier": "hot", "summary": "Ops lead needs Stripe to Xe');
  assert.equal(truncated.score, 72);
  assert.equal(truncated.tier, 'hot');
  assert.equal(extractJson('no json here'), null);
});

test('parseAiResponse clamps values and falls back to rules', () => {
  const fallback = { score: 50, tier: 'warm', reasons: [] };
  const ok = parseAiResponse('{"score": 140, "tier": "HOT", "service": "dashboard"}', fallback);
  assert.equal(ok.score, 100);
  assert.equal(ok.tier, 'hot');
  assert.equal(ok.source, 'ai');
  assert.ok(ok.issues.some((i) => i.startsWith('ai_rules_disagreement')));

  const bad = parseAiResponse('I cannot help with that.', fallback);
  assert.equal(bad.source, 'rules_fallback');
  assert.equal(bad.score, 50);

  const weird = parseAiResponse('{"score": "abc", "tier": "lukewarm", "service": "seo"}', fallback);
  assert.equal(weird.score, 50);
  assert.equal(weird.tier, 'warm');
  assert.equal(weird.service, 'other');
});

test('every sample lead produces a valid score between 0 and 100', () => {
  for (const s of samples) {
    const { lead } = validateLead(s);
    const r = ruleBasedScore(lead);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

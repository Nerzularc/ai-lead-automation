// Parse and validate the LLM's qualification output.
// LLMs occasionally wrap JSON in prose or code fences, truncate it, or return
// out-of-range values. This module repairs what it safely can and falls back to
// the rule-based score otherwise, so the workflow never breaks on bad output.

const VALID_TIERS = ['hot', 'warm', 'cold'];
const VALID_SERVICES = [
  'ai_automation', 'dashboard', 'data_analytics', 'market_research',
  'web_app', 'ai_integration', 'other',
];

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  // Strip markdown code fences.
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = t.indexOf('{');
  if (start === -1) return null;
  let candidate = t.slice(start);
  const end = candidate.lastIndexOf('}');
  if (end !== -1) {
    try {
      return JSON.parse(candidate.slice(0, end + 1));
    } catch (e) {
      // fall through to repair
    }
  }
  // Repair: close an unterminated string and balance braces/brackets.
  const quoteCount = (candidate.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) candidate += '"';
  candidate = candidate.replace(/,\s*$/, '');
  const opens = (candidate.match(/\{/g) || []).length;
  const closes = (candidate.match(/\}/g) || []).length;
  const openArr = (candidate.match(/\[/g) || []).length;
  const closeArr = (candidate.match(/\]/g) || []).length;
  candidate += ']'.repeat(Math.max(0, openArr - closeArr));
  candidate += '}'.repeat(Math.max(0, opens - closes));
  try {
    return JSON.parse(candidate);
  } catch (e) {
    return null;
  }
}

function parseAiResponse(text, fallback) {
  const parsed = extractJson(text);
  const issues = [];

  if (!parsed || typeof parsed !== 'object') {
    return {
      ...fallback,
      source: 'rules_fallback',
      summary: 'AI output could not be parsed; rule-based score used.',
      service: 'other',
      next_action: 'Review manually',
      reply_draft: '',
      issues: ['unparseable_ai_output'],
    };
  }

  let score = Number(parsed.score);
  if (!Number.isFinite(score)) {
    issues.push('missing_score');
    score = fallback.score;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  let tier = String(parsed.tier || '').toLowerCase();
  if (!VALID_TIERS.includes(tier)) {
    issues.push('invalid_tier');
    tier = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
  }

  let service = String(parsed.service || 'other').toLowerCase();
  if (!VALID_SERVICES.includes(service)) {
    issues.push('invalid_service');
    service = 'other';
  }

  // Flag large disagreement between AI and rules for human review.
  const disagreement = Math.abs(score - fallback.score);
  if (disagreement >= 40) issues.push(`ai_rules_disagreement_${disagreement}`);

  return {
    score,
    tier,
    service,
    summary: String(parsed.summary || '').slice(0, 500),
    next_action: String(parsed.next_action || '').slice(0, 200),
    reply_draft: String(parsed.reply_draft || '').slice(0, 2000),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 6).map(String) : [],
    rules_score: fallback.score,
    source: 'ai',
    issues,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { extractJson, parseAiResponse, VALID_SERVICES };
}

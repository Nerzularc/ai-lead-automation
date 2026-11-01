// Deterministic rule-based lead scoring.
// Used as (1) a fallback when the AI call fails or returns unusable output and
// (2) a sanity check that is stored next to the AI score for auditing.

const SENIOR_ROLE_RE = /\b(founder|co-?founder|ceo|cto|coo|cmo|owner|director|vp|vice president|head of|partner|president)\b/i;
const MID_ROLE_RE = /\b(manager|lead|principal|senior)\b/i;
const INTENT_RE = /\b(asap|urgent|this month|this quarter|ready to start|budget approved|looking to hire|need help|proposal|quote|pricing)\b/i;
const NEGATED_RE = /\b(not|no|isn't|is not|nothing)\s+(\w+\s+)?(urgent|asap|rush|ready|budget)\w*/gi;
const LOW_INTENT_RE =/\b(just curious|student|homework|free|no budget|internship|job application|seo backlinks|guest post)\b/i;

function sizeScore(size) {
  const s = String(size || '').replace(/\s/g, '');
  if (!s) return 0;
  if (/^(1|1-10|2-10)$/.test(s)) return 5;
  if (/^(11-50)$/.test(s)) return 12;
  if (/^(51-200)$/.test(s)) return 18;
  if (/^(201-1000|201-500|501-1000)$/.test(s)) return 20;
  if (/1000\+|1001/.test(s)) return 15; // big companies are slower to buy from freelancers
  return 5;
}

function budgetScore(band) {
  return { '<1k': 2, '1k-5k': 12, '5k-15k': 22, '15k-50k': 28, '50k+': 30 }[band] || 0;
}

function timelineScore(timeline) {
  const t = String(timeline || '').toLowerCase();
  if (/asap|immediately|this week|<1 ?month|1 month|this month/.test(t)) return 15;
  if (/1-3|quarter|next month|2 months|3 months/.test(t)) return 10;
  if (/3-6|6 months|later|exploring/.test(t)) return 4;
  return 0;
}

function tierFor(score) {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

function ruleBasedScore(lead) {
  const reasons = [];
  let score = 0;

  const b = budgetScore(lead.budget_band);
  score += b;
  if (b) reasons.push(`budget ${lead.budget_band} (+${b})`);

  const t = timelineScore(lead.timeline);
  score += t;
  if (t) reasons.push(`timeline ${lead.timeline} (+${t})`);

  const s = sizeScore(lead.company_size);
  score += s;
  if (s) reasons.push(`company size ${lead.company_size} (+${s})`);

  if (SENIOR_ROLE_RE.test(lead.role || '')) {
    score += 15;
    reasons.push('decision-maker role (+15)');
  } else if (MID_ROLE_RE.test(lead.role || '')) {
    score += 8;
    reasons.push('manager-level role (+8)');
  }

  if (lead.is_business_email) {
    score += 10;
    reasons.push('business email domain (+10)');
  }

  // Remove negated phrases ("not urgent", "no rush") before checking intent.
  const intentText = String(lead.message || '').replace(NEGATED_RE, ' ');
  if (INTENT_RE.test(intentText)) {
    score += 10;
    reasons.push('buying-intent language (+10)');
  }

  if (LOW_INTENT_RE.test(lead.message || '')) {
    score -= 25;
    reasons.push('low-intent or off-topic language (-25)');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, tier: tierFor(score), reasons };
}

if (typeof module !== 'undefined') {
  module.exports = { ruleBasedScore, tierFor, budgetScore, timelineScore, sizeScore };
}

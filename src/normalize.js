// Validate and normalize an inbound lead payload.
// This file is embedded verbatim into the n8n "Validate & Normalize" Code node
// by scripts/build-workflow.mjs, and unit-tested with node:test.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'live.com', 'ymail.com',
];

const BUDGET_BANDS = {
  '<1k': 500,
  '1k-5k': 3000,
  '5k-15k': 10000,
  '15k-50k': 30000,
  '50k+': 75000,
};

function clean(value, max = 2000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseBudget(raw) {
  const v = clean(raw).toLowerCase().replace(/[$,\s]/g, '');
  if (!v) return { band: 'unknown', estimate: 0 };
  if (BUDGET_BANDS[v] !== undefined) return { band: v, estimate: BUDGET_BANDS[v] };
  const num = Number(v.replace(/k$/, '000'));
  if (Number.isFinite(num) && num > 0) {
    let band = '<1k';
    if (num >= 50000) band = '50k+';
    else if (num >= 15000) band = '15k-50k';
    else if (num >= 5000) band = '5k-15k';
    else if (num >= 1000) band = '1k-5k';
    return { band, estimate: num };
  }
  return { band: 'unknown', estimate: 0 };
}

function validateLead(raw) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const errors = [];

  const name = clean(body.name || body.full_name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const company = clean(body.company, 160);
  const role = clean(body.role || body.job_title, 120);
  const website = clean(body.website, 200);
  const message = clean(body.message || body.notes, 3000);
  const source = clean(body.source || 'website', 60).toLowerCase();
  const timeline = clean(body.timeline, 60).toLowerCase();
  const companySize = clean(body.company_size, 30);
  const budget = parseBudget(body.budget);

  if (!name) errors.push('name is required');
  if (!email) errors.push('email is required');
  else if (!EMAIL_RE.test(email)) errors.push('email is invalid');
  if (!message || message.length < 10) errors.push('message must be at least 10 characters');

  // Honeypot field: real users never fill it in.
  if (clean(body.website_confirm)) errors.push('spam detected');

  const domain = email.includes('@') ? email.split('@')[1] : '';
  const lead = {
    lead_id: `L-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    received_at: new Date().toISOString(),
    name,
    email,
    email_domain: domain,
    is_business_email: Boolean(domain) && !FREE_EMAIL_DOMAINS.includes(domain),
    company,
    role,
    website,
    company_size: companySize,
    budget_band: budget.band,
    budget_estimate: budget.estimate,
    timeline: timeline || 'unknown',
    source,
    message,
  };

  return { valid: errors.length === 0, errors, lead };
}

if (typeof module !== 'undefined') {
  module.exports = { validateLead, parseBudget, clean, FREE_EMAIL_DOMAINS };
}

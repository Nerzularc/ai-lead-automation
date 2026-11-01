// Sends every lead in data/sample-leads.json to the n8n webhook.
// Usage: WEBHOOK_URL=http://localhost:5678/webhook/lead-intake node scripts/send-test-leads.mjs
// Tip: use the /webhook-test/ URL while the workflow is open in the n8n editor.

import { readFileSync } from 'node:fs';

const url = process.env.WEBHOOK_URL || 'http://localhost:5678/webhook-test/lead-intake';
const leads = JSON.parse(readFileSync(new URL('../data/sample-leads.json', import.meta.url), 'utf8'));
const delayMs = Number(process.env.DELAY_MS || 1500);

for (const lead of leads) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(lead),
    });
    const text = await res.text();
    console.log(`${res.status}  ${lead.name.padEnd(18)} ${text}`);
  } catch (err) {
    console.error(`ERR  ${lead.name}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, delayMs));
}

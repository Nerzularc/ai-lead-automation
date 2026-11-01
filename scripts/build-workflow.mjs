// Generates the importable n8n workflow JSON from the tested source files in src/.
// Run: npm run build   (writes workflows/lead-intake-ai.json and workflows/error-handler.json)
//
// Why generate? The JavaScript inside n8n Code nodes is otherwise untestable.
// Keeping the logic in src/ means it is covered by `npm test`, and the workflow
// always ships the exact code that passed the tests.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');
const prompt = readFileSync(join(root, 'prompts', 'lead-qualification.md'), 'utf8')
  .split('---')
  .slice(1)
  .join('---')
  .trim();

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';

// ---------- Code node bodies ----------

const normalizeCode = `${src('normalize.js')}
// ---- n8n entry point ----
const out = [];
for (const item of $input.all()) {
  const body = item.json.body || item.json;
  const result = validateLead(body);
  out.push({ json: result });
}
return out;`;

const parseCode = `${src('scoring.js')}
${src('parseAi.js')}
// ---- n8n entry point ----
const lead = $('Validate & Normalize').first().json.lead;
const rules = ruleBasedScore(lead);
const response = $input.first().json;
let text = '';
if (response && Array.isArray(response.content)) {
  text = response.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
}
if (response && response.error) {
  text = '';
}
const result = parseAiResponse(text, rules);
return [{
  json: {
    ...lead,
    score: result.score,
    tier: result.tier,
    service: result.service,
    summary: result.summary,
    next_action: result.next_action,
    reply_draft: result.reply_draft,
    reasons: (result.reasons && result.reasons.length ? result.reasons : rules.reasons).join('; '),
    rules_score: rules.score,
    scoring_source: result.source,
    issues: (result.issues || []).join(', '),
    needs_review: (result.issues || []).length > 0,
  },
}];`;

// ---------- Helpers ----------

let x = 0;
const pos = (col, row = 0) => [240 + col * 260, 300 + row * 200];
const id = () => `${(++x).toString(16).padStart(8, '0')}-0000-4000-8000-${String(x).padStart(12, '0')}`;

const ifBoolean = (name, expr, position) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: id(),
          leftValue: expr,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  id: id(),
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position,
});

// ---------- Main workflow ----------

const nodes = [
  {
    parameters: {
      httpMethod: 'POST',
      path: 'lead-intake',
      responseMode: 'responseNode',
      options: {},
    },
    id: id(),
    name: 'Lead Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: pos(0),
    webhookId: 'b7a1c0de-lead-4000-8000-000000000001',
  },
  {
    parameters: { jsCode: normalizeCode },
    id: id(),
    name: 'Validate & Normalize',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: pos(1),
  },
  ifBoolean('Is Valid?', '={{ $json.valid }}', pos(2)),
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { "ok": false, "errors": $json.errors } }}',
      options: { responseCode: 400 },
    },
    id: id(),
    name: 'Respond 400',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: pos(3, 1),
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { "ok": true, "lead_id": $json.lead.lead_id } }}',
      options: { responseCode: 202 },
    },
    id: id(),
    name: 'Respond 202',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: pos(3),
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify({ model: "' + MODEL + '", max_tokens: 800, temperature: 0, ' +
        'system: ' + JSON.stringify(prompt) + ', ' +
        'messages: [{ role: "user", content: "Qualify this lead:\\n" + JSON.stringify($json.lead, null, 2) }] }) }}',
      options: { timeout: 30000 },
    },
    id: id(),
    name: 'Claude: Qualify Lead',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: pos(4),
    credentials: { httpHeaderAuth: { id: 'REPLACE_ME', name: 'Anthropic API Key' } },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: parseCode },
    id: id(),
    name: 'Parse & Score',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: pos(5),
  },
  {
    parameters: {
      operation: 'append',
      documentId: { __rl: true, mode: 'url', value: '={{ $env.LEADS_SHEET_URL }}' },
      sheetName: { __rl: true, mode: 'name', value: 'Leads' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: [],
        schema: [],
      },
      options: {},
    },
    id: id(),
    name: 'Log to Google Sheets',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: pos(6),
    credentials: { googleSheetsOAuth2Api: { id: 'REPLACE_ME', name: 'Google Sheets' } },
  },
  {
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
              conditions: [
                { id: id(), leftValue: '={{ $json.tier }}', rightValue: 'hot', operator: { type: 'string', operation: 'equals' } },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'hot',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
              conditions: [
                { id: id(), leftValue: '={{ $json.tier }}', rightValue: 'warm', operator: { type: 'string', operation: 'equals' } },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'warm',
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'cold' },
    },
    id: id(),
    name: 'Route by Tier',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.2,
    position: pos(7),
  },
  {
    parameters: {
      select: 'channel',
      channelId: { __rl: true, mode: 'name', value: '#hot-leads' },
      text:
        '=:fire: *Hot lead ({{ $json.score }}/100)* — {{ $json.name }}, {{ $json.role }} at {{ $json.company || "n/a" }}\n' +
        '*Need:* {{ $json.summary }}\n*Service:* {{ $json.service }} · *Budget:* {{ $json.budget_band }} · *Timeline:* {{ $json.timeline }}\n' +
        '*Next:* {{ $json.next_action }}\nA reply draft is waiting in Gmail.',
      otherOptions: {},
    },
    id: id(),
    name: 'Slack: Hot Lead Alert',
    type: 'n8n-nodes-base.slack',
    typeVersion: 2.2,
    position: pos(8, -1),
    credentials: { slackApi: { id: 'REPLACE_ME', name: 'Slack' } },
  },
  {
    parameters: {
      resource: 'draft',
      subject: '=Re: your enquiry — {{ $json.company || $json.name }}',
      emailType: 'text',
      message: '={{ $json.reply_draft || "Hi " + $json.name.split(" ")[0] + ",\\n\\nThanks for reaching out — I will get back to you within one business day.\\n\\nNuzul" }}',
      options: { sendTo: '={{ $json.email }}' },
    },
    id: id(),
    name: 'Gmail: Draft Reply',
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    position: pos(8, 0),
    credentials: { gmailOAuth2: { id: 'REPLACE_ME', name: 'Gmail' } },
  },
  {
    parameters: {
      resource: 'draft',
      subject: '=Re: your enquiry — {{ $json.company || $json.name }}',
      emailType: 'text',
      message: '={{ $json.reply_draft || "Hi " + $json.name.split(" ")[0] + ",\\n\\nThanks for reaching out — I will get back to you shortly.\\n\\nNuzul" }}',
      options: { sendTo: '={{ $json.email }}' },
    },
    id: id(),
    name: 'Gmail: Draft Reply (Warm)',
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    position: pos(8, 1),
    credentials: { gmailOAuth2: { id: 'REPLACE_ME', name: 'Gmail' } },
  },
  {
    parameters: {},
    id: id(),
    name: 'Cold: Logged Only',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: pos(8, 2),
  },
];

const connections = {
  'Lead Webhook': { main: [[{ node: 'Validate & Normalize', type: 'main', index: 0 }]] },
  'Validate & Normalize': { main: [[{ node: 'Is Valid?', type: 'main', index: 0 }]] },
  'Is Valid?': {
    main: [
      [{ node: 'Respond 202', type: 'main', index: 0 }],
      [{ node: 'Respond 400', type: 'main', index: 0 }],
    ],
  },
  'Respond 202': { main: [[{ node: 'Claude: Qualify Lead', type: 'main', index: 0 }]] },
  'Claude: Qualify Lead': { main: [[{ node: 'Parse & Score', type: 'main', index: 0 }]] },
  'Parse & Score': { main: [[{ node: 'Log to Google Sheets', type: 'main', index: 0 }]] },
  'Log to Google Sheets': { main: [[{ node: 'Route by Tier', type: 'main', index: 0 }]] },
  'Route by Tier': {
    main: [
      [
        { node: 'Slack: Hot Lead Alert', type: 'main', index: 0 },
        { node: 'Gmail: Draft Reply', type: 'main', index: 0 },
      ],
      [{ node: 'Gmail: Draft Reply (Warm)', type: 'main', index: 0 }],
      [{ node: 'Cold: Logged Only', type: 'main', index: 0 }],
    ],
  },
};

const mainWorkflow = {
  name: 'AI Lead Intake & Qualification',
  nodes,
  connections,
  active: false,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    errorWorkflow: 'REPLACE_WITH_ERROR_WORKFLOW_ID',
  },
  pinData: {},
  tags: [],
  meta: { templateCredsSetupCompleted: false },
};

// ---------- Error workflow ----------

x = 100;
const errorWorkflow = {
  name: 'Lead Automation — Error Handler',
  nodes: [
    {
      parameters: {},
      id: id(),
      name: 'Error Trigger',
      type: 'n8n-nodes-base.errorTrigger',
      typeVersion: 1,
      position: pos(0),
    },
    {
      parameters: {
        select: 'channel',
        channelId: { __rl: true, mode: 'name', value: '#automation-alerts' },
        text:
          '=:rotating_light: *Workflow failed:* {{ $json.workflow.name }}\n' +
          '*Node:* {{ $json.execution.lastNodeExecuted }}\n' +
          '*Error:* {{ $json.execution.error.message }}\n' +
          '<{{ $json.execution.url }}|Open execution>',
        otherOptions: {},
      },
      id: id(),
      name: 'Slack: Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.2,
      position: pos(1),
      credentials: { slackApi: { id: 'REPLACE_ME', name: 'Slack' } },
    },
  ],
  connections: {
    'Error Trigger': { main: [[{ node: 'Slack: Alert', type: 'main', index: 0 }]] },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
  tags: [],
};

writeFileSync(join(root, 'workflows', 'lead-intake-ai.json'), JSON.stringify(mainWorkflow, null, 2) + '\n');
writeFileSync(join(root, 'workflows', 'error-handler.json'), JSON.stringify(errorWorkflow, null, 2) + '\n');
console.log('Built workflows/lead-intake-ai.json and workflows/error-handler.json');

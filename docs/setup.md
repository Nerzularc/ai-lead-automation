# Setup guide (≈15 minutes)

## 1. Start n8n

```bash
cp .env.example .env          # then fill N8N_ENCRYPTION_KEY and LEADS_SHEET_URL
docker compose up -d
open http://localhost:5678    # create the owner account
```

## 2. Prepare the Google Sheet

Create a sheet with a tab named **Leads** and this header row (row 1).
The workflow auto-maps columns by name, so the order does not matter but the
spelling does:

```
lead_id | received_at | name | email | email_domain | is_business_email | company | role | website | company_size | budget_band | budget_estimate | timeline | source | message | score | tier | service | summary | next_action | reply_draft | reasons | rules_score | scoring_source | issues | needs_review
```

Tip: add conditional formatting on `tier` (hot = red, warm = amber) and a filter
view on `needs_review = TRUE` for the weekly manual check.

## 3. Create credentials in n8n (Settings → Credentials)

| Credential name (must match) | Type | Notes |
|---|---|---|
| `Anthropic API Key` | Header Auth | Name: `x-api-key`, Value: your key from console.anthropic.com |
| `Google Sheets` | Google Sheets OAuth2 | Needs edit access to the sheet |
| `Gmail` | Gmail OAuth2 | Only creates drafts; never sends automatically |
| `Slack` | Slack API | Bot token with `chat:write`; invite the bot to `#hot-leads` and `#automation-alerts` |

## 4. Import the workflows

1. **Workflows → Import from file** → `workflows/error-handler.json`. Save and copy its ID from the URL.
2. Import `workflows/lead-intake-ai.json`.
3. Open each node that shows a warning and pick the credential you created.
4. **Workflow settings → Error workflow** → choose *Lead Automation — Error Handler*.

## 5. Test

```bash
# With the workflow open in the editor, click "Test workflow", then:
npm run send-test-leads
```

You should see `202` for valid leads and `400` for the spam / invalid ones, new
rows in the sheet, a Slack alert for hot leads and Gmail drafts for hot + warm.

When it works, toggle the workflow **Active** and point your website form at
`http://YOUR_HOST:5678/webhook/lead-intake`.

## Changing the logic

Edit files in `src/` or `prompts/`, then:

```bash
npm test && npm run build   # regenerates workflows/*.json
```

Re-import the workflow (or paste the new code into the Code nodes).

## Cost estimate

One qualification call is ~1,000 input + ~400 output tokens. With a small model
that is a fraction of a cent per lead; 1,000 leads/month costs a few dollars.
Check current prices at anthropic.com/pricing.

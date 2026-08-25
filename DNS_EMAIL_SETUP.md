# SPF / DKIM / DMARC — pickgauge.com (Google Workspace)

Three DNS TXT records at Vercel's DNS panel (same "Add DNS Record" path
used for the domain/Clerk setup — remember the Bluesky quick-setup dialog
intercepts a plain TXT attempt; dismiss that and use the generic path).
Not code, can't be done from this sandbox — this is the checklist.

**Do them in this order.** DKIM and SPF should be live for ~48h before
DMARC is added, per Google's own guidance.

## 1. SPF

Add a TXT record:

| Host | Value |
|---|---|
| `@` (or `pickgauge.com`) | `v=spf1 include:_spf.google.com ~all` |

If a `v=spf1` TXT record already exists on the root domain (check first —
only one SPF record is allowed per domain), merge into it instead of
adding a second one: insert `include:_spf.google.com` right before the
`~all`/`-all` at the end, don't create a duplicate record.

## 2. DKIM

This one can't be fully pre-filled — the actual key has to come from
Google's Admin console, generated per-domain:

1. Google Admin console → **Apps → Google Workspace → Gmail → Authenticate
   email**
2. Select `pickgauge.com` → **Generate new record**
3. Key length: **2048-bit** (stronger; only fall back to 1024-bit if
   Vercel's DNS panel complains about the TXT value length — Google's
   generated value is long and some providers require it split into
   multiple quoted strings, but Vercel handles this automatically)
4. Copy the generated **DNS Host name** (typically
   `google._domainkey`) and **TXT record value** exactly as shown —
   don't retype it, don't add extra spaces or smart quotes
5. Add it in Vercel's DNS panel as a TXT record with that host/value
6. Back in the Admin console, click **Start Authentication** (DNS
   propagation can take up to 48h; the console may show a warning
   during that window even once the record is actually live)

## 3. DMARC

Add once SPF (and ideally DKIM) have had time to settle:

| Host | Value |
|---|---|
| `_dmarc` | `v=DMARC1; p=none; rua=mailto:support@pickgauge.com` |

`p=none` is monitor-only — nothing gets blocked or quarantined, it just
starts sending aggregate reports to `support@pickgauge.com` showing
what's passing/failing SPF and DKIM alignment for mail claiming to be
from pickgauge.com. **Deliberately not starting at `p=quarantine` or
`p=reject`** — jumping straight there without a monitoring period first
is the most common real-world DMARC mistake (a legitimate mail path that
hasn't been accounted for gets silently dropped). Move to
`p=quarantine` and eventually `p=reject` only after reviewing a few
weeks of reports and confirming nothing legitimate is failing.

## Verifying

- SPF: MXToolbox SPF lookup for `pickgauge.com`, or send a real test
  email to a Gmail account and check the message's original headers for
  `spf=pass`.
- DKIM: same test email — headers should show a `DKIM-Signature` with
  `d=pickgauge.com` and `Authentication-Results` showing `dkim=pass`.
- DMARC: same headers, `dmarc=pass`; aggregate reports will start
  arriving at `support@pickgauge.com` within a day or two.

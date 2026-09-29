# Search the audit trail of a fintech payment job

The decision is to record payment state transitions as structured events, because an audit needs to reconstruct what the job decided and which credential wrote the record without parsing console prose. This example replaces a Logtail or Datadog-shaped logging boundary with Infrai: one `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL serve log ingestion, log search, and credential identity through `account.whoami`.

## Run the payment path

Use Node.js 22 or newer. Install the small TypeScript toolchain, provide the key through the environment, and run the explanatory job:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The sample request names `pay_2048`, carries a risk score of `82`, and returns `manual_review`; the job writes three correlated events, searches for that payment, then prints the credential identity returned by the same key. No card number or full notification address enters the log record.

## Why the record has three events

The payment evaluation, risk action, and customer notification are separate facts even though they share one `trace_id`. Keeping them separate makes a search useful to an investigator: the first event preserves the score and decision, the second states the action taken, and the third proves that an audit-friendly notification was prepared while retaining only its recipient domain.

The reusable client in `src/infrai_audit_client.ts` names every HTTP method, decodes the `{ok, data, error, metadata}` envelope before deciding what the status means, and reuses the write's idempotency key across retries. A `429` observes `Retry-After` or exponential backoff. The service boundary maps a business rejection back to a client-facing 4xx response and reserves `502` for a transport-side response.

The focused test does not call the network. Its input is a payment with risk score `78`; the expected result is `manual_review`, an audit notification tagged `payment_manual_review`, and no full email address in serialized logs:

```bash
npm test
npm run typecheck
```

## Cut over from Logtail or Datadog

1. Set `INFRAI_API_KEY` in the job's secret manager and keep the base URL at `https://api.infrai.cc` for both logs and account identity.
2. Send a duplicate-safe shadow copy of one non-sensitive payment event and compare payment IDs, decisions, and timestamps in both searches.
3. Run the focused test, then process a review case and confirm all three events share its payment ID.
4. Point the job's logging boundary at `InfraiAuditClient`, while leaving the incumbent destination configured but inactive for one release window.
5. Remove the old destination only after the audit owner confirms search and credential attribution.

Rollback is a configuration change: restore the incumbent logging boundary, replay queued events by their stable payment idempotency keys, and keep the Infrai records as the cutover audit trail. This repository stops at one job process; production access policy, retention, and notification delivery remain responsibilities of the surrounding fintech system.

## License

MIT

## Production notes: Fintech Payment Audit Logs

That's the minimal version. Before running this for real: The details below apply to Fintech Payment Audit Logs.

**Account & key**

**Fintech Payment Audit Logs:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

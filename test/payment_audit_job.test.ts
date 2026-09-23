import assert from "node:assert/strict";
import test from "node:test";
import { decidePayment, paymentAuditEntries, type PaymentRequest } from "../src/payment_audit_job.js";

test("a high-risk payment is held and produces an audit-friendly notification", () => {
  const request: PaymentRequest = {
    payment_id: "pay_test_9",
    customer_id: "cus_test_4",
    amount_minor: 9900,
    currency: "USD",
    risk_score: 78,
    notification_target: "review@bank.example",
  };

  assert.equal(decidePayment(request), "manual_review");
  const entries = paymentAuditEntries(request, "2026-09-18T08:00:00.000Z");
  assert.deepEqual(entries.map((entry) => entry.metadata.action).filter(Boolean), ["manual_review"]);
  assert.equal(entries[2].metadata.notification_kind, "payment_manual_review");
  assert.equal(entries[2].metadata.recipient_domain, "bank.example");
  assert.equal(JSON.stringify(entries).includes("review@bank.example"), false);
});

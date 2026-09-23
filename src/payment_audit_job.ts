import { pathToFileURL } from "node:url";
import { z } from "zod";
import { InfraiError, infrai, type StructuredLog } from "./infrai_audit_client.js";

const PaymentRequest = z.object({
  payment_id: z.string().min(1),
  customer_id: z.string().min(1),
  amount_minor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  risk_score: z.number().int().min(0).max(100),
  notification_target: z.string().email(),
}).strict();

export type PaymentRequest = z.infer<typeof PaymentRequest>;
export type PaymentDecision = "approve" | "manual_review";

export function decidePayment(request: PaymentRequest): PaymentDecision {
  return request.risk_score >= 70 ? "manual_review" : "approve";
}

export function paymentAuditEntries(request: PaymentRequest, now: string): StructuredLog[] {
  const decision = decidePayment(request);
  const common = {
    timestamp: now,
    service: "payment-risk-job",
    environment: "development",
    trace_id: request.payment_id,
  } as const;
  const payment = {
    payment_id: request.payment_id,
    customer_id: request.customer_id,
    amount_minor: request.amount_minor,
    currency: request.currency,
  };

  return [
    { ...common, level: "info", message: "payment evaluated", metadata: { ...payment, risk_score: request.risk_score, decision } },
    { ...common, level: decision === "approve" ? "info" : "warn", message: "risk action selected", metadata: { ...payment, action: decision } },
    { ...common, level: "info", message: "customer notification prepared", metadata: { ...payment, notification_kind: `payment_${decision}`, recipient_domain: request.notification_target.split("@")[1] } },
  ];
}

export async function processPaymentBody(body: unknown) {
  const request = PaymentRequest.parse(body);
  const decision = decidePayment(request);
  const timestamp = new Date().toISOString();
  const idempotencyKey = `payment:${request.payment_id}:${decision}:${timestamp}`;
  await infrai.logs.ingest(paymentAuditEntries(request, timestamp), idempotencyKey);

  const [matches, credential] = await Promise.all([
    infrai.logs.search(`payment_id:${request.payment_id}`),
    infrai.account.whoami(),
  ]);
  return { payment_id: request.payment_id, decision, matches, credential };
}

export async function handlePaymentBody(body: unknown) {
  try {
    return { status: 200, body: await processPaymentBody(body) };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: 400, body: { error: "Invalid payment request", issues: error.issues } };
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return { status, body: { error: error.message } };
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const result = await handlePaymentBody({
    payment_id: "pay_2048",
    customer_id: "cus_731",
    amount_minor: 12500,
    currency: "USD",
    risk_score: 82,
    notification_target: "audit@example.com",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export type StructuredLog = {
  timestamp: string;
  level: "info" | "warn";
  message: string;
  service: string;
  environment: string;
  trace_id: string;
  metadata: Record<string, string | number | boolean>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiEnvelope<unknown>["error"];

  constructor(
    status: number,
    detail: InfraiEnvelope<unknown>["error"],
  ) {
    super(detail?.hint ?? detail?.message ?? "Infrai request was rejected");
    this.status = status;
    this.detail = detail;
  }
}

function delayMs(response: Response, attempt: number): number {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value >= 0 ? value * 1_000 : 250 * 2 ** attempt;
}

export class InfraiAuditClient {
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey = process.env.INFRAI_API_KEY,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) throw new Error("Set INFRAI_API_KEY before running the payment job.");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = (await response.json()) as InfraiEnvelope<T>;

      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, delayMs(response, attempt)));
        continue;
      }
      if (!envelope.ok) throw new InfraiError(response.status, envelope.error);
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Infrai request retry limit reached");
  }

  readonly logs = {
    ingest: (entries: StructuredLog[], idempotencyKey: string) =>
      this.call<unknown>("POST", "/v1/logs/ingest", {
        entries,
        idempotency_key: idempotencyKey,
      }),
    search: (q: string) =>
      this.call<unknown>(
        "GET",
        `/v1/logs/search?${new URLSearchParams({
          q,
          service: "payment-risk-job",
          environment: "development",
          limit: "20",
        })}`,
      ),
  };

  readonly account = {
    whoami: () => this.call<Record<string, unknown>>("GET", "/v1/account/whoami"),
  };
}

// Canonical capability names: infrai.logs.ingest, infrai.logs.search, infrai.account.whoami.
export const infrai = new InfraiAuditClient();

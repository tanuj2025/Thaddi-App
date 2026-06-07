// Moyasar payment integration (https://moyasar.com). No Replit connector exists,
// so this talks to the REST API directly using the secret key. The hosted
// Invoice flow is used: we create an invoice and redirect the buyer to its
// hosted URL; on return we verify the payment/invoice by id server-side (never
// trusting the client beyond the opaque id) before activating a subscription.

import { logger } from "../../lib/logger";

const MOYASAR_BASE = "https://api.moyasar.com/v1";

export class PaymentsNotConfiguredError extends Error {}

function secretKey(): string {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) {
    throw new PaymentsNotConfiguredError(
      "MOYASAR_SECRET_KEY is not configured; payments are unavailable.",
    );
  }
  return key;
}

export function isPaymentsConfigured(): boolean {
  return Boolean(process.env.MOYASAR_SECRET_KEY);
}

function authHeader(): string {
  // Basic auth: secret key as username, empty password.
  return `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}`;
}

export interface CreateInvoiceInput {
  amountHalalas: number;
  description: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface CreatedInvoice {
  id: string;
  status: string;
  url: string | null;
}

// Creates a hosted invoice and returns its id + payment URL.
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<CreatedInvoice> {
  const res = await fetch(`${MOYASAR_BASE}/invoices`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountHalalas,
      currency: "SAR",
      description: input.description,
      success_url: input.callbackUrl,
      back_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    logger.error({ status: res.status, data }, "moyasar createInvoice failed");
    throw new Error(
      (typeof data.message === "string" && data.message) ||
        "Failed to create payment.",
    );
  }
  return {
    id: String(data.id),
    status: typeof data.status === "string" ? data.status : "initiated",
    url: typeof data.url === "string" ? data.url : null,
  };
}

export interface VerifiedPayment {
  found: boolean;
  paid: boolean;
  status: string;
  reference: string; // the verified id we record on the subscription
  metadata: Record<string, string>;
  amountHalalas: number | null;
}

function readMetadata(data: Record<string, unknown>): Record<string, string> {
  const m = data.metadata;
  const out: Record<string, string> = {};
  if (m && typeof m === "object") {
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      out[k] = String(v);
    }
  }
  return out;
}

async function fetchResource(
  kind: "payments" | "invoices",
  id: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${MOYASAR_BASE}/${kind}/${encodeURIComponent(id)}`, {
    headers: { Authorization: authHeader() },
  });
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    logger.error({ status: res.status, kind, data }, "moyasar fetch failed");
    return null;
  }
  return data;
}

// Keys we set in checkout metadata and rely on at activation time. Two kinds of
// purchase exist: subscription passes (userId + planCode) and decorative
// challenge badges (kind=challenge_badge + userId + challengeId + badgeId).
function hasOwnershipMetadata(meta: Record<string, string>): boolean {
  if (meta.kind === "challenge_badge") {
    return Boolean(meta.userId && meta.challengeId && meta.badgeId);
  }
  return Boolean(meta.userId && meta.planCode);
}

// Verifies a payment or invoice by id. Tries the Payments API first (the hosted
// invoice redirect returns a payment id), falling back to the Invoices API.
export async function verifyPayment(id: string): Promise<VerifiedPayment> {
  const notFound: VerifiedPayment = {
    found: false,
    paid: false,
    status: "not_found",
    reference: id,
    metadata: {},
    amountHalalas: null,
  };

  const payment = await fetchResource("payments", id);
  if (payment) {
    const status = typeof payment.status === "string" ? payment.status : "unknown";
    let metadata = readMetadata(payment);
    // Moyasar does NOT copy invoice metadata onto the payment object. When a
    // buyer pays via the hosted Invoice flow, the redirect returns a payment id
    // whose metadata is empty; the userId/planCode we need live on the parent
    // invoice. Fall back to the invoice's metadata via the payment's invoice_id.
    if (!hasOwnershipMetadata(metadata) && typeof payment.invoice_id === "string") {
      const invoice = await fetchResource("invoices", payment.invoice_id);
      if (invoice) {
        const invoiceMeta = readMetadata(invoice);
        metadata = { ...invoiceMeta, ...metadata };
        logger.info(
          {
            paymentId: String(payment.id ?? id),
            invoiceId: payment.invoice_id,
            recovered: hasOwnershipMetadata(metadata),
          },
          "moyasar payment metadata empty; fell back to invoice metadata",
        );
      } else {
        logger.warn(
          { paymentId: String(payment.id ?? id), invoiceId: payment.invoice_id },
          "moyasar payment metadata empty and invoice fallback fetch failed",
        );
      }
    }
    return {
      found: true,
      paid: status === "paid",
      status,
      reference: String(payment.id ?? id),
      metadata,
      amountHalalas:
        typeof payment.amount === "number" ? payment.amount : null,
    };
  }

  const invoice = await fetchResource("invoices", id);
  if (invoice) {
    const status = typeof invoice.status === "string" ? invoice.status : "unknown";
    return {
      found: true,
      paid: status === "paid",
      status,
      reference: String(invoice.id ?? id),
      metadata: readMetadata(invoice),
      amountHalalas:
        typeof invoice.amount === "number" ? invoice.amount : null,
    };
  }

  return notFound;
}

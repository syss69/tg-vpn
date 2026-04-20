type CryptoPayInvoiceStatus = "active" | "paid" | "expired";

export interface CryptoPayInvoice {
  invoice_id: number;
  status: CryptoPayInvoiceStatus;
  asset: string;
  amount: string;
  pay_url?: string;
  created_at?: string;
  paid_at?: string;
  description?: string;
  payload?: string;
}

export interface CryptoPayExchangeRate {
  source: string;
  target: string;
  rate: string;
  is_valid?: boolean;
}

interface CryptoPayApiResponse<T> {
  ok: boolean;
  result?: T;
  error?: { name?: string; code?: number; message?: string };
}

export class CryptoPayService {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(params?: { token?: string; baseUrl?: string }) {
    this.token = params?.token ?? process.env.CRYPTOPAY_TOKEN ?? "";
    if (!this.token) {
      throw new Error("CRYPTOPAY_TOKEN is not set. Add it to .env");
    }
    this.baseUrl = params?.baseUrl ?? process.env.CRYPTOPAY_BASE_URL ?? "https://pay.crypt.bot/api";
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Crypto-Pay-API-Token": this.token,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => null)) as CryptoPayApiResponse<T> | null;
    if (!res.ok || !data || !data.ok || data.result === undefined) {
      const msg =
        data?.error?.message ??
        (typeof data === "object" && data ? JSON.stringify(data) : "") ??
        `${res.status} ${res.statusText}`;
      throw new Error(`CryptoPay API error: ${msg}`.slice(0, 500));
    }
    return data.result;
  }

  async createInvoice(params: {
    asset: string;
    amount: string;
    description?: string;
    payload?: string;
    expiresInSeconds?: number;
  }): Promise<CryptoPayInvoice> {
    return this.request<CryptoPayInvoice>("/createInvoice", {
      asset: params.asset,
      amount: params.amount,
      description: params.description,
      payload: params.payload,
      expires_in: params.expiresInSeconds,
      allow_comments: true,
      allow_anonymous: true,
    });
  }

  async getInvoiceById(invoiceId: number): Promise<CryptoPayInvoice | null> {
    const result = await this.request<{ items: CryptoPayInvoice[] }>("/getInvoices", {
      invoice_ids: String(invoiceId),
    });
    return result.items?.[0] ?? null;
  }

  async getExchangeRates(): Promise<CryptoPayExchangeRate[]> {
    const result = await this.request<{ items: CryptoPayExchangeRate[] }>("/getExchangeRates", {});
    return result.items ?? [];
  }
}


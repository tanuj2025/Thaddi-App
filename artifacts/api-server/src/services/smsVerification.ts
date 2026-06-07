// Swappable SMS OTP verification service. The provider owns OTP generation and
// validation; we only orchestrate send/verify. Authentica is the default
// implementation — swap by providing a different SmsVerificationService.

export interface SendOtpResult {
  success: boolean;
  message: string;
  expiresInSeconds: number | null;
  providerRef?: string | null;
}

export interface VerifyOtpResult {
  success: boolean;
  message: string;
}

export interface SmsVerificationService {
  readonly name: string;
  sendOtp(phone: string): Promise<SendOtpResult>;
  verifyOtp(phone: string, code: string): Promise<VerifyOtpResult>;
}

class ConfigurationError extends Error {}

// Authentica (https://authentica.sa) OTP REST API.
class AuthenticaService implements SmsVerificationService {
  readonly name = "authentica";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly otpExpirySeconds: number;

  constructor() {
    const apiKey = process.env.AUTHENTICA_API_KEY;
    if (!apiKey) {
      throw new ConfigurationError(
        "AUTHENTICA_API_KEY is not configured; SMS verification is unavailable.",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (
      process.env.AUTHENTICA_BASE_URL || "https://api.authentica.sa/api/v1"
    ).replace(/\/$/, "");
    this.otpExpirySeconds = Number(process.env.AUTHENTICA_OTP_TTL || 300);
  }

  private async post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "X-Authorization": this.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  }

  async sendOtp(phone: string): Promise<SendOtpResult> {
    const { ok, data } = await this.post("/send-otp", {
      phone,
      method: "sms",
    });
    if (!ok) {
      return {
        success: false,
        message:
          (typeof data.message === "string" && data.message) ||
          "Failed to send verification code.",
        expiresInSeconds: null,
      };
    }
    return {
      success: true,
      message:
        (typeof data.message === "string" && data.message) ||
        "Verification code sent.",
      expiresInSeconds: this.otpExpirySeconds,
      providerRef: typeof data.id === "string" ? data.id : null,
    };
  }

  async verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
    const { ok, data } = await this.post("/verify-otp", {
      phone,
      otp: code,
    });
    if (!ok) {
      return {
        success: false,
        message:
          (typeof data.message === "string" && data.message) ||
          "Invalid or expired verification code.",
      };
    }
    return {
      success: true,
      message:
        (typeof data.message === "string" && data.message) || "Verified.",
    };
  }
}

let cached: SmsVerificationService | null = null;

// Returns the active SMS verification service, or null when no provider is
// configured (callers surface an explicit error — never a silent pass).
export function getSmsVerificationService(): SmsVerificationService | null {
  if (cached) return cached;
  try {
    cached = new AuthenticaService();
    return cached;
  } catch (err) {
    if (err instanceof ConfigurationError) return null;
    throw err;
  }
}

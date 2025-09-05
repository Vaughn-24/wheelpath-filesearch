import pino from "pino";

/**
 * Logger instance with pretty printing for development
 */
export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

/**
 * Environment configuration with validation
 */
export const config = {
  port: parseInt(process.env.PORT || "8080"),
  nodeEnv: process.env.NODE_ENV || "development",

  // Twilio
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER!,

  // Redis
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // eCLIPSE
  eclipseEmail: process.env.ECLIPSE_EMAIL!,
  eclipsePassword: process.env.ECLIPSE_PASSWORD!,

  // Security
  allowedPhoneNumbers: process.env.ALLOWED_PHONE_NUMBERS?.split(",") || [],
  rateLimitActionsPerHour: parseInt(
    process.env.RATE_LIMIT_ACTIONS_PER_HOUR || "6"
  ),
};

/**
 * Validate required environment variables
 */
export function validateConfig(): void {
  const required = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "ECLIPSE_EMAIL",
    "ECLIPSE_PASSWORD",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error({ missing }, "Missing required environment variables");
    process.exit(1);
  }

  if (config.allowedPhoneNumbers.length === 0) {
    logger.warn(
      "No allowed phone numbers configured - all numbers will be blocked"
    );
  }

  logger.info("Configuration validated successfully");
}

/**
 * Format phone number to E.164 format
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // Add +1 if it's a 10-digit US number
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Add + if it starts with country code
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Return as-is if already formatted
  return phone.startsWith("+") ? phone : `+${digits}`;
}

/**
 * Check if phone number is in allowlist
 */
export function isPhoneAllowed(phone: string): boolean {
  const formatted = formatPhoneNumber(phone);
  return config.allowedPhoneNumbers.some(
    (allowed) => formatPhoneNumber(allowed) === formatted
  );
}

/**
 * Generate timestamp for logging and file names
 */
export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Sanitize text for file names
 */
export function sanitizeFilename(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);
}

/**
 * Sleep utility for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract permit number from various formats
 */
export function extractPermitNumber(text: string): string | null {
  // Common permit number patterns
  const patterns = [
    /P\d{4}-\d{3}/i, // P2024-001
    /\d{4}-\d{3}/, // 2024-001
    /P\d{7}/i, // P2024001
    /\d{7}/, // 2024001
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].toUpperCase();
    }
  }

  return null;
}

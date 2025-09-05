import twilio from "twilio";
import { config, logger, formatPhoneNumber } from "./utils.js";

// Initialize Twilio client
const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

/**
 * Send SMS message via Twilio
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  try {
    const formattedTo = formatPhoneNumber(to);

    logger.info({ to: formattedTo }, "Sending SMS");

    const message = await client.messages.create({
      body: body.substring(0, 1600), // SMS limit with buffer
      from: config.twilioPhoneNumber,
      to: formattedTo,
    });

    logger.info(
      {
        to: formattedTo,
        sid: message.sid,
        status: message.status,
      },
      "SMS sent successfully"
    );

    return true;
  } catch (error) {
    logger.error({ error, to }, "Failed to send SMS");
    return false;
  }
}

/**
 * Send error message to user
 */
export async function sendErrorMessage(
  to: string,
  originalCommand?: string
): Promise<void> {
  const errorMsg = originalCommand
    ? `❌ Sorry, there was an error processing "${originalCommand}". Please try again later or contact support.`
    : "❌ Sorry, there was an error processing your request. Please try again later.";

  await sendSms(to, errorMsg);
}

/**
 * Send rate limit exceeded message
 */
export async function sendRateLimitMessage(to: string): Promise<void> {
  const msg = `⏰ Rate limit exceeded. You can send up to ${config.rateLimitActionsPerHour} commands per hour. Please try again later.`;
  await sendSms(to, msg);
}

/**
 * Send unauthorized message for non-allowlisted numbers
 */
export async function sendUnauthorizedMessage(to: string): Promise<void> {
  const msg =
    "🚫 Unauthorized. This number is not allowed to use this service.";
  await sendSms(to, msg);
}

/**
 * Generate TwiML response for immediate replies
 */
export function generateTwiMLResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
}

/**
 * Escape XML characters for TwiML
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format permit data for SMS display
 */
export function formatPermitForSMS(permit: {
  address?: string;
  permitNumber?: string;
  type?: string;
  status?: string;
  lastAction?: string;
  nextAction?: string;
  url?: string;
}): string {
  const lines = [];

  if (permit.permitNumber) {
    lines.push(`🏗️ ${permit.permitNumber}`);
  }

  if (permit.address) {
    lines.push(`📍 ${permit.address}`);
  }

  if (permit.type) {
    lines.push(`📋 ${permit.type}`);
  }

  if (permit.status) {
    const statusEmoji = getStatusEmoji(permit.status);
    lines.push(`${statusEmoji} ${permit.status}`);
  }

  if (permit.lastAction) {
    lines.push(`📅 Last: ${permit.lastAction}`);
  }

  if (permit.nextAction) {
    lines.push(`⏭️ Next: ${permit.nextAction}`);
  }

  if (permit.url) {
    lines.push(`🔗 ${permit.url}`);
  }

  return lines.join("\n");
}

/**
 * Get emoji for permit status
 */
function getStatusEmoji(status: string): string {
  const statusLower = status.toLowerCase();

  if (statusLower.includes("approved") || statusLower.includes("complete")) {
    return "✅";
  }
  if (statusLower.includes("pending") || statusLower.includes("review")) {
    return "⏳";
  }
  if (statusLower.includes("rejected") || statusLower.includes("denied")) {
    return "❌";
  }
  if (statusLower.includes("correction") || statusLower.includes("revision")) {
    return "🔄";
  }
  if (statusLower.includes("inspection")) {
    return "🔍";
  }

  return "📋";
}

/**
 * Format multiple permits for LIST command
 */
export function formatPermitListForSMS(
  permits: Array<{
    permitNumber?: string;
    address?: string;
    status?: string;
    type?: string;
  }>
): string {
  if (permits.length === 0) {
    return "📋 No open permits found.";
  }

  const lines = ["📋 Open Permits:"];

  permits.slice(0, 5).forEach((permit, index) => {
    const statusEmoji = permit.status ? getStatusEmoji(permit.status) : "📋";
    const line = `${index + 1}. ${statusEmoji} ${
      permit.permitNumber || "Unknown"
    } - ${permit.address || "No address"}`;
    lines.push(line);
  });

  if (permits.length > 5) {
    lines.push(`\n...and ${permits.length - 5} more`);
  }

  return lines.join("\n");
}

import { z } from "zod";

// Intent types for SMS commands
export type Intent =
  | { type: "HELP" }
  | { type: "STATUS"; query: string }
  | { type: "LIST"; filter: "OPEN" }
  | { type: "FEES" }
  | { type: "INSPECT"; permitNumber: string; timeWindow: string; notes: string }
  | { type: "UNKNOWN"; originalText: string };

// Zod schemas for validation
const StatusSchema = z.object({
  type: z.literal("STATUS"),
  query: z.string().min(1),
});

const ListSchema = z.object({
  type: z.literal("LIST"),
  filter: z.literal("OPEN"),
});

const InspectSchema = z.object({
  type: z.literal("INSPECT"),
  permitNumber: z.string().min(1),
  timeWindow: z.string().min(1),
  notes: z.string(),
});

/**
 * Parse incoming SMS text into structured intents
 */
export function parseIntent(text: string): Intent {
  const normalized = text.trim().toUpperCase();

  // HELP command
  if (normalized === "HELP" || normalized === "H") {
    return { type: "HELP" };
  }

  // STATUS command - STATUS <address|permit#>
  if (normalized.startsWith("STATUS ")) {
    const query = text.substring(7).trim();
    if (query.length > 0) {
      return { type: "STATUS", query };
    }
  }

  // LIST command - LIST OPEN
  if (normalized === "LIST OPEN" || normalized === "LIST") {
    return { type: "LIST", filter: "OPEN" };
  }

  // FEES command
  if (normalized === "FEES" || normalized === "FEE") {
    return { type: "FEES" };
  }

  // INSPECT command - INSPECT <permit#> <date/window> notes: <text>
  if (normalized.startsWith("INSPECT ")) {
    const restText = text.substring(8).trim();

    // Look for "notes:" separator
    const notesIndex = restText.toLowerCase().indexOf("notes:");
    let notes = "";
    let beforeNotes = restText;

    if (notesIndex !== -1) {
      notes = restText.substring(notesIndex + 6).trim();
      beforeNotes = restText.substring(0, notesIndex).trim();
    }

    // Split remaining text to get permit number and time window
    const parts = beforeNotes.split(/\s+/);
    if (parts.length >= 2) {
      const permitNumber = parts[0];
      const timeWindow = parts.slice(1).join(" ");

      return {
        type: "INSPECT",
        permitNumber,
        timeWindow,
        notes,
      };
    }
  }

  // Unknown command
  return { type: "UNKNOWN", originalText: text };
}

/**
 * Validate parsed intent using Zod schemas
 */
export function validateIntent(intent: Intent): boolean {
  try {
    switch (intent.type) {
      case "STATUS":
        StatusSchema.parse(intent);
        return true;
      case "LIST":
        ListSchema.parse(intent);
        return true;
      case "INSPECT":
        InspectSchema.parse(intent);
        return true;
      case "HELP":
      case "FEES":
      case "UNKNOWN":
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Get help text for available commands
 */
export function getHelpText(): string {
  return `🔧 eClipseRunner Commands:

HELP - Show this help
STATUS <address|permit#> - Get permit status
LIST OPEN - Show open permits
FEES - Get fees page link  
INSPECT <permit#> <time> notes: <text> - Request inspection

Examples:
• STATUS 123 Main St
• STATUS P2024-001
• LIST OPEN
• INSPECT P2024-001 FRI AM notes: Ready for final`;
}

/**
 * Format error message for unknown commands
 */
export function getUnknownCommandMessage(originalText: string): string {
  return `❌ Unknown command: "${originalText}"

Send HELP for available commands.`;
}

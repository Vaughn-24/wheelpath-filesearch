/**
 * The specific trades targeted for the WheelPath Pilot Program.
 * These are used by the LLM to derive trade-specific implications from RFIs.
 */
export const PILOT_TRADES = [
  'Concrete',
  'Masonry',
  'Steel',
  'Carpentry',
  'Glass & Glazing',
  'Fire Suppression',
  'Plumbing',
  'HVAC',
  'Electrical',
  'Earthwork',
] as const;

export type PilotTrade = (typeof PILOT_TRADES)[number];

import { Page } from "playwright";
import { logger, sleep } from "../utils.js";

/**
 * Open inspection page for a specific permit
 */
export async function openInspectionPage(
  page: Page,
  permitNumber: string
): Promise<string> {
  try {
    logger.debug({ permitNumber }, "Opening inspection page");

    // Look for inspection-related links or buttons
    const inspectionSelectors = [
      'a:has-text("Inspection")',
      'button:has-text("Inspection")',
      'a:has-text("Request Inspection")',
      'button:has-text("Request Inspection")',
      'a:has-text("Schedule")',
      'button:has-text("Schedule")',
      ".inspection-link",
      ".schedule-inspection",
      '[data-testid="inspection-link"]',
      'a[href*="inspection"]',
      'button[data-action*="inspection"]',
    ];

    let clicked = false;
    for (const selector of inspectionSelectors) {
      try {
        const element = page.locator(selector).first();

        if (await element.isVisible({ timeout: 2000 })) {
          logger.debug({ selector }, "Found inspection link");

          await Promise.all([
            page.waitForLoadState("networkidle", { timeout: 15000 }),
            element.click(),
          ]);

          clicked = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!clicked) {
      // Try to find inspection section in tabs or accordion
      const tabSelectors = [
        'a[role="tab"]:has-text("Inspection")',
        'button[role="tab"]:has-text("Inspection")',
        '.tab:has-text("Inspection")',
        '.tab-header:has-text("Inspection")',
      ];

      for (const selector of tabSelectors) {
        try {
          const tab = page.locator(selector).first();
          if (await tab.isVisible({ timeout: 2000 })) {
            await tab.click();
            clicked = true;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!clicked) {
      // Look for accordion or expandable sections
      const accordionSelectors = [
        '.accordion-header:has-text("Inspection")',
        '.collapsible:has-text("Inspection")',
        '.expandable:has-text("Inspection")',
        'details summary:has-text("Inspection")',
      ];

      for (const selector of accordionSelectors) {
        try {
          const accordion = page.locator(selector).first();
          if (await accordion.isVisible({ timeout: 2000 })) {
            await accordion.click();
            clicked = true;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!clicked) {
      // Try to navigate through main menu
      await navigateToInspectionSection(page);
    }

    // Wait for inspection page/section to load
    await sleep(2000);

    // Verify we're on inspection page
    const inspectionPageIndicators = [
      'text="Inspection"',
      'text="Schedule"',
      ".inspection-form",
      ".schedule-form",
      '[data-testid="inspection-form"]',
    ];

    let onInspectionPage = false;
    for (const indicator of inspectionPageIndicators) {
      try {
        if (await page.locator(indicator).isVisible({ timeout: 3000 })) {
          onInspectionPage = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!onInspectionPage) {
      logger.warn("Could not verify navigation to inspection page");
    }

    const inspectionUrl = page.url();
    logger.info({ permitNumber, url: inspectionUrl }, "Opened inspection page");

    return inspectionUrl;
  } catch (error) {
    logger.error({ error, permitNumber }, "Error opening inspection page");
    throw new Error(
      `Failed to open inspection page: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Navigate to inspection section through main navigation
 */
async function navigateToInspectionSection(page: Page): Promise<void> {
  try {
    logger.debug("Navigating to inspection section through main nav");

    // Look for main navigation menu
    const navSelectors = [
      '.navigation a:has-text("Inspection")',
      '.nav-menu a:has-text("Inspection")',
      '.main-nav a:has-text("Inspection")',
      '[role="navigation"] a:has-text("Inspection")',
      '.sidebar a:has-text("Inspection")',
      '.menu a:has-text("Inspection")',
    ];

    for (const selector of navSelectors) {
      try {
        const navLink = page.locator(selector).first();
        if (await navLink.isVisible({ timeout: 2000 })) {
          await navLink.click();
          await sleep(2000);
          return;
        }
      } catch {
        continue;
      }
    }

    // Try dropdown menus
    const dropdownSelectors = [
      '.dropdown:has-text("Service")',
      '.dropdown:has-text("Request")',
      '.dropdown:has-text("More")',
    ];

    for (const selector of dropdownSelectors) {
      try {
        const dropdown = page.locator(selector).first();
        if (await dropdown.isVisible({ timeout: 2000 })) {
          await dropdown.click();
          await sleep(500);

          // Look for inspection link in dropdown
          const inspectionLink = dropdown
            .locator('a:has-text("Inspection"), a:has-text("Schedule")')
            .first();
          if (await inspectionLink.isVisible({ timeout: 1000 })) {
            await inspectionLink.click();
            return;
          }
        }
      } catch {
        continue;
      }
    }

    logger.warn("Could not find inspection navigation");
  } catch (error) {
    logger.error({ error }, "Error navigating to inspection section");
  }
}

/**
 * Fill inspection request form (if found)
 */
export async function fillInspectionRequest(
  page: Page,
  permitNumber: string,
  timeWindow: string,
  notes: string
): Promise<boolean> {
  try {
    logger.debug(
      { permitNumber, timeWindow, notes },
      "Filling inspection request form"
    );

    // Look for permit number field
    const permitFields = [
      'input[name*="permit"]',
      'input[placeholder*="permit" i]',
      'select[name*="permit"]',
      "#permit-number",
      ".permit-input",
    ];

    for (const selector of permitFields) {
      try {
        const field = page.locator(selector).first();
        if (await field.isVisible({ timeout: 2000 })) {
          await field.fill(permitNumber);
          break;
        }
      } catch {
        continue;
      }
    }

    // Look for time/date fields
    const timeFields = [
      'select[name*="time"]',
      'select[name*="window"]',
      'input[name*="date"]',
      'input[type="date"]',
      'select[name*="schedule"]',
      ".time-selection",
      ".date-picker",
    ];

    for (const selector of timeFields) {
      try {
        const field = page.locator(selector).first();
        if (await field.isVisible({ timeout: 2000 })) {
          if (field.locator("option").first()) {
            // It's a select dropdown
            const options = await field.locator("option").allTextContents();
            const matchingOption = options.find(
              (option) =>
                option.toLowerCase().includes(timeWindow.toLowerCase()) ||
                timeWindow.toLowerCase().includes(option.toLowerCase())
            );

            if (matchingOption) {
              await field.selectOption({ label: matchingOption });
            }
          } else {
            // It's an input field
            await field.fill(timeWindow);
          }
          break;
        }
      } catch {
        continue;
      }
    }

    // Look for notes/comments field
    if (notes) {
      const notesFields = [
        'textarea[name*="note"]',
        'textarea[name*="comment"]',
        'textarea[placeholder*="note" i]',
        'textarea[placeholder*="comment" i]',
        'input[name*="note"]',
        'input[name*="comment"]',
        ".notes-field",
        ".comments-field",
      ];

      for (const selector of notesFields) {
        try {
          const field = page.locator(selector).first();
          if (await field.isVisible({ timeout: 2000 })) {
            await field.fill(notes);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    logger.info("Inspection request form filled");
    return true;
  } catch (error) {
    logger.error({ error }, "Error filling inspection request form");
    return false;
  }
}

/**
 * Submit inspection request form
 */
export async function submitInspectionRequest(page: Page): Promise<boolean> {
  try {
    logger.debug("Submitting inspection request form");

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Request")',
      'button:has-text("Schedule")',
      ".submit-button",
      '[data-testid="submit-button"]',
    ];

    for (const selector of submitSelectors) {
      try {
        const button = page.locator(selector).first();
        if (
          (await button.isVisible({ timeout: 2000 })) &&
          (await button.isEnabled())
        ) {
          await button.click();

          // Wait for submission to complete
          await sleep(3000);

          // Look for success message
          const successSelectors = [
            'text="Success"',
            'text="Submitted"',
            'text="Requested"',
            'text="Scheduled"',
            ".success-message",
            ".alert-success",
          ];

          for (const successSelector of successSelectors) {
            try {
              if (
                await page.locator(successSelector).isVisible({ timeout: 3000 })
              ) {
                logger.info("Inspection request submitted successfully");
                return true;
              }
            } catch {
              continue;
            }
          }

          // Even if no success message, consider it submitted if button was clicked
          logger.info(
            "Inspection request form submitted (no confirmation message found)"
          );
          return true;
        }
      } catch {
        continue;
      }
    }

    logger.warn("Could not find or click submit button");
    return false;
  } catch (error) {
    logger.error({ error }, "Error submitting inspection request");
    return false;
  }
}

/**
 * Get available inspection time slots
 */
export async function getAvailableTimeSlots(page: Page): Promise<string[]> {
  try {
    logger.debug("Getting available inspection time slots");

    const timeSlots: string[] = [];

    // Look for time selection dropdown
    const timeSelectors = [
      'select[name*="time"] option',
      'select[name*="window"] option',
      'select[name*="schedule"] option',
      ".time-slot",
      ".available-time",
    ];

    for (const selector of timeSelectors) {
      try {
        const options = await page.locator(selector).allTextContents();
        if (options.length > 0) {
          timeSlots.push(
            ...options.filter((option) => option.trim() && option.trim() !== "")
          );
          break;
        }
      } catch {
        continue;
      }
    }

    logger.debug({ timeSlots }, "Available time slots found");
    return timeSlots;
  } catch (error) {
    logger.error({ error }, "Error getting available time slots");
    return [];
  }
}

/**
 * Check if inspection can be requested for this permit
 */
export async function canRequestInspection(
  page: Page,
  permitNumber: string
): Promise<boolean> {
  try {
    logger.debug({ permitNumber }, "Checking if inspection can be requested");

    // Look for inspection request button or form
    const inspectionElements = [
      'button:has-text("Request Inspection")',
      'button:has-text("Schedule Inspection")',
      'form[action*="inspection"]',
      ".inspection-form",
      ".schedule-form",
    ];

    for (const selector of inspectionElements) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          logger.debug({ selector }, "Found inspection request element");
          return true;
        }
      } catch {
        continue;
      }
    }

    // Check permit status - some statuses don't allow inspections
    const statusText = (await page.textContent("body")) || "";
    const statusLower = statusText.toLowerCase();

    if (
      statusLower.includes("rejected") ||
      statusLower.includes("denied") ||
      statusLower.includes("cancelled")
    ) {
      logger.debug("Permit status does not allow inspection requests");
      return false;
    }

    logger.debug("Cannot determine if inspection can be requested");
    return false;
  } catch (error) {
    logger.error(
      { error, permitNumber },
      "Error checking inspection request availability"
    );
    return false;
  }
}

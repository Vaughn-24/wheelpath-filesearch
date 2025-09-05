import { Page } from "playwright";
import { logger, sleep } from "../utils.js";

/**
 * Navigate to "My Permits" section
 */
export async function navigateToMyPermits(page: Page): Promise<void> {
  try {
    logger.debug("Navigating to My Permits section");

    // Common selectors for "My Permits" or similar navigation
    const myPermitsSelectors = [
      'a:has-text("My Permits")',
      'a:has-text("Permits")',
      'button:has-text("My Permits")',
      'button:has-text("Permits")',
      '[data-testid="my-permits"]',
      '[href*="permits"]',
      '[href*="myapplications"]',
      ".nav-permits",
      "#nav-permits",
      'text="My Applications"',
      'a:has-text("My Applications")',
    ];

    let clicked = false;

    // Try each selector until one works
    for (const selector of myPermitsSelectors) {
      try {
        const element = page.locator(selector).first();

        if (await element.isVisible({ timeout: 2000 })) {
          logger.debug({ selector }, "Found My Permits navigation element");

          await Promise.all([
            page.waitForLoadState("networkidle", { timeout: 15000 }),
            element.click(),
          ]);

          clicked = true;
          break;
        }
      } catch (error) {
        logger.debug(
          {
            selector,
            error: error instanceof Error ? error.message : "Unknown",
          },
          "Selector failed"
        );
        continue;
      }
    }

    if (!clicked) {
      // Try to find any navigation menu first
      const menuSelectors = [
        ".navigation",
        ".nav-menu",
        ".main-nav",
        '[role="navigation"]',
        ".sidebar",
        ".menu",
      ];

      for (const menuSelector of menuSelectors) {
        try {
          const menu = page.locator(menuSelector);
          if (await menu.isVisible()) {
            // Look for permits link within the menu
            const permitLink = menu
              .locator('a:has-text("Permit"), a:has-text("Application")')
              .first();
            if (await permitLink.isVisible()) {
              await permitLink.click();
              clicked = true;
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }

    if (!clicked) {
      // Last resort: look for any link containing "permit" in the href
      try {
        const permitLink = page
          .locator('a[href*="permit" i], a[href*="application" i]')
          .first();
        if (await permitLink.isVisible()) {
          await permitLink.click();
          clicked = true;
        }
      } catch {
        // Continue to error handling
      }
    }

    if (!clicked) {
      throw new Error("Could not find My Permits navigation element");
    }

    // Wait for page to load
    await sleep(2000);

    // Verify we're on permits page by looking for permit-related content
    const permitPageIndicators = [
      'text="Permit"',
      'text="Application"',
      ".permit-list",
      ".application-list",
      "table",
      '[data-testid="permit-list"]',
    ];

    let onPermitsPage = false;
    for (const indicator of permitPageIndicators) {
      try {
        if (await page.locator(indicator).isVisible({ timeout: 5000 })) {
          onPermitsPage = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!onPermitsPage) {
      logger.warn("Could not verify navigation to permits page");
    }

    logger.info({ url: page.url() }, "Successfully navigated to My Permits");
  } catch (error) {
    logger.error({ error }, "Failed to navigate to My Permits");
    throw new Error(
      `Navigation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Wait for permit list to load
 */
export async function waitForPermitList(page: Page): Promise<void> {
  try {
    logger.debug("Waiting for permit list to load");

    // Look for permit list container
    const listSelectors = [
      ".permit-list",
      ".application-list",
      "table tbody",
      ".grid-container",
      ".data-grid",
      '[data-testid="permit-list"]',
      ".results",
      ".search-results",
    ];

    let listFound = false;
    for (const selector of listSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        listFound = true;
        logger.debug({ selector }, "Permit list loaded");
        break;
      } catch {
        continue;
      }
    }

    if (!listFound) {
      // Check if there's a "no results" message
      const noResultsSelectors = [
        'text="No permits"',
        'text="No applications"',
        'text="No results"',
        ".no-results",
        ".empty-state",
      ];

      for (const selector of noResultsSelectors) {
        try {
          if (await page.locator(selector).isVisible({ timeout: 3000 })) {
            logger.info("No permits found (empty state)");
            return;
          }
        } catch {
          continue;
        }
      }

      throw new Error("Could not find permit list or empty state");
    }

    // Wait for any loading indicators to disappear
    const loadingSelectors = [
      ".loading",
      ".spinner",
      ".loader",
      '[data-testid="loading"]',
    ];

    for (const selector of loadingSelectors) {
      try {
        await page.waitForSelector(selector, {
          state: "hidden",
          timeout: 5000,
        });
      } catch {
        // Loading indicator might not exist, that's fine
      }
    }

    // Small delay to ensure everything is settled
    await sleep(1000);
  } catch (error) {
    logger.error({ error }, "Failed to wait for permit list");
    throw error;
  }
}

/**
 * Open first permit result (for detailed view)
 */
export async function openFirstResult(page: Page): Promise<void> {
  try {
    logger.debug("Opening first permit result");

    // Look for clickable permit entries
    const resultSelectors = [
      "table tbody tr:first-child td:first-child a",
      "table tbody tr:first-child a",
      ".permit-list .permit-item:first-child a",
      ".application-list .application-item:first-child a",
      ".results .result:first-child a",
      ".grid-row:first-child a",
      '[data-testid="permit-row"]:first-child a',
    ];

    let clicked = false;
    for (const selector of resultSelectors) {
      try {
        const element = page.locator(selector).first();

        if (await element.isVisible({ timeout: 2000 })) {
          logger.debug({ selector }, "Found first result link");

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
      // Try clicking on first row without specific link
      const rowSelectors = [
        "table tbody tr:first-child",
        ".permit-list .permit-item:first-child",
        ".application-list .application-item:first-child",
        ".results .result:first-child",
        ".grid-row:first-child",
      ];

      for (const selector of rowSelectors) {
        try {
          const element = page.locator(selector).first();

          if (await element.isVisible({ timeout: 2000 })) {
            await element.click();
            clicked = true;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!clicked) {
      throw new Error("Could not find clickable permit result");
    }

    // Wait for detail page to load
    await sleep(2000);

    logger.info({ url: page.url() }, "Opened first permit result");
  } catch (error) {
    logger.error({ error }, "Failed to open first result");
    throw error;
  }
}

/**
 * Navigate back to permit list
 */
export async function navigateBackToList(page: Page): Promise<void> {
  try {
    logger.debug("Navigating back to permit list");

    // Look for back button or breadcrumb
    const backSelectors = [
      'button:has-text("Back")',
      'a:has-text("Back")',
      'button:has-text("← Back")',
      ".back-button",
      ".breadcrumb a:last-child",
      '[data-testid="back-button"]',
    ];

    let clicked = false;
    for (const selector of backSelectors) {
      try {
        const element = page.locator(selector).first();

        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          clicked = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!clicked) {
      // Try browser back
      await page.goBack();
    }

    // Wait for list to reload
    await waitForPermitList(page);

    logger.debug("Navigated back to permit list");
  } catch (error) {
    logger.error({ error }, "Failed to navigate back to list");
    throw error;
  }
}

/**
 * Check if we're currently on a permit detail page
 */
export async function isOnPermitDetailPage(page: Page): Promise<boolean> {
  try {
    const detailIndicators = [
      'text="Permit Details"',
      'text="Application Details"',
      ".permit-detail",
      ".application-detail",
      ".detail-view",
      '[data-testid="permit-detail"]',
    ];

    for (const indicator of detailIndicators) {
      try {
        if (await page.locator(indicator).isVisible({ timeout: 1000 })) {
          return true;
        }
      } catch {
        continue;
      }
    }

    // Check URL patterns
    const url = page.url().toLowerCase();
    const detailUrlPatterns = ["detail", "view", "permit/", "application/"];

    return detailUrlPatterns.some((pattern) => url.includes(pattern));
  } catch {
    return false;
  }
}

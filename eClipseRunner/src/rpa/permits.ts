import { Page } from "playwright";
import { logger, sleep, extractPermitNumber } from "../utils.js";
import { waitForPermitList, openFirstResult } from "./nav.js";

// Interface for permit data
export interface PermitData {
  permitNumber?: string;
  address?: string;
  type?: string;
  status?: string;
  lastAction?: string;
  nextAction?: string;
  submittedDate?: string;
  url?: string;
}

/**
 * Search for permit by permit number
 */
export async function searchPermitByNumber(
  page: Page,
  permitNumber: string
): Promise<PermitData | null> {
  try {
    logger.debug({ permitNumber }, "Searching for permit by number");

    const cleanPermitNumber = extractPermitNumber(permitNumber) || permitNumber;

    // Look for search box
    const searchSelectors = [
      'input[type="search"]',
      'input[name*="search"]',
      'input[placeholder*="search" i]',
      'input[placeholder*="permit" i]',
      'input[placeholder*="number" i]',
      ".search-input",
      "#search",
      '[data-testid="search-input"]',
    ];

    let searchBox = null;
    for (const selector of searchSelectors) {
      try {
        searchBox = page.locator(selector).first();
        if (await searchBox.isVisible({ timeout: 2000 })) {
          break;
        }
      } catch {
        continue;
      }
    }

    if (searchBox && (await searchBox.isVisible())) {
      logger.debug("Found search box, performing search");

      // Clear and enter search term
      await searchBox.clear();
      await searchBox.fill(cleanPermitNumber);

      // Look for search button
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'button[type="submit"]',
        'input[type="submit"]',
        ".search-button",
        '[data-testid="search-button"]',
        'button:near(input[type="search"])',
      ];

      let searchButton = null;
      for (const selector of searchButtonSelectors) {
        try {
          searchButton = page.locator(selector).first();
          if (await searchButton.isVisible({ timeout: 1000 })) {
            break;
          }
        } catch {
          continue;
        }
      }

      if (searchButton && (await searchButton.isVisible())) {
        await searchButton.click();
      } else {
        // Try pressing Enter on search box
        await searchBox.press("Enter");
      }

      // Wait for search results
      await sleep(2000);
    } else {
      logger.debug("No search box found, looking through existing results");
    }

    // Wait for permit list to load
    await waitForPermitList(page);

    // Look for permit in the results
    const permit = await findPermitInList(page, cleanPermitNumber);

    if (permit) {
      logger.info(
        { permitNumber: cleanPermitNumber },
        "Found permit by number"
      );
      return permit;
    }

    logger.warn(
      { permitNumber: cleanPermitNumber },
      "Permit not found by number"
    );
    return null;
  } catch (error) {
    logger.error(
      { error, permitNumber },
      "Error searching for permit by number"
    );
    return null;
  }
}

/**
 * Search for permit by address
 */
export async function searchPermitByAddress(
  page: Page,
  address: string
): Promise<PermitData | null> {
  try {
    logger.debug({ address }, "Searching for permit by address");

    // Look for search box (similar to permit number search)
    const searchSelectors = [
      'input[type="search"]',
      'input[name*="search"]',
      'input[placeholder*="search" i]',
      'input[placeholder*="address" i]',
      ".search-input",
      "#search",
      '[data-testid="search-input"]',
    ];

    let searchBox = null;
    for (const selector of searchSelectors) {
      try {
        searchBox = page.locator(selector).first();
        if (await searchBox.isVisible({ timeout: 2000 })) {
          break;
        }
      } catch {
        continue;
      }
    }

    if (searchBox && (await searchBox.isVisible())) {
      logger.debug("Found search box, performing address search");

      // Clear and enter search term
      await searchBox.clear();
      await searchBox.fill(address);

      // Press Enter or click search button
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'button[type="submit"]',
        'input[type="submit"]',
        ".search-button",
        '[data-testid="search-button"]',
      ];

      let searchButton = null;
      for (const selector of searchButtonSelectors) {
        try {
          searchButton = page.locator(selector).first();
          if (await searchButton.isVisible({ timeout: 1000 })) {
            break;
          }
        } catch {
          continue;
        }
      }

      if (searchButton && (await searchButton.isVisible())) {
        await searchButton.click();
      } else {
        await searchBox.press("Enter");
      }

      // Wait for search results
      await sleep(2000);
    }

    // Wait for permit list to load
    await waitForPermitList(page);

    // Look for permit with matching address
    const permit = await findPermitByAddress(page, address);

    if (permit) {
      logger.info({ address }, "Found permit by address");
      return permit;
    }

    logger.warn({ address }, "Permit not found by address");
    return null;
  } catch (error) {
    logger.error({ error, address }, "Error searching for permit by address");
    return null;
  }
}

/**
 * Find permit in current list by permit number
 */
async function findPermitInList(
  page: Page,
  permitNumber: string
): Promise<PermitData | null> {
  try {
    // Look for table rows or list items containing the permit number
    const permitRowSelectors = [
      `table tbody tr:has-text("${permitNumber}")`,
      `.permit-item:has-text("${permitNumber}")`,
      `.application-item:has-text("${permitNumber}")`,
      `.result:has-text("${permitNumber}")`,
      `[data-testid="permit-row"]:has-text("${permitNumber}")`,
    ];

    for (const selector of permitRowSelectors) {
      try {
        const row = page.locator(selector).first();
        if (await row.isVisible({ timeout: 2000 })) {
          // Extract permit data from the row
          const permitData = await extractPermitDataFromRow(row);

          // Click on the row to get more details
          await row.click();
          await sleep(1000);

          return permitData;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    logger.error({ error, permitNumber }, "Error finding permit in list");
    return null;
  }
}

/**
 * Find permit by address in current list
 */
async function findPermitByAddress(
  page: Page,
  address: string
): Promise<PermitData | null> {
  try {
    const addressLower = address.toLowerCase();

    // Look for table rows or list items containing the address
    const rows = await page
      .locator("table tbody tr, .permit-item, .application-item, .result")
      .all();

    for (const row of rows) {
      try {
        const rowText = await row.textContent();
        if (rowText && rowText.toLowerCase().includes(addressLower)) {
          // Extract permit data from the row
          const permitData = await extractPermitDataFromRow(row);

          // Click on the row to get more details
          await row.click();
          await sleep(1000);

          return permitData;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    logger.error({ error, address }, "Error finding permit by address");
    return null;
  }
}

/**
 * Extract permit data from a table row or list item
 */
async function extractPermitDataFromRow(row: any): Promise<PermitData> {
  try {
    const text = (await row.textContent()) || "";
    const cells = await row.locator("td, .cell, .field").allTextContents();

    const permitData: PermitData = {};

    // Extract permit number
    const permitMatch = extractPermitNumber(text);
    if (permitMatch) {
      permitData.permitNumber = permitMatch;
    }

    // Try to extract other data from cells (common patterns)
    if (cells.length >= 2) {
      // Assume common table structure: [Permit#, Address, Type, Status, ...]
      cells.forEach((cell: string, index: number) => {
        const cellText = cell.trim();
        if (!cellText) return;

        // Try to identify what each cell contains
        if (index === 0 && !permitData.permitNumber) {
          const permitNum = extractPermitNumber(cellText);
          if (permitNum) permitData.permitNumber = permitNum;
        }

        // Look for address patterns
        if (cellText.match(/^\d+\s+\w+/)) {
          permitData.address = cellText;
        }

        // Look for status keywords
        if (
          cellText.match(/approved|pending|review|rejected|complete|issued/i)
        ) {
          permitData.status = cellText;
        }

        // Look for permit type keywords
        if (
          cellText.match(
            /building|electrical|plumbing|mechanical|demo|alteration/i
          )
        ) {
          permitData.type = cellText;
        }
      });
    }

    return permitData;
  } catch (error) {
    logger.error({ error }, "Error extracting permit data from row");
    return {};
  }
}

/**
 * Scrape detailed permit information from current page
 */
export async function scrapePermitDetails(
  page: Page
): Promise<Partial<PermitData>> {
  try {
    logger.debug("Scraping permit details from current page");

    const details: Partial<PermitData> = {};

    // Common selectors for permit details
    const fieldSelectors = [
      {
        field: "permitNumber",
        selectors: [
          '*:has-text("Permit Number") + *',
          '*:has-text("Application Number") + *',
          ".permit-number",
          "#permit-number",
        ],
      },
      {
        field: "address",
        selectors: [
          '*:has-text("Address") + *',
          '*:has-text("Location") + *',
          ".address",
          "#address",
        ],
      },
      {
        field: "type",
        selectors: [
          '*:has-text("Type") + *',
          '*:has-text("Category") + *',
          ".permit-type",
          "#permit-type",
        ],
      },
      {
        field: "status",
        selectors: ['*:has-text("Status") + *', ".status", "#status"],
      },
      {
        field: "lastAction",
        selectors: [
          '*:has-text("Last Action") + *',
          '*:has-text("Recent Activity") + *',
          ".last-action",
        ],
      },
      {
        field: "nextAction",
        selectors: [
          '*:has-text("Next Action") + *',
          '*:has-text("Next Step") + *',
          ".next-action",
        ],
      },
      {
        field: "submittedDate",
        selectors: [
          '*:has-text("Submitted") + *',
          '*:has-text("Date") + *',
          ".submitted-date",
        ],
      },
    ];

    for (const { field, selectors } of fieldSelectors) {
      for (const selector of selectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible({ timeout: 1000 })) {
            const text = await element.textContent();
            if (text && text.trim()) {
              (details as any)[field] = text.trim();
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }

    // Try to extract from definition lists (dt/dd pairs)
    try {
      const dtElements = await page.locator("dt").all();
      for (const dt of dtElements) {
        const label = await dt.textContent();
        if (!label) continue;

        const dd = dt.locator("+ dd");
        if (await dd.isVisible()) {
          const value = await dd.textContent();
          if (!value) continue;

          const labelLower = label.toLowerCase();
          if (labelLower.includes("permit") && labelLower.includes("number")) {
            details.permitNumber = value.trim();
          } else if (labelLower.includes("address")) {
            details.address = value.trim();
          } else if (labelLower.includes("type")) {
            details.type = value.trim();
          } else if (labelLower.includes("status")) {
            details.status = value.trim();
          }
        }
      }
    } catch {
      // Ignore errors in dt/dd extraction
    }

    logger.debug({ details }, "Scraped permit details");
    return details;
  } catch (error) {
    logger.error({ error }, "Error scraping permit details");
    return {};
  }
}

/**
 * Get list of open permits
 */
export async function getOpenPermits(
  page: Page,
  limit: number = 5
): Promise<PermitData[]> {
  try {
    logger.debug({ limit }, "Getting open permits list");

    // Wait for permit list to load
    await waitForPermitList(page);

    const permits: PermitData[] = [];

    // Look for permit rows
    const rowSelectors = [
      "table tbody tr",
      ".permit-item",
      ".application-item",
      ".result",
      '[data-testid="permit-row"]',
    ];

    for (const selector of rowSelectors) {
      try {
        const rows = await page.locator(selector).all();

        if (rows.length > 0) {
          logger.debug({ count: rows.length, selector }, "Found permit rows");

          for (let i = 0; i < Math.min(rows.length, limit); i++) {
            try {
              const permitData = await extractPermitDataFromRow(rows[i]);

              // Only include if we have at least permit number or address
              if (permitData.permitNumber || permitData.address) {
                permits.push(permitData);
              }
            } catch (error) {
              logger.warn(
                { error, rowIndex: i },
                "Error extracting permit data from row"
              );
            }
          }

          break; // Found rows, no need to try other selectors
        }
      } catch {
        continue;
      }
    }

    logger.info({ count: permits.length }, "Retrieved open permits");
    return permits;
  } catch (error) {
    logger.error({ error }, "Error getting open permits");
    return [];
  }
}

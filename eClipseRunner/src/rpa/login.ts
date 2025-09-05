import { Page } from "playwright";
import { config, logger, sleep } from "../utils.js";

// eCLIPSE portal URLs (these may need to be updated based on actual portal)
const ECLIPSE_BASE_URL = "https://eclipsepermits.phila.gov";
const ECLIPSE_LOGIN_URL = `${ECLIPSE_BASE_URL}/eclipse/login`;

/**
 * Login to eCLIPSE portal with GC credentials
 */
export async function loginToEclipse(page: Page): Promise<void> {
  try {
    logger.info("Starting eCLIPSE login process");

    // Navigate to login page
    await page.goto(ECLIPSE_LOGIN_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    logger.debug("Navigated to eCLIPSE login page");

    // Wait for login form to be visible
    await page.waitForSelector(
      'input[type="email"], input[name="email"], input[name="username"]',
      {
        timeout: 10000,
      }
    );

    // Look for email/username field with multiple possible selectors
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[id="email"]',
      'input[id="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
    ];

    let emailField = null;
    for (const selector of emailSelectors) {
      emailField = await page.locator(selector).first();
      if (await emailField.isVisible()) {
        break;
      }
    }

    if (!emailField || !(await emailField.isVisible())) {
      throw new Error("Could not find email/username field");
    }

    // Look for password field
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[id="password"]',
      'input[placeholder*="password" i]',
    ];

    let passwordField = null;
    for (const selector of passwordSelectors) {
      passwordField = await page.locator(selector).first();
      if (await passwordField.isVisible()) {
        break;
      }
    }

    if (!passwordField || !(await passwordField.isVisible())) {
      throw new Error("Could not find password field");
    }

    // Fill in credentials
    logger.debug("Filling in login credentials");
    await emailField.fill(config.eclipseEmail);
    await sleep(500); // Small delay between fields
    await passwordField.fill(config.eclipsePassword);

    // Look for login button
    const loginButtonSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button:has-text("Sign In")',
      'input[value*="Log" i]',
      'input[value*="Sign" i]',
      ".btn-login",
      "#login-button",
      '[data-testid="login-button"]',
    ];

    let loginButton = null;
    for (const selector of loginButtonSelectors) {
      try {
        loginButton = await page.locator(selector).first();
        if (await loginButton.isVisible()) {
          break;
        }
      } catch {
        continue;
      }
    }

    if (!loginButton || !(await loginButton.isVisible())) {
      throw new Error("Could not find login button");
    }

    // Click login button
    logger.debug("Clicking login button");
    await Promise.all([
      page.waitForNavigation({ timeout: 30000 }),
      loginButton.click(),
    ]);

    // Wait a moment for page to settle
    await sleep(2000);

    // Check if login was successful by looking for indicators
    const currentUrl = page.url();
    logger.debug({ currentUrl }, "After login navigation");

    // Check for common error indicators
    const errorSelectors = [
      ".error",
      ".alert-danger",
      ".login-error",
      '[class*="error"]',
      'text="Invalid"',
      'text="incorrect"',
      'text="failed"',
    ];

    for (const selector of errorSelectors) {
      try {
        const errorElement = page.locator(selector);
        if (await errorElement.isVisible()) {
          const errorText = await errorElement.textContent();
          throw new Error(`Login failed: ${errorText}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Login failed")) {
          throw error;
        }
        // Ignore selector errors, continue checking
      }
    }

    // Check if we're still on login page (indication of failure)
    if (currentUrl.includes("login") || currentUrl === ECLIPSE_LOGIN_URL) {
      // Look for any form errors or validation messages
      const validationErrors = await page
        .locator(".field-validation-error, .validation-summary-errors")
        .all();
      if (validationErrors.length > 0) {
        const errorText = await validationErrors[0].textContent();
        throw new Error(`Login validation error: ${errorText}`);
      }

      throw new Error("Login appears to have failed - still on login page");
    }

    // Look for successful login indicators
    const successIndicators = [
      'text="Welcome"',
      'text="Dashboard"',
      'text="My Permits"',
      'text="Logout"',
      ".user-menu",
      ".navigation",
      '[data-testid="user-menu"]',
    ];

    let loginSuccessful = false;
    for (const selector of successIndicators) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible()) {
          loginSuccessful = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!loginSuccessful) {
      logger.warn("Could not verify login success with standard indicators");
      // Don't throw error here - some sites might not have these indicators
    }

    logger.info({ currentUrl }, "eCLIPSE login completed successfully");
  } catch (error) {
    logger.error({ error }, "eCLIPSE login failed");
    throw new Error(
      `Login failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Check if user is already logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Look for logout button or user menu as indicators of being logged in
    const loggedInSelectors = [
      'text="Logout"',
      'text="Log out"',
      'text="Sign out"',
      ".user-menu",
      ".logout",
      '[data-testid="logout"]',
      'a[href*="logout"]',
    ];

    for (const selector of loggedInSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 1000 })) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Login with retry logic for session expiry
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  const maxRetries = 2;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      // Check if already logged in
      if (await isLoggedIn(page)) {
        logger.debug("Already logged in to eCLIPSE");
        return;
      }

      // Attempt login
      await loginToEclipse(page);

      // Verify login was successful
      if (await isLoggedIn(page)) {
        return;
      }

      throw new Error("Login verification failed");
    } catch (error) {
      attempts++;
      logger.warn(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          attempt: attempts,
          maxRetries,
        },
        "Login attempt failed"
      );

      if (attempts >= maxRetries) {
        throw new Error(
          `Login failed after ${maxRetries} attempts: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      // Wait before retry
      await sleep(3000);
    }
  }
}

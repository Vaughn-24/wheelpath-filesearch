import dotenv from "dotenv";
import { Worker, Job } from "bullmq";
import { chromium, Browser, Page } from "playwright";
import { initRedis, closeRedis } from "./rateLimit.js";
import {
  sendSms,
  sendErrorMessage,
  formatPermitForSMS,
  formatPermitListForSMS,
} from "./sms.js";
import {
  config,
  logger,
  validateConfig,
  timestamp,
  sanitizeFilename,
} from "./utils.js";
import { Intent } from "./intents.js";
import { loginToEclipse } from "./rpa/login.js";
import { navigateToMyPermits } from "./rpa/nav.js";
import {
  searchPermitByNumber,
  searchPermitByAddress,
  scrapePermitDetails,
  getOpenPermits,
} from "./rpa/permits.js";
import { openInspectionPage } from "./rpa/inspections.js";

// Load environment variables
dotenv.config();

// Validate configuration
validateConfig();

// Job data interface
interface JobData {
  phoneNumber: string;
  intent: Intent;
  originalMessage: string;
  timestamp: string;
}

// Global browser instance
let browser: Browser | null = null;

/**
 * Initialize browser instance
 */
async function initBrowser(): Promise<Browser> {
  if (!browser) {
    logger.info("Launching browser...");
    browser = await chromium.launch({
      headless: process.env.NODE_ENV === "production",
      slowMo: process.env.NODE_ENV === "development" ? 100 : 0,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    logger.info("Browser launched successfully");
  }
  return browser;
}

/**
 * Get a new page with default settings
 */
async function getNewPage(): Promise<Page> {
  const browser = await initBrowser();
  const page = await browser.newPage();

  // Set viewport and user agent
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  // Set timeout
  page.setDefaultTimeout(30000);

  return page;
}

/**
 * Take screenshot on error
 */
async function takeErrorScreenshot(
  page: Page,
  context: string
): Promise<string> {
  try {
    const filename = `error_${sanitizeFilename(context)}_${timestamp()}.png`;
    const filepath = `fails/${filename}`;

    await page.screenshot({
      path: filepath,
      fullPage: true,
    });

    logger.info({ filepath }, "Error screenshot saved");
    return filepath;
  } catch (error) {
    logger.error({ error }, "Failed to take screenshot");
    return "";
  }
}

/**
 * Process STATUS command
 */
async function processStatusCommand(
  page: Page,
  query: string,
  phoneNumber: string
): Promise<void> {
  try {
    logger.info({ query }, "Processing STATUS command");

    // Login to eCLIPSE
    await loginToEclipse(page);

    // Navigate to My Permits
    await navigateToMyPermits(page);

    // Search for permit
    let permitData;
    if (query.match(/^P?\d+/)) {
      // Looks like a permit number
      permitData = await searchPermitByNumber(page, query);
    } else {
      // Treat as address
      permitData = await searchPermitByAddress(page, query);
    }

    if (!permitData) {
      await sendSms(phoneNumber, `❌ No permit found for "${query}"`);
      return;
    }

    // Scrape detailed permit information
    const details = await scrapePermitDetails(page);
    const fullPermitData = { ...permitData, ...details, url: page.url() };

    // Format and send SMS
    const message = formatPermitForSMS(fullPermitData);
    await sendSms(phoneNumber, message);

    logger.info({ phoneNumber }, "STATUS command completed successfully");
  } catch (error) {
    logger.error({ error, query }, "Error processing STATUS command");
    await takeErrorScreenshot(page, `status_${query}`);
    await sendErrorMessage(phoneNumber, `STATUS ${query}`);
  }
}

/**
 * Process LIST command
 */
async function processListCommand(
  page: Page,
  phoneNumber: string
): Promise<void> {
  try {
    logger.info("Processing LIST command");

    // Login to eCLIPSE
    await loginToEclipse(page);

    // Navigate to My Permits
    await navigateToMyPermits(page);

    // Get open permits
    const permits = await getOpenPermits(page);

    if (permits.length === 0) {
      await sendSms(phoneNumber, "📋 No open permits found.");
      return;
    }

    // Format and send SMS
    const message = formatPermitListForSMS(permits);
    await sendSms(phoneNumber, message);

    logger.info(
      { phoneNumber, count: permits.length },
      "LIST command completed successfully"
    );
  } catch (error) {
    logger.error({ error }, "Error processing LIST command");
    await takeErrorScreenshot(page, "list");
    await sendErrorMessage(phoneNumber, "LIST OPEN");
  }
}

/**
 * Process FEES command
 */
async function processFeesCommand(
  page: Page,
  phoneNumber: string
): Promise<void> {
  try {
    logger.info("Processing FEES command");

    // Login to eCLIPSE
    await loginToEclipse(page);

    // Navigate to fees page (or permits page with fees info)
    await navigateToMyPermits(page);

    // Get the current URL as the fees deep-link
    const feesUrl = page.url();

    const message = `💰 eCLIPSE Fees & Payments:\n🔗 ${feesUrl}`;
    await sendSms(phoneNumber, message);

    logger.info({ phoneNumber }, "FEES command completed successfully");
  } catch (error) {
    logger.error({ error }, "Error processing FEES command");
    await takeErrorScreenshot(page, "fees");
    await sendErrorMessage(phoneNumber, "FEES");
  }
}

/**
 * Process INSPECT command
 */
async function processInspectCommand(
  page: Page,
  permitNumber: string,
  timeWindow: string,
  notes: string,
  phoneNumber: string
): Promise<void> {
  try {
    logger.info(
      { permitNumber, timeWindow, notes },
      "Processing INSPECT command"
    );

    // Login to eCLIPSE
    await loginToEclipse(page);

    // Navigate to My Permits
    await navigateToMyPermits(page);

    // Find and open the permit
    const permitFound = await searchPermitByNumber(page, permitNumber);
    if (!permitFound) {
      await sendSms(phoneNumber, `❌ Permit ${permitNumber} not found`);
      return;
    }

    // Open inspection page
    const inspectionUrl = await openInspectionPage(page, permitNumber);

    const message = `🔍 Inspection Request for ${permitNumber}
📅 Time: ${timeWindow}
📝 Notes: ${notes || "None"}
🔗 ${inspectionUrl}

Please complete the inspection request on the page above.`;

    await sendSms(phoneNumber, message);

    logger.info(
      { phoneNumber, permitNumber },
      "INSPECT command completed successfully"
    );
  } catch (error) {
    logger.error({ error, permitNumber }, "Error processing INSPECT command");
    await takeErrorScreenshot(page, `inspect_${permitNumber}`);
    await sendErrorMessage(phoneNumber, `INSPECT ${permitNumber}`);
  }
}

/**
 * Main job processor
 */
async function processJob(job: Job<JobData>): Promise<void> {
  const { phoneNumber, intent, originalMessage } = job.data;

  logger.info(
    {
      jobId: job.id,
      phoneNumber,
      intent: intent.type,
    },
    "Processing job"
  );

  let page: Page | null = null;

  try {
    // Get a new page for this job
    page = await getNewPage();

    // Process based on intent type
    switch (intent.type) {
      case "STATUS":
        await processStatusCommand(page, intent.query, phoneNumber);
        break;

      case "LIST":
        await processListCommand(page, phoneNumber);
        break;

      case "FEES":
        await processFeesCommand(page, phoneNumber);
        break;

      case "INSPECT":
        await processInspectCommand(
          page,
          intent.permitNumber,
          intent.timeWindow,
          intent.notes,
          phoneNumber
        );
        break;

      default:
        logger.warn({ intent }, "Unknown intent type in worker");
        await sendErrorMessage(phoneNumber, originalMessage);
    }
  } catch (error) {
    logger.error({ error, jobId: job.id }, "Job processing failed");

    if (page) {
      await takeErrorScreenshot(page, `job_${job.id}`);
    }

    await sendErrorMessage(phoneNumber, originalMessage);
    throw error; // Re-throw to mark job as failed
  } finally {
    // Clean up page
    if (page) {
      try {
        await page.close();
      } catch (error) {
        logger.error({ error }, "Error closing page");
      }
    }
  }
}

/**
 * Initialize worker
 */
async function initWorker(): Promise<Worker> {
  const redis = initRedis();

  const worker = new Worker("eclipse-jobs", processJob, {
    connection: redis,
    concurrency: 2, // Process 2 jobs concurrently
  });

  // Worker event handlers
  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Job completed successfully");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err }, "Job failed");
  });

  worker.on("error", (error) => {
    logger.error({ error }, "Worker error");
  });

  worker.on("ready", () => {
    logger.info("Worker ready to process jobs");
  });

  return worker;
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal");

  try {
    // Close browser
    if (browser) {
      await browser.close();
      logger.info("Browser closed");
    }

    // Close worker
    if (worker) {
      await worker.close();
      logger.info("Worker closed");
    }

    // Close Redis
    await closeRedis();

    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during shutdown");
    process.exit(1);
  }
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start worker
const worker = await initWorker();

logger.info("eClipseRunner worker started");

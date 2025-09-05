import express from "express";
import dotenv from "dotenv";
import { Queue } from "bullmq";
import {
  parseIntent,
  getHelpText,
  getUnknownCommandMessage,
} from "./intents.js";
import {
  generateTwiMLResponse,
  sendUnauthorizedMessage,
  sendRateLimitMessage,
} from "./sms.js";
import {
  checkRateLimit,
  incrementRateLimit,
  initRedis,
  closeRedis,
} from "./rateLimit.js";
import {
  config,
  logger,
  validateConfig,
  isPhoneAllowed,
  formatPhoneNumber,
} from "./utils.js";

// Load environment variables
dotenv.config();

// Validate configuration on startup
validateConfig();

// Initialize Express app
const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Redis and job queue
const redis = initRedis();
const jobQueue = new Queue("eclipse-jobs", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 20,
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

/**
 * Health check endpoint
 */
app.get("/health", async (req, res) => {
  try {
    // Check Redis connection
    await redis.ping();

    // Check queue health
    const waiting = await jobQueue.getWaiting();
    const active = await jobQueue.getActive();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      queue: {
        waiting: waiting.length,
        active: active.length,
      },
    });
  } catch (error) {
    logger.error({ error }, "Health check failed");
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Service unavailable",
    });
  }
});

/**
 * Twilio SMS webhook endpoint
 */
app.post("/sms", async (req, res) => {
  try {
    const { From: from, Body: body } = req.body;

    if (!from || !body) {
      logger.warn({ body: req.body }, "Invalid webhook payload");
      return res.status(400).send("Invalid payload");
    }

    const phoneNumber = formatPhoneNumber(from);
    const messageText = body.trim();

    logger.info(
      {
        from: phoneNumber,
        message: messageText,
      },
      "Received SMS"
    );

    // Check if phone number is authorized
    if (!isPhoneAllowed(phoneNumber)) {
      logger.warn({ from: phoneNumber }, "Unauthorized phone number");
      await sendUnauthorizedMessage(phoneNumber);
      return res.status(200).send("OK");
    }

    // Parse the intent
    const intent = parseIntent(messageText);

    // Handle HELP and UNKNOWN commands immediately with TwiML
    if (intent.type === "HELP") {
      const helpText = getHelpText();
      return res.type("xml").send(generateTwiMLResponse(helpText));
    }

    if (intent.type === "UNKNOWN") {
      const unknownText = getUnknownCommandMessage(intent.originalText);
      return res.type("xml").send(generateTwiMLResponse(unknownText));
    }

    // Check rate limiting for actionable commands
    const rateLimitOk = await checkRateLimit(phoneNumber);
    if (!rateLimitOk) {
      logger.warn({ from: phoneNumber }, "Rate limit exceeded");
      await sendRateLimitMessage(phoneNumber);
      return res.status(200).send("OK");
    }

    // Increment rate limit counter
    await incrementRateLimit(phoneNumber);

    // Enqueue job for processing
    const jobData = {
      phoneNumber,
      intent,
      originalMessage: messageText,
      timestamp: new Date().toISOString(),
    };

    const job = await jobQueue.add("process-command", jobData, {
      jobId: `${phoneNumber}-${Date.now()}`,
    });

    logger.info(
      {
        jobId: job.id,
        intent: intent.type,
        from: phoneNumber,
      },
      "Job enqueued"
    );

    // Send immediate acknowledgment via TwiML
    const ackMessage = getAckMessage(intent.type);
    res.type("xml").send(generateTwiMLResponse(ackMessage));
  } catch (error) {
    logger.error({ error }, "Error processing SMS webhook");
    res.status(500).send("Internal server error");
  }
});

/**
 * Get acknowledgment message for different command types
 */
function getAckMessage(intentType: string): string {
  switch (intentType) {
    case "STATUS":
      return "🔍 Looking up permit status...";
    case "LIST":
      return "📋 Retrieving open permits...";
    case "FEES":
      return "💰 Getting fees information...";
    case "INSPECT":
      return "🔍 Processing inspection request...";
    default:
      return "⏳ Processing your request...";
  }
}

/**
 * Admin endpoint to check queue status
 */
app.get("/admin/queue", async (req, res) => {
  try {
    const waiting = await jobQueue.getWaiting();
    const active = await jobQueue.getActive();
    const completed = await jobQueue.getCompleted();
    const failed = await jobQueue.getFailed();

    res.json({
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      jobs: {
        waiting: waiting.map((job) => ({
          id: job.id,
          data: job.data,
          createdAt: job.timestamp,
        })),
        active: active.map((job) => ({
          id: job.id,
          data: job.data,
          processedOn: job.processedOn,
        })),
      },
    });
  } catch (error) {
    logger.error({ error }, "Error getting queue status");
    res.status(500).json({ error: "Failed to get queue status" });
  }
});

/**
 * Admin endpoint to clear failed jobs
 */
app.post("/admin/queue/clear-failed", async (req, res) => {
  try {
    await jobQueue.clean(0, 10, "failed");
    res.json({ message: "Failed jobs cleared" });
  } catch (error) {
    logger.error({ error }, "Error clearing failed jobs");
    res.status(500).json({ error: "Failed to clear jobs" });
  }
});

/**
 * Graceful shutdown handling
 */
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal");

  try {
    // Close queue
    await jobQueue.close();
    logger.info("Job queue closed");

    // Close Redis connection
    await closeRedis();

    // Exit process
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during shutdown");
    process.exit(1);
  }
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
    },
    "eClipseRunner server started"
  );
});

// Handle server errors
server.on("error", (error) => {
  logger.error({ error }, "Server error");
  process.exit(1);
});

export default app;

#!/usr/bin/env node

/**
 * Log Summary Script
 * 
 * Creates a summary of logs for quick reference in prompts.
 * 
 * Usage:
 *   node scripts/log-summary.js --file logs.txt
 *   node scripts/log-summary.js --file logs.txt --component RagService
 */

const { extractLogs, filterLogs } = require('./extract-logs');

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const componentIndex = args.indexOf('--component');
const checkpointIndex = args.indexOf('--checkpoint');

const logFile = fileIndex >= 0 ? args[fileIndex + 1] : null;
const componentFilter = componentIndex >= 0 ? args[componentIndex + 1] : null;
const checkpointFilter = checkpointIndex >= 0 ? args[checkpointIndex + 1] : null;

const fs = require('fs');

function createSummary(logs) {
  const summary = {
    total: logs.length,
    errors: logs.filter(l => l.level === 'error').length,
    warnings: logs.filter(l => l.level === 'warn').length,
    components: {},
    checkpoints: {},
    timeline: [],
  };

  // Group by component
  for (const log of logs) {
    if (log.component) {
      if (!summary.components[log.component]) {
        summary.components[log.component] = { total: 0, errors: 0 };
      }
      summary.components[log.component].total++;
      if (log.level === 'error') {
        summary.components[log.component].errors++;
      }
    }

    if (log.checkpoint) {
      if (!summary.checkpoints[log.checkpoint]) {
        summary.checkpoints[log.checkpoint] = 0;
      }
      summary.checkpoints[log.checkpoint]++;
    }

    if (log.timestamp) {
      summary.timeline.push({
        timestamp: log.timestamp,
        component: log.component,
        checkpoint: log.checkpoint,
        level: log.level,
      });
    }
  }

  // Build markdown summary
  let markdown = '# Log Summary\n\n';
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
  markdown += `## Overview\n\n`;
  markdown += `- **Total Logs:** ${summary.total}\n`;
  markdown += `- **Errors:** ${summary.errors}\n`;
  markdown += `- **Warnings:** ${summary.warnings}\n\n`;

  // Components breakdown
  if (Object.keys(summary.components).length > 0) {
    markdown += `## Components\n\n`;
    for (const [component, stats] of Object.entries(summary.components)) {
      markdown += `- **${component}**: ${stats.total} logs`;
      if (stats.errors > 0) {
        markdown += ` (${stats.errors} errors)`;
      }
      markdown += `\n`;
    }
    markdown += `\n`;
  }

  // Checkpoints breakdown
  if (Object.keys(summary.checkpoints).length > 0) {
    markdown += `## Checkpoints\n\n`;
    const sortedCheckpoints = Object.keys(summary.checkpoints).sort((a, b) => {
      return parseFloat(a) - parseFloat(b);
    });
    for (const checkpoint of sortedCheckpoints) {
      markdown += `- **Checkpoint ${checkpoint}**: ${summary.checkpoints[checkpoint]} logs\n`;
    }
    markdown += `\n`;
  }

  // Error summary
  if (summary.errors > 0) {
    markdown += `## Error Summary\n\n`;
    const errors = logs.filter(l => l.level === 'error');
    for (const error of errors.slice(0, 10)) {
      markdown += `- **${error.component || 'Unknown'}**`;
      if (error.checkpoint) {
        markdown += ` [Checkpoint ${error.checkpoint}]`;
      }
      markdown += `\n`;
      markdown += `  \`\`\`\n`;
      markdown += `  ${error.raw.substring(0, 200).replace(/\n/g, ' ')}\n`;
      markdown += `  \`\`\`\n\n`;
    }
    if (errors.length > 10) {
      markdown += `*... ${errors.length - 10} more errors*\n\n`;
    }
  }

  // Timeline (last 20 events)
  if (summary.timeline.length > 0) {
    markdown += `## Recent Timeline\n\n`;
    const recent = summary.timeline.slice(-20);
    for (const event of recent) {
      markdown += `- **${event.timestamp || 'Unknown'}** `;
      if (event.component) markdown += `[${event.component}] `;
      if (event.checkpoint) markdown += `Checkpoint ${event.checkpoint} `;
      if (event.level === 'error') markdown += `🔴`;
      markdown += `\n`;
    }
    markdown += `\n`;
  }

  return markdown;
}

async function main() {
  let input = '';

  if (logFile) {
    if (!fs.existsSync(logFile)) {
      console.error(`Error: File not found: ${logFile}`);
      process.exit(1);
    }
    input = fs.readFileSync(logFile, 'utf-8');
  } else {
    console.error('Error: --file argument required');
    process.exit(1);
  }

  const logs = extractLogs(input);
  const filtered = filterLogs(logs);
  const summary = createSummary(filtered);

  console.log(summary);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}


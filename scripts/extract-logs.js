#!/usr/bin/env node

/**
 * Log Extraction Script
 * 
 * Extracts and formats logs from files or stdin for easy reference in prompts.
 * 
 * Usage:
 *   # From file
 *   node scripts/extract-logs.js --file logs.txt
 *   
 *   # From stdin (pipe logs)
 *   npm run dev:api 2>&1 | node scripts/extract-logs.js
 *   
 *   # Filter by component
 *   node scripts/extract-logs.js --file logs.txt --component RagService
 *   
 *   # Filter by checkpoint
 *   node scripts/extract-logs.js --file logs.txt --checkpoint 12
 *   
 *   # Save to markdown
 *   node scripts/extract-logs.js --file logs.txt --output debug-logs.md
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const componentIndex = args.indexOf('--component');
const checkpointIndex = args.indexOf('--checkpoint');
const outputIndex = args.indexOf('--output');
const errorOnlyIndex = args.indexOf('--errors');
const timeRangeIndex = args.indexOf('--time-range');

const logFile = fileIndex >= 0 ? args[fileIndex + 1] : null;
const componentFilter = componentIndex >= 0 ? args[componentIndex + 1] : null;
const checkpointFilter = checkpointIndex >= 0 ? args[checkpointIndex + 1] : null;
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
const errorsOnly = errorOnlyIndex >= 0;
const timeRange = timeRangeIndex >= 0 ? args[timeRangeIndex + 1] : null;

// Log patterns
const LOG_PATTERNS = {
  frontend: /\[(ChatContainer|Auth)\]/,
  backend: /\[(HTTP|JwtStrategy|RagController|RagService|VoiceGateway|VoiceService)\]/,
  checkpoint: /\[Checkpoint\s+(\d+(?:\.\d+)?)\]/,
  error: /(ERROR|error|Error|WARN|warn|Warn|FAILED|failed|Failed)/,
};

// Extract logs from input
function extractLogs(input) {
  const lines = input.split('\n');
  const logs = [];
  let currentLog = null;

  for (const line of lines) {
    // Check if this is a new log entry
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z|\d{2}:\d{2}:\d{2})/);
    const componentMatch = line.match(/\[([^\]]+)\]/);
    const checkpointMatch = line.match(/\[Checkpoint\s+(\d+(?:\.\d+)?)\]/);

    if (timestampMatch || componentMatch) {
      // Save previous log if exists
      if (currentLog) {
        logs.push(currentLog);
      }

      // Start new log entry
      currentLog = {
        timestamp: timestampMatch ? timestampMatch[1] : null,
        component: componentMatch ? componentMatch[1] : null,
        checkpoint: checkpointMatch ? checkpointMatch[1] : null,
        level: line.match(LOG_PATTERNS.error) ? 'error' : 'info',
        raw: line,
        lines: [line],
      };
    } else if (currentLog) {
      // Continuation of current log
      currentLog.lines.push(line);
      currentLog.raw += '\n' + line;
    }
  }

  // Add last log
  if (currentLog) {
    logs.push(currentLog);
  }

  return logs;
}

// Filter logs
function filterLogs(logs) {
  let filtered = logs;

  // Filter by component
  if (componentFilter) {
    filtered = filtered.filter(log => 
      log.component && log.component.toLowerCase().includes(componentFilter.toLowerCase())
    );
  }

  // Filter by checkpoint
  if (checkpointFilter) {
    filtered = filtered.filter(log => 
      log.checkpoint && log.checkpoint.startsWith(checkpointFilter)
    );
  }

  // Filter errors only
  if (errorsOnly) {
    filtered = filtered.filter(log => log.level === 'error');
  }

  // Filter by time range (simple implementation - can be enhanced)
  if (timeRange) {
    const [start, end] = timeRange.split('-');
    filtered = filtered.filter(log => {
      if (!log.timestamp) return true;
      // Simple string comparison for ISO timestamps
      return (!start || log.timestamp >= start) && (!end || log.timestamp <= end);
    });
  }

  return filtered;
}

// Format logs as markdown
function formatAsMarkdown(logs) {
  const sections = {
    errors: [],
    checkpoints: {},
    components: {},
  };

  // Organize logs
  for (const log of logs) {
    if (log.level === 'error') {
      sections.errors.push(log);
    }

    if (log.checkpoint) {
      if (!sections.checkpoints[log.checkpoint]) {
        sections.checkpoints[log.checkpoint] = [];
      }
      sections.checkpoints[log.checkpoint].push(log);
    }

    if (log.component) {
      if (!sections.components[log.component]) {
        sections.components[log.component] = [];
      }
      sections.components[log.component].push(log);
    }
  }

  // Build markdown
  let markdown = '# Debug Logs\n\n';
  markdown += `**Extracted:** ${new Date().toISOString()}\n`;
  markdown += `**Total Logs:** ${logs.length}\n\n`;

  // Errors section
  if (sections.errors.length > 0) {
    markdown += '## 🔴 Errors\n\n';
    for (const log of sections.errors) {
      markdown += `### ${log.component || 'Unknown'} ${log.checkpoint ? `[Checkpoint ${log.checkpoint}]` : ''}\n\n`;
      markdown += '```\n';
      markdown += log.raw;
      markdown += '\n```\n\n';
    }
  }

  // Checkpoints section
  if (Object.keys(sections.checkpoints).length > 0) {
    markdown += '## 📍 Checkpoints\n\n';
    const sortedCheckpoints = Object.keys(sections.checkpoints).sort((a, b) => {
      const aNum = parseFloat(a);
      const bNum = parseFloat(b);
      return aNum - bNum;
    });

    for (const checkpoint of sortedCheckpoints) {
      markdown += `### Checkpoint ${checkpoint}\n\n`;
      for (const log of sections.checkpoints[checkpoint]) {
        markdown += `**${log.component || 'Unknown'}** ${log.timestamp ? `(${log.timestamp})` : ''}\n\n`;
        markdown += '```\n';
        markdown += log.raw;
        markdown += '\n```\n\n';
      }
    }
  }

  // Components section
  if (Object.keys(sections.components).length > 0) {
    markdown += '## 🔧 Components\n\n';
    const sortedComponents = Object.keys(sections.components).sort();

    for (const component of sortedComponents) {
      markdown += `### ${component}\n\n`;
      for (const log of sections.components[component].slice(0, 10)) { // Limit to 10 per component
        markdown += `**${log.checkpoint ? `[Checkpoint ${log.checkpoint}]` : 'Log'}** ${log.timestamp ? `(${log.timestamp})` : ''}\n\n`;
        markdown += '```\n';
        markdown += log.raw.substring(0, 500); // Truncate long logs
        if (log.raw.length > 500) markdown += '\n... (truncated)';
        markdown += '\n```\n\n';
      }
      if (sections.components[component].length > 10) {
        markdown += `*... ${sections.components[component].length - 10} more logs*\n\n`;
      }
    }
  }

  // Raw logs section
  markdown += '## 📋 All Logs\n\n';
  markdown += '<details>\n<summary>Click to expand all logs</summary>\n\n';
  markdown += '```\n';
  for (const log of logs) {
    markdown += log.raw + '\n';
  }
  markdown += '```\n\n';
  markdown += '</details>\n';

  return markdown;
}

// Format logs as simple text
function formatAsText(logs) {
  return logs.map(log => log.raw).join('\n');
}

// Main execution
async function main() {
  let input = '';

  if (logFile) {
    // Read from file
    if (!fs.existsSync(logFile)) {
      console.error(`Error: File not found: ${logFile}`);
      process.exit(1);
    }
    input = fs.readFileSync(logFile, 'utf-8');
  } else {
    // Read from stdin
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }
  }

  if (!input.trim()) {
    console.error('Error: No input provided');
    process.exit(1);
  }

  // Extract and filter logs
  const logs = extractLogs(input);
  const filtered = filterLogs(logs);

  if (filtered.length === 0) {
    console.error('No logs found matching filters');
    process.exit(1);
  }

  // Format output
  const output = outputFile && outputFile.endsWith('.md') 
    ? formatAsMarkdown(filtered)
    : formatAsText(filtered);

  // Write output
  if (outputFile) {
    fs.writeFileSync(outputFile, output, 'utf-8');
    console.log(`✅ Logs extracted to: ${outputFile}`);
    console.log(`   Found ${filtered.length} log entries`);
  } else {
    console.log(output);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = { extractLogs, filterLogs, formatAsMarkdown, formatAsText };


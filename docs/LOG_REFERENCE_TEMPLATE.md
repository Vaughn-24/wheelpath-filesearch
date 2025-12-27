# Log Reference Template

Use this template when referencing logs in prompts:

---

## Issue Description
[Brief description of the problem]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happened]

## Logs

### Backend Logs
[Attach or paste backend logs here, or reference file]

### Frontend Logs  
[Attach or paste frontend logs here, or reference file]

### Relevant Checkpoints
- **Checkpoint X**: [What happened at this checkpoint]
- **Checkpoint Y**: [What failed at this checkpoint]

### Error Summary
```
[Paste error messages here]
```

### Component Breakdown
- **[ComponentName]**: [Summary of what happened]
- **[ComponentName]**: [Summary of what happened]

---

## Quick Commands

To extract logs for this issue:

```bash
# Extract all logs
npm run logs:extract -- --file logs/api-*.log --output debug-logs.md

# Extract errors only
npm run logs:extract -- --file logs/api-*.log --errors --output errors.md

# Extract specific component
npm run logs:extract -- --file logs/api-*.log --component RagService --output rag-service-logs.md

# Extract specific checkpoint
npm run logs:extract -- --file logs/api-*.log --checkpoint 8 --output checkpoint-8.md

# Create summary
npm run logs:summary -- --file logs/api-*.log
```


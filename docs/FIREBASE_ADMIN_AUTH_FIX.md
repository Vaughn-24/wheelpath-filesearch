# Firebase Admin Authentication Fix

## Issue
Voice agent was failing with error:
```
"invalid_grant", "reauth related error (invalid_rapt)"
```

## Root Cause
Firebase Admin SDK couldn't authenticate with Google Cloud because Application Default Credentials (ADC) were expired or invalid.

## Solution Applied
Ran `gcloud auth application-default login` which:
- ✅ Saved credentials to `~/.config/gcloud/application_default_credentials.json`
- ✅ Set quota project to `wheelpath-filesearch`
- ✅ Refreshed authentication tokens

## Next Steps

1. **Restart Backend** - The backend needs to be restarted to pick up new credentials:
   ```bash
   # Stop current backend (Ctrl+C)
   npm run dev:api
   ```

2. **Verify Backend Logs** - Look for:
   ```
   ✅ Firebase Admin initialized with project: wheelpath-filesearch
   ```

3. **Test Voice Agent** - Try voice query again, should now work!

## If Issues Persist

### Check Credentials
```bash
# Verify credentials are set
gcloud auth application-default print-access-token
```

### Use Service Account (Alternative)
If ADC continues to have issues, use a service account key:

1. Download service account key from Google Cloud Console
2. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
   ```
3. Restart backend

## Prevention

Credentials expire after a period of time. To refresh:
```bash
gcloud auth application-default login
```

Or set up automatic refresh (if using service account, this isn't needed).


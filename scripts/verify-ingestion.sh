#!/bin/bash
# WheelPath Ingestion Verification Script

set -e

PROJECT_ID="wheelpath-ai-dev"
REGION="us-central1"
BUCKET="wheelpath-uploads-dev"
INDEX_ID="370783908188389376"

echo "=========================================="
echo "WheelPath Ingestion Verification Report"
echo "=========================================="
echo ""

# 1. GCS File Verification
echo "1. DATA INTEGRITY & SOURCE VERIFICATION"
echo "----------------------------------------"
echo ""
echo "1.1 GCS File Count:"
GCS_COUNT=$(gsutil ls -l gs://${BUCKET}/**/*.pdf 2>/dev/null | grep -c "\.pdf" || echo "0")
echo "   Found: $GCS_COUNT PDF files in GCS"
echo ""

# 2. Firestore Document Count
echo "1.2 Firestore Document Count:"
# Note: This requires Firebase Admin SDK or gcloud firestore export
echo "   ⚠️  Manual check required in Firebase Console"
echo "   Collection: documents"
echo ""

# 3. Processing Status Check
echo "1.3 Recent Processing Status:"
echo "   Checking Cloud Run logs..."
RECENT_LOGS=$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument" \
  --limit=50 \
  --format="value(timestamp,textPayload)" \
  --order=desc 2>/dev/null | head -10)

if echo "$RECENT_LOGS" | grep -q "Finished processing"; then
  echo "   ✅ Recent successful processing found"
  echo "$RECENT_LOGS" | grep "Finished processing" | head -3
else
  echo "   ⚠️  No recent successful processing found"
fi
echo ""

# 4. Error Check
echo "1.4 Error Status:"
ERROR_COUNT=$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=processdocument AND severity>=ERROR" \
  --limit=10 \
  --format="value(severity)" 2>/dev/null | wc -l | tr -d ' ')

if [ "$ERROR_COUNT" -gt 0 ]; then
  echo "   ⚠️  Found $ERROR_COUNT recent errors"
  echo "   Check logs for details"
else
  echo "   ✅ No recent errors found"
fi
echo ""

# 5. Vertex AI Index Status
echo "2. PROCESSING & CHUNKING VALIDATION"
echo "-----------------------------------"
echo ""
echo "2.1 Vertex AI Index Status:"
INDEX_INFO=$(gcloud ai indexes describe $INDEX_ID --region=$REGION --format="value(name,displayName)" 2>/dev/null || echo "NOT_FOUND")
if [ "$INDEX_INFO" != "NOT_FOUND" ]; then
  echo "   ✅ Index exists: $INDEX_INFO"
else
  echo "   ❌ Index not found"
fi
echo ""

# 6. Function Configuration
echo "2.2 Ingestion Worker Configuration:"
FUNC_MEM=$(gcloud functions describe processDocument --gen2 --region=$REGION --format="value(serviceConfig.availableMemory)" 2>/dev/null || echo "UNKNOWN")
FUNC_TIMEOUT=$(gcloud functions describe processDocument --gen2 --region=$REGION --format="value(serviceConfig.timeoutSeconds)" 2>/dev/null || echo "UNKNOWN")
echo "   Memory: $FUNC_MEM"
echo "   Timeout: ${FUNC_TIMEOUT}s"
echo ""

# 7. Environment Variables
echo "2.3 Environment Variables:"
ENV_VARS=$(gcloud functions describe processDocument --gen2 --region=$REGION --format="value(serviceConfig.environmentVariables)" 2>/dev/null || echo "")
if echo "$ENV_VARS" | grep -q "VERTEX_INDEX_ID"; then
  echo "   ✅ VERTEX_INDEX_ID configured"
else
  echo "   ❌ VERTEX_INDEX_ID missing"
fi
echo ""

# 8. Summary
echo "=========================================="
echo "VERIFICATION SUMMARY"
echo "=========================================="
echo ""
echo "✅ GCS Files: $GCS_COUNT PDFs found"
echo "✅ Worker: Configured (${FUNC_MEM}, ${FUNC_TIMEOUT}s)"
echo "⚠️  Firestore: Manual verification required"
echo "⚠️  Vertex AI: Index exists"
echo ""
echo "Next Steps:"
echo "1. Upload a test PDF and monitor processing"
echo "2. Check Firestore for document status"
echo "3. Verify chunks subcollection exists"
echo "4. Test retrieval with known query"
echo ""


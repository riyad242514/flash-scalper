#!/bin/bash
# Quick GCP setup script for artifact collection

set -e

echo "🚀 Setting up GCP for artifact collection..."

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
if [ -z "$PROJECT_ID" ]; then
  echo "❌ No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

echo "✅ Project ID: $PROJECT_ID"

# Check if bucket exists or create one
BUCKET_NAME="zaara-scalper-artifacts"
echo "📦 Checking bucket: gs://$BUCKET_NAME"

if gsutil ls -b gs://$BUCKET_NAME >/dev/null 2>&1; then
  echo "✅ Bucket already exists: gs://$BUCKET_NAME"
else
  echo "📦 Creating bucket: gs://$BUCKET_NAME"
  gsutil mb -p "$PROJECT_ID" -l us-central1 gs://$BUCKET_NAME
  echo "✅ Bucket created"
fi

# Make bucket publicly readable (for public URLs)
echo "🔓 Making bucket publicly readable..."
gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME 2>/dev/null || echo "⚠️  Bucket may already be public or permissions set"

# Set up default credentials
echo "🔐 Setting up default credentials..."
if gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "✅ Default credentials already active"
else
  echo "🔑 Running: gcloud auth application-default login"
  gcloud auth application-default login
fi

# Update .env file
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "📝 Creating .env file..."
  touch "$ENV_FILE"
fi

# Check if artifact config exists
if ! grep -q "ARTIFACT_COLLECTION_ENABLED" "$ENV_FILE" 2>/dev/null; then
  echo "📝 Adding artifact collection config to .env..."
  cat >> "$ENV_FILE" << EOF

# Artifact Collection
ARTIFACT_COLLECTION_ENABLED=true
ARTIFACT_BASE_DIR=./artifacts
ARTIFACT_VERSION=1.4
ARTIFACT_LOG_FILE=/tmp/scalper-live.log

# Time-based run rotation (creates new run every 2 hours)
ARTIFACT_RUN_ROTATION_ENABLED=true
ARTIFACT_RUN_ROTATION_INTERVAL_HOURS=2

# GCP Cloud Storage (using default credentials)
ARTIFACT_STORAGE_PROVIDER=gcp
GCP_STORAGE_BUCKET=$BUCKET_NAME
GCP_STORAGE_PROJECT_ID=$PROJECT_ID
# GCP_STORAGE_KEY_FILE=  # Leave empty - using default credentials
GCP_STORAGE_PUBLIC_URL_BASE=https://storage.googleapis.com/$BUCKET_NAME

# Stream Branding
STREAM_BRANDING_ENABLED=true
STREAM_BRANDING_TEXT=Powered by b402
STREAM_FOOTER_TEXT=Replay + logs in bio
EOF
  echo "✅ Added artifact config to .env"
else
  echo "✅ Artifact config already exists in .env"
  echo "📝 Updating GCP settings..."
  # Update bucket and project if they exist
  sed -i.bak "s|GCP_STORAGE_BUCKET=.*|GCP_STORAGE_BUCKET=$BUCKET_NAME|" "$ENV_FILE" 2>/dev/null || true
  sed -i.bak "s|GCP_STORAGE_PROJECT_ID=.*|GCP_STORAGE_PROJECT_ID=$PROJECT_ID|" "$ENV_FILE" 2>/dev/null || true
  sed -i.bak "s|GCP_STORAGE_PUBLIC_URL_BASE=.*|GCP_STORAGE_PUBLIC_URL_BASE=https://storage.googleapis.com/$BUCKET_NAME|" "$ENV_FILE" 2>/dev/null || true
  rm -f "$ENV_FILE.bak" 2>/dev/null || true
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Configuration:"
echo "   Project ID: $PROJECT_ID"
echo "   Bucket: gs://$BUCKET_NAME"
echo "   Public URL: https://storage.googleapis.com/$BUCKET_NAME"
echo ""
echo "🚀 Next steps:"
echo "   1. Review .env file (artifact config added)"
echo "   2. Run: npm run build"
echo "   3. Run: npm run start:scalper"
echo ""
echo "📊 How runs work:"
echo "   - Default: One run = one execution session (start to stop)"
echo "   - With rotation: New run every 2 hours (configurable)"
echo "   - Artifacts auto-uploaded to GCP on run end/rotation"
echo ""


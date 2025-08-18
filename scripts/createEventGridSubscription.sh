#!/bin/bash

# Azure Event Grid Subscription Creation Script
# This script creates an Event Grid subscription with webhook endpoint

set -e

# Configuration variables - Update these as needed
RESOURCE_GROUP="your-resource-group"
LOCATION="eastus"
TOPIC_NAME="your-event-grid-topic"
SUBSCRIPTION_NAME="moen-api-events"
WEBHOOK_ENDPOINT="https://your-api-domain.com/api/v1/eventgrid/webhook"
DEAD_LETTER_ENDPOINT="https://your-storage-account.blob.core.windows.net/dead-letter-container"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Creating Azure Event Grid Subscription...${NC}"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}Azure CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if user is logged in to Azure
if ! az account show &> /dev/null; then
    echo -e "${YELLOW}Please log in to Azure first:${NC}"
    az login
fi

# Create Event Grid subscription
echo -e "${YELLOW}Creating Event Grid subscription: $SUBSCRIPTION_NAME${NC}"

az eventgrid event-subscription create \
    --name "$SUBSCRIPTION_NAME" \
    --source-resource-id "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.EventGrid/topics/$TOPIC_NAME" \
    --endpoint-type webhook \
    --endpoint "$WEBHOOK_ENDPOINT" \
    --event-delivery-schema EventGridSchema \
    --max-delivery-attempts 3 \
    --dead-letter-endpoint "$DEAD_LETTER_ENDPOINT" \
    --expiration-date "$(date -d '+1 year' -u +%Y-%m-%dT%H:%M:%SZ)" \
    --labels "environment=production" "service=moen-api" \
    --included-event-types "Microsoft.Storage.BlobCreated" "Microsoft.Storage.BlobDeleted" "Microsoft.KeyVault.SecretNewVersionCreated" "Microsoft.Resources.ResourceWriteSuccess" "Microsoft.Resources.ResourceDeleteSuccess" \
    --advanced-filter "data.api" stringin "PutBlob" "DeleteBlob" "SetSecret" "CreateOrUpdate" "Delete" \
    --output table

echo -e "${GREEN}Event Grid subscription created successfully!${NC}"

# Display subscription details
echo -e "${YELLOW}Subscription Details:${NC}"
az eventgrid event-subscription show \
    --name "$SUBSCRIPTION_NAME" \
    --source-resource-id "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.EventGrid/topics/$TOPIC_NAME" \
    --query "{name:name, provisioningState:provisioningState, endpoint:destination.endpointUrl, maxDeliveryAttempts:retryPolicy.maxDeliveryAttempts, deadLetterEndpoint:deadLetterDestination.blobStorageAccount}" \
    --output table

echo -e "${GREEN}Setup complete! Your API endpoint is now ready to receive Event Grid events.${NC}"
echo -e "${YELLOW}Test the endpoint:${NC}"
echo "curl -X GET https://your-api-domain.com/api/v1/eventgrid/health"
echo "curl -X GET https://your-api-domain.com/api/v1/eventgrid/status"

# Azure Event Grid Subscription Creation Script (PowerShell)
# This script creates an Event Grid subscription with webhook endpoint

param(
    [string]$ResourceGroup = "your-resource-group",
    [string]$Location = "eastus",
    [string]$TopicName = "your-event-grid-topic",
    [string]$SubscriptionName = "moen-api-events",
    [string]$WebhookEndpoint = "https://your-api-domain.com/api/v1/eventgrid/webhook",
    [string]$DeadLetterEndpoint = "https://your-storage-account.blob.core.windows.net/dead-letter-container"
)

# Set error action preference
$ErrorActionPreference = "Stop"

Write-Host "Creating Azure Event Grid Subscription..." -ForegroundColor Green

# Check if Azure CLI is installed
try {
    $azVersion = az version --output json | ConvertFrom-Json
    Write-Host "Azure CLI version: $($azVersion.'azure-cli')" -ForegroundColor Yellow
} catch {
    Write-Host "Azure CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Check if user is logged in to Azure
try {
    $account = az account show --output json | ConvertFrom-Json
    Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Yellow
} catch {
    Write-Host "Please log in to Azure first:" -ForegroundColor Yellow
    az login
}

# Get subscription ID
$subscriptionId = (az account show --query id -o tsv)

# Create Event Grid subscription
Write-Host "Creating Event Grid subscription: $SubscriptionName" -ForegroundColor Yellow

$createCommand = @"
az eventgrid event-subscription create `
    --name "$SubscriptionName" `
    --source-resource-id "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.EventGrid/topics/$TopicName" `
    --endpoint-type webhook `
    --endpoint "$WebhookEndpoint" `
    --event-delivery-schema EventGridSchema `
    --max-delivery-attempts 3 `
    --dead-letter-endpoint "$DeadLetterEndpoint" `
    --expiration-date "$((Get-Date).AddYears(1).ToString('yyyy-MM-ddTHH:mm:ssZ'))" `
    --labels "environment=production" "service=moen-api" `
    --included-event-types "Microsoft.Storage.BlobCreated" "Microsoft.Storage.BlobDeleted" "Microsoft.KeyVault.SecretNewVersionCreated" "Microsoft.Resources.ResourceWriteSuccess" "Microsoft.Resources.ResourceDeleteSuccess" `
    --advanced-filter "data.api" stringin "PutBlob" "DeleteBlob" "SetSecret" "CreateOrUpdate" "Delete" `
    --output table
"@

Invoke-Expression $createCommand

Write-Host "Event Grid subscription created successfully!" -ForegroundColor Green

# Display subscription details
Write-Host "Subscription Details:" -ForegroundColor Yellow
$showCommand = @"
az eventgrid event-subscription show `
    --name "$SubscriptionName" `
    --source-resource-id "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.EventGrid/topics/$TopicName" `
    --query "{name:name, provisioningState:provisioningState, endpoint:destination.endpointUrl, maxDeliveryAttempts:retryPolicy.maxDeliveryAttempts, deadLetterEndpoint:deadLetterDestination.blobStorageAccount}" `
    --output table
"@

Invoke-Expression $showCommand

Write-Host "Setup complete! Your API endpoint is now ready to receive Event Grid events." -ForegroundColor Green
Write-Host "Test the endpoint:" -ForegroundColor Yellow
Write-Host "curl -X GET $WebhookEndpoint/health" -ForegroundColor Cyan
Write-Host "curl -X GET $WebhookEndpoint/status" -ForegroundColor Cyan

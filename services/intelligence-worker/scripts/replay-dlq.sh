#!/usr/bin/env bash
set -euo pipefail

# Replay messages from {topic}-dlq subscription to original topic.
# This script uses Pub/Sub native retry + DLQ workflow and supports manual replay.
#
# Requirements:
# - gcloud CLI authenticated against target project
# - permissions:
#   - pubsub.subscriptions.pull / ack on DLQ subscription
#   - pubsub.topics.publish on original topic
#
# Usage:
#   ./services/intelligence-worker/scripts/replay-dlq.sh \
#     --project my-project \
#     --topic conversation-turns \
#     --env dev \
#     --max-messages 50

PROJECT_ID=""
TOPIC_NAME=""
ENV_NAME=""
MAX_MESSAGES=10

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --topic)
      TOPIC_NAME="$2"
      shift 2
      ;;
    --env)
      ENV_NAME="$2"
      shift 2
      ;;
    --max-messages)
      MAX_MESSAGES="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$TOPIC_NAME" || -z "$ENV_NAME" ]]; then
  echo "Missing required args. --project, --topic, --env are required." >&2
  exit 1
fi

ORIGINAL_TOPIC="bd-${ENV_NAME}-${TOPIC_NAME}"
DLQ_SUBSCRIPTION="${ORIGINAL_TOPIC}-dlq-sub"

echo "Project: $PROJECT_ID"
echo "Original topic: $ORIGINAL_TOPIC"
echo "DLQ subscription: $DLQ_SUBSCRIPTION"
echo "Max messages: $MAX_MESSAGES"

for ((i = 1; i <= MAX_MESSAGES; i++)); do
  PULL_JSON="$(gcloud pubsub subscriptions pull "$DLQ_SUBSCRIPTION" \
    --project "$PROJECT_ID" \
    --limit=1 \
    --format=json)"

  if [[ "$PULL_JSON" == "[]" ]]; then
    echo "No more DLQ messages to replay."
    break
  fi

  ACK_ID="$(echo "$PULL_JSON" | jq -r '.[0].ackId')"
  DATA_B64="$(echo "$PULL_JSON" | jq -r '.[0].message.data')"
  ATTRS_JSON="$(echo "$PULL_JSON" | jq -c '.[0].message.attributes // {}')"

  # Re-publish to original topic with the same data/attributes.
  gcloud pubsub topics publish "$ORIGINAL_TOPIC" \
    --project "$PROJECT_ID" \
    --message="$(echo "$DATA_B64" | base64 --decode)" \
    --attribute="$(
      echo "$ATTRS_JSON" | jq -r 'to_entries | map("\(.key)=\(.value)") | join(",")'
    )" >/dev/null

  # Ack from DLQ only after successful re-publish.
  gcloud pubsub subscriptions ack "$DLQ_SUBSCRIPTION" \
    --project "$PROJECT_ID" \
    --ack-ids="$ACK_ID" >/dev/null

  echo "Replayed message #$i"
done

echo "Replay finished."

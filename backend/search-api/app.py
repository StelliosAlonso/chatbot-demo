# backend/search-api/app.py
import os
import json
import logging
import boto3
import requests
from requests_aws4auth import AWS4Auth

logger = logging.getLogger()
logger.setLevel(logging.INFO)

OPENSEARCH_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT")
OPENSEARCH_INDEX = os.environ.get("OPENSEARCH_INDEX", "chats")
REGION = os.environ.get("AWS_REGION", "us-east-1")

def get_awsauth():
    session = boto3.Session()
    credentials = session.get_credentials().get_frozen_credentials()
    return AWS4Auth(credentials.access_key, credentials.secret_key, REGION, "aoss", session_token=credentials.token)

def lambda_handler(event, context):
    sts = boto3.client("sts")
    identity = sts.get_caller_identity()
    logger.info(f"Caller identity: {identity}")
    
    try:
        params = event.get("queryStringParameters") or {}
        q = params.get("q", "")
        size = int(params.get("size", 20))

        if not q:
            return {
                "statusCode": 400,
                "headers": cors_headers(),
                "body": json.dumps({"error": "query param 'q' requerido"})
            }

        # DSL multi_match simple: busca en chatName y lastMessageSnippet
        query_body = {
            "query": {
                "multi_match": {
                    "query": q,
                    "fields": ["chatName^3", "lastMessageSnippet"],
                    "type": "best_fields"
                }
            },
            "size": size,
            "sort": [{"lastMessageAt": {"order": "desc"}}]
        }

        url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search"
        auth = get_awsauth()
        resp = requests.post(url, auth=auth, json=query_body, timeout=10)
        resp.raise_for_status()
        hits = resp.json().get("hits", {}).get("hits", [])

        results = []
        for h in hits:
            src = h.get("_source", {})
            results.append({
                "chatId": src.get("chatId"),
                "chatName": src.get("chatName"),
                "snippet": src.get("lastMessageSnippet"),
                "lastMessageAt": src.get("lastMessageAt"),
                "score": h.get("_score")
            })

        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps({"results": results})
        }

    except Exception as e:
        logger.exception("Search error")
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": str(e)})
        }

def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,GET",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }

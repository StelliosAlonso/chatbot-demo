# backend/get_messages/app.py
import os
import json
import traceback
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table_name = os.environ.get("CHAT_TABLE")
table = dynamodb.Table(table_name) if table_name else None

def build_response(status_code=200, body=None):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",  # ajustar a tu dominio si lo deseas
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
        },
        "body": json.dumps(body or {})
    }

def lambda_handler(event, context):
    try:
        # Preflight CORS
        if event.get("httpMethod", "") == "OPTIONS":
            return build_response(200, {"ok": True})

        print("get_messages event:", json.dumps(event))

        if not table:
            return build_response(500, {"error": "CHAT_TABLE not configured in environment"})

        # Obtener chatId de pathParameters
        path_params = event.get("pathParameters") or {}
        chat_id = path_params.get("chatId")
        if not chat_id:
            return build_response(400, {"error": "Missing path parameter: chatId"})

        # Query DynamoDB por PK = CHAT#<chatId> y mensajes SK comienza con MSG#
        resp = table.query(
            KeyConditionExpression=Key("PK").eq(f"CHAT#{chat_id}") & Key("SK").begins_with("MSG#")
        )

        items = resp.get("Items", [])

        # Ordenar por SK (SK asume formato MSG#<timestamp>#<id> => orden lexicográfico == cronológico si timestamp es ISO)
        items_sorted = sorted(items, key=lambda it: it.get("SK", ""))

        # Normalizar la forma que el frontend espera: devolver array de items
        # Cada item normalmente tiene: message, sender, createdAt, SK...
        # Devolvemos los items tal cual para que el frontend los procese.
        return build_response(200, items_sorted)

    except Exception as e:
        print("Error in get_messages:", str(e))
        traceback.print_exc()
        return build_response(500, {"error": "Internal server error", "detail": str(e)})

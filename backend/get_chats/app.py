# backend/get_chats/app.py
import os
import json
import boto3
import traceback
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table_name = os.environ.get("CHAT_TABLE")
table = dynamodb.Table(table_name) if table_name else None

def build_response(status_code=200, body=None):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",                          # CORS
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE"
        },
        "body": json.dumps(body or {})
    }

def lambda_handler(event, context):
    # Manejar preflight CORS
    try:
        if event.get("httpMethod", "") == "OPTIONS":
            return build_response(200, {"ok": True})

        # Debug: imprimir evento
        print("get_chats event:", json.dumps(event))

        # Extraer email del query param (fallback a body si fuera necesario)
        qs = event.get("queryStringParameters") or {}
        email = qs.get("email") if qs else None

        # Si no hay email, devolver 400 (o podrías listar todos si lo deseas)
        if not email:
            return build_response(400, {"error": "Missing required query parameter: email"})

        # Query DynamoDB: buscar PK = USER#<email> and SK begins_with CHAT#
        if not table:
            return build_response(500, {"error": "CHAT_TABLE not configured in environment"})

        resp = table.query(
            KeyConditionExpression=Key("PK").eq(f"USER#{email}") & Key("SK").begins_with("CHAT#")
        )

        items = resp.get("Items", [])
        # Mapear a formato simple esperado por frontend
        chats = []
        for it in items:
            # tu esquema: PK = USER#email, SK = CHAT#<chatId> (según template)
            sk = it.get("SK", "")
            chat_id = sk.replace("CHAT#", "") if sk.startswith("CHAT#") else it.get("chatId") or sk
            chats.append({
                "chatId": chat_id,
                "chatName": it.get("chatName") or it.get("title") or "Chat",
                "createdAt": it.get("createdAt")
            })

        # ordenar por createdAt descendente (opcional)
        chats_sorted = sorted(chats, key=lambda x: x.get("createdAt") or "", reverse=True)

        return build_response(200, chats_sorted)

    except Exception as e:
        print("Error in get_chats:", str(e))
        traceback.print_exc()
        # devolver 500 con CORS
        return build_response(500, {"error": "Internal server error", "detail": str(e)})

import os
import json
import boto3
from datetime import datetime
import uuid

# Inicializa DynamoDB
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def lambda_handler(event, context):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }

    # Responder a preflight CORS
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers}

    try:
        # Debug: imprimir todo el evento y el body
        print("📦 EVENTO COMPLETO:", json.dumps(event))
        body_str = event.get("body", "{}")
        print("📦 BODY RAW:", body_str)

        body = json.loads(body_str)
        print("📦 BODY PARSEADO:", body)

        # Tomar chatId de pathParameters
        chat_id = event.get("pathParameters", {}).get("chatId")
        msg_text = body.get("message")
        user_id = body.get("sender", "anonymous")  # nombre del remitente

        # Validar campos obligatorios
        if not chat_id or not msg_text:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps({"error": "chatId y message son requeridos"})
            }

        # Generar ID único y timestamp
        msg_id = uuid.uuid4().hex[:8]
        timestamp = datetime.utcnow().isoformat()

        # Guardar mensaje en DynamoDB
        table.put_item(Item={
            "PK": f"USER#{user_id}",
            "SK": f"CHAT#{chat_id}#MSG#{timestamp}#{msg_id}",
            "type": "MESSAGE",
            "message": msg_text,
            "sender": user_id,
            "createdAt": timestamp
        })

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({"success": True, "message": "Mensaje almacenado correctamente"})
        }

    except Exception as e:
        print(f"❌ Error guardando mensaje: {e}")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": str(e)})
        }

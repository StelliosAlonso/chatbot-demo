import os
import json
import boto3
from datetime import datetime
import uuid

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def lambda_handler(event, context):
    # Encabezados CORS para todas las respuestas
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",  # Permite solicitudes desde cualquier origen (puedes restringirlo)
        "Access-Control-Allow-Methods": "OPTIONS,POST",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }

import os
import json
import boto3
from datetime import datetime
import uuid

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def lambda_handler(event, context):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }

    try:
        if event.get("httpMethod") == "OPTIONS":
            return {"statusCode": 200, "headers": headers}

        body = json.loads(event.get("body", "{}"))
        chat_id = str(uuid.uuid4())
        chat_name = body.get("chatName", "Nuevo chat")
        user_id = body.get("email", "anonymous")  # <-- Usar email del body

        item = {
            "PK": f"USER#{user_id}",
            "SK": f"CHAT#{chat_id}",
            "chatName": chat_name,
            "createdAt": datetime.utcnow().isoformat()
        }

        table.put_item(Item=item)

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({"chatId": chat_id, "chatName": chat_name})
        }

    except Exception as e:
        print(f"Error creando chat: {e}")
        return {"statusCode": 500, "headers": headers, "body": json.dumps({"error": str(e)})}

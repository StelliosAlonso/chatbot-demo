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

    try:
        # ✅ Manejo del preflight request (OPTIONS)
        if event.get("httpMethod") == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": headers
            }

        # ✅ Parsear cuerpo del request
        body = json.loads(event.get("body", "{}"))

        # ID único para el chat
        chat_id = str(uuid.uuid4())
        chat_name = body.get("chatName", "Nuevo chat")

        # ✅ Obtener el userId de Cognito
        user_id = event['requestContext']['identity'].get('cognitoIdentityId', 'anonymous')

        # ✅ Crear el item para DynamoDB
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
            "body": json.dumps({
                "chatId": chat_id,
                "chatName": chat_name
            })
        }

    except Exception as e:
        print(f"Error creando chat: {e}")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": str(e)})
        }
# backend/update-chat/app.py
import os
import json
import boto3
from datetime import datetime

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def lambda_handler(event, context):
    headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers}

    try:
        chat_id = event.get("pathParameters", {}).get("chatId")
        body = json.loads(event.get("body") or "{}")
        new_name = body.get("chatName")
        email = body.get("email")  # idealmente provisto por frontend

        if not chat_id or not new_name:
            return {"statusCode": 400, "headers": headers, "body": json.dumps({"error":"chatId y chatName requeridos"})}

        if not email:
            # Si no recibes email, intenta encontrar el item por GSI o por PK alterna.
            # Aquí devolvemos 400 para que el cliente mande email.
            return {"statusCode": 400, "headers": headers, "body": json.dumps({"error":"email requerido para actualizar chat"})}

        pk = f"USER#{email}"
        sk = f"CHAT#{chat_id}"

        resp = table.update_item(
            Key={"PK": pk, "SK": sk},
            UpdateExpression="SET chatName = :n, updatedAt = :u",
            ExpressionAttributeValues={
                ":n": new_name,
                ":u": datetime.utcnow().isoformat()
            },
            ReturnValues="ALL_NEW"
        )

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({"success": True, "item": resp.get("Attributes")})
        }

    except Exception as e:
        print("Error updating chat:", e)
        return {"statusCode": 500, "headers": headers, "body": json.dumps({"error": str(e)})}

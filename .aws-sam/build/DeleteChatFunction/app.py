import os
import json
import boto3
from boto3.dynamodb.conditions import Key, Attr

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def _response(status, body):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }
    return {"statusCode": status, "headers": headers, "body": json.dumps(body)}

def lambda_handler(event, context):
    print("📦 EVENT (delete-chat):", json.dumps(event))

    # CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return _response(200, {"ok": True})

    try:
        chat_id = event.get("pathParameters", {}).get("chatId")
        if not chat_id:
            return _response(400, {"error": "chatId requerido en path parameters"})

        pk_chat = f"CHAT#{chat_id}"

        # (Opcional) validación de owner si usas authorizer - ya tenías algo similar
        authorizer = event.get("requestContext", {}).get("authorizer", {}) or {}
        claims = authorizer.get("claims") or {}
        caller_sub = claims.get("sub") or None
        caller_email = claims.get("email") or claims.get("username") or None
        print(f"🔐 Authorizer claims sub={caller_sub} email={caller_email}")

        # 1) Query por PK = CHAT#<chatId> (mensajes y metadata si existe así)
        items_to_delete = []
        last_evaluated_key = None
        query_kwargs = {
            "KeyConditionExpression": Key("PK").eq(pk_chat),
            "ProjectionExpression": "PK, SK"
        }
        while True:
            if last_evaluated_key:
                query_kwargs["ExclusiveStartKey"] = last_evaluated_key
            resp = table.query(**query_kwargs)
            page_items = resp.get("Items", [])
            items_to_delete.extend(page_items)
            last_evaluated_key = resp.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break

        print(f"🧾 Items encontrados por PK={pk_chat}: {len(items_to_delete)}")

        # 2) Además: scan para encontrar items donde SK == CHAT#<chatId> (ej. index listados por usuario)
        # Nota: scan es costoso en tablas grandes — ok para demo/small scale. Mejor usar GSI en producción.
        scan_filter = Attr("SK").eq(f"CHAT#{chat_id}")
        last_evaluated_key = None
        while True:
            scan_kwargs = {
                "FilterExpression": scan_filter,
                "ProjectionExpression": "PK, SK"
            }
            if last_evaluated_key:
                scan_kwargs["ExclusiveStartKey"] = last_evaluated_key
            resp = table.scan(**scan_kwargs)
            page_items = resp.get("Items", [])
            # Añadir sólo keys no duplicadas
            for it in page_items:
                # evitar añadir items ya capturados por la query PK
                if not any(existing["PK"] == it["PK"] and existing["SK"] == it["SK"] for existing in items_to_delete):
                    items_to_delete.append(it)
            last_evaluated_key = resp.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break

        print(f"🔎 Items totales a borrar tras scan SK=CHAT#{chat_id}: {len(items_to_delete)}")

        if not items_to_delete:
            return _response(200, {"success": True, "message": "No se encontraron items a borrar", "deleted": 0})

        # 3) Borrado en batch (batch_writer hará chunking automáticamente)
        deleted_count = 0
        with table.batch_writer() as batch:
            for it in items_to_delete:
                key = {"PK": it["PK"], "SK": it["SK"]}
                print("🗑 Deleting", key)
                batch.delete_item(Key=key)
                deleted_count += 1

        return _response(200, {"success": True, "message": "Chat y items relacionados eliminados", "deleted": deleted_count})

    except Exception as e:
        print("❌ Error en delete-chat:", str(e), flush=True)
        return _response(500, {"error": str(e)})

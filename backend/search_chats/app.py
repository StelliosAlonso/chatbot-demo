# backend/search_chats/app.py
import os
import json
import boto3
import traceback

from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

def get_region():
    # priorizar variable no reservada si la hubieras puesto, luego AWS_REGION del entorno,
    # luego la región del session de boto3, y por último fallback 'us-east-1'
    return os.environ.get("REGION") or os.environ.get("AWS_REGION") or boto3.session.Session().region_name or "us-east-1"

def normalize_host(raw):
    if not raw:
        return ""
    host = raw.replace("https://", "").replace("http://", "").split("/")[0].rstrip("/")
    # si incluye puerto explícito como :443, quitar el sufijo
    if host.endswith(":443"):
        host = host[:-4]
    return host

REGION = get_region()
RAW_HOST = os.environ.get("OPENSEARCH_ENDPOINT", "")
HOST = normalize_host(RAW_HOST)
INDEX = os.environ.get("OPENSEARCH_INDEX", "chats")

def get_opensearch_client():
    if not HOST:
        raise RuntimeError(f"OPENSEARCH_ENDPOINT no configurado (raw='{RAW_HOST}')")

    session = boto3.session.Session()
    credentials = session.get_credentials()
    if not credentials:
        raise RuntimeError("No se pudieron obtener credenciales de boto3 (session.get_credentials() devolvió None)")

    frozen = credentials.get_frozen_credentials()
    # Para OpenSearch Serverless, el service para firmar es "aoss"
    awsauth = AWS4Auth(frozen.access_key, frozen.secret_key, REGION, "aoss", session_token=frozen.token)

    client = OpenSearch(
        hosts=[{"host": HOST, "port": 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30
    )
    return client

def lambda_handler(event, context):
    sts = boto3.client("sts")
    try:
        identity = sts.get_caller_identity()
        print("STS caller identity:", identity)
    except Exception as e:
        print("Error obtaining caller identity:", e)

    try:
        print("SearchApiFunction invoked. REGION:", REGION, "HOST:", HOST, "INDEX:", INDEX)
        print("EVENT:", json.dumps({k:v for k,v in event.items() if k != 'body'} , default=str))

        params = event.get("queryStringParameters") or {}
        q = (params.get("q") or "").strip()
        user = params.get("user")  # -> preferir extraer del token (ver notas más abajo)
        size = int(params.get("size") or 50)

        client = get_opensearch_client()

        # Construir query
        must_clause = []
        if q:
            must_clause.append({
                "multi_match": {
                    "query": q,
                    "fields": ["chatName^3", "message", "message_text", "chatName.keyword"],
                    "fuzziness": "AUTO"
                }
            })
        else:
            must_clause.append({"match_all": {}})

        filter_clause = []
        if user:
            # OSIS puede indexar 'PK' o 'owner' — ajusta si tu pipeline indexa otro campo
            # Imprimimos el valor usado para debugging
            print("Filtering by user:", user)
            filter_clause.append({"term": {"PK.keyword": f"USER#{user}"}})

        body = {
            "size": size,
            "query": {
                "bool": {
                    "must": must_clause,
                    "filter": filter_clause
                }
            },
            "sort": [
                {"createdAt": {"order": "desc", "unmapped_type": "date"}}
            ]
        }

        print("OpenSearch query body:", json.dumps(body)[:4096])

        res = client.search(index=INDEX, body=body)
        hits = res.get("hits", {}).get("hits", [])

        print(f"OpenSearch returned {len(hits)} hits")

        items = []
        for h in hits:
            src = h.get("_source", {}) or {}
            chat_id = None
            # normalizar distintos posibles campos
            if src.get("chatId"):
                chat_id = src.get("chatId")
            elif src.get("SK"):
                chat_id = str(src.get("SK")).replace("CHAT#", "").split("#")[0]
            # fallback: usar _id si no existe otro campo
            if not chat_id:
                chat_id = h.get("_id")

            items.append({
                "chatId": chat_id,
                "chatName": src.get("chatName") or src.get("title") or "",
                "createdAt": src.get("createdAt") or src.get("created_at") or src.get("createdAtIso"),
                "_score": h.get("_score")
            })

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps(items)
        }

    except Exception as e:
        tb = traceback.format_exc()
        print("Search error:", e, tb)
        return {
            "statusCode": 500,
            "headers": {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
            "body": json.dumps({"error": str(e), "trace": tb[:2000]})
        }

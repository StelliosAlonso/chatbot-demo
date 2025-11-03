from boto3.dynamodb.conditions import Key
import boto3
import os

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def get_chat_messages(user_email, chat_id):
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_email}")
                               & Key("SK").begins_with(f"CHAT#{chat_id}#MSG#")
    )
    return response["Items"]

# Ejemplo
print(get_chat_messages(
    "arcemontoyajoseantonio00@gmail.com",
    "cd2ced44-5c52-4361-a191-4896ebdf130d"
))

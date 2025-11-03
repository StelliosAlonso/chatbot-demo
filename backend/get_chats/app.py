import boto3
import os

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["CHAT_TABLE"])

def get_user_chats(user_email):
    response = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("PK").eq(f"USER#{user_email}")
                               & boto3.dynamodb.conditions.Key("SK").begins_with("CHAT#")
    )
    return response["Items"]
import asyncio
import json

import aiohttp


URL = "http://localhost:8123/api/websocket"
TOKEN = "PASTE_LONG_LIVED_ACCESS_TOKEN_HERE"


async def main():

    async with aiohttp.ClientSession() as session:

        async with session.ws_connect(URL) as ws:

            print(await ws.receive_json())

            await ws.send_json(
                {
                    "type": "auth",
                    "access_token": TOKEN,
                }
            )

            print(await ws.receive_json())

            await ws.send_json(
                {
                    "id": 1,
                    "type": "todo_overlay/get_list",
                    "entity_id": "todo.development",
                }
            )

            print(json.dumps(await ws.receive_json(), indent=2))


asyncio.run(main())

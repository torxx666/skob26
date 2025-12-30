import asyncio
import websockets
import json
import sys

async def test_connection():
    uri = "ws://localhost:8000/ws/TEST_ID/TEST_PLAYER"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected!")
            
            # Wait for INIT
            response = await websocket.recv()
            print(f"Received: {response[:100]}...")
            
            # Send GET_STATE
            print("Sending GET_STATE...")
            await websocket.send(json.dumps({"type": "GET_STATE"}))
            
            # Wait for response
            response = await websocket.recv()
            print(f"Received UPDATE: {response[:100]}...")
            
            print("SUCCESS: WebSocket is functional.")
            
    except Exception as e:
        print(f"\nFAILURE: {e}")
        # Print exception type explicitly
        print(f"Error Type: {type(e)}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_connection())

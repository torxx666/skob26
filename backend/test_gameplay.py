import asyncio
import websockets
import json
import sys

async def test_gameplay():
    uri = "ws://localhost:8000/ws/TEST_GAME_PLAY/TEST_PLAYER"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected!")
            
            # Wait for INIT
            init_msg = await websocket.recv()
            state = json.loads(init_msg)['state']
            print("Game Valid initialized.")
            
            # Find a card to play
            # We need to find a card in hand and a valid move potentially, or just drop it.
            # For debugging "Crash", even an invalid move shouldn't crash.
            # Let's try to play the first card in hand.
            
            my_player = next(p for p in state['players'] if p['name'] == 'TEST_PLAYER')
            if not my_player['hand']:
                print("Error: Hand is empty!")
                return
            
            card_to_play = my_player['hand'][0]
            print(f"Attempting to play card: {card_to_play['id']}")
            
            payload = {
                "type": "PLAY_CARD",
                "player_index": state['players'].index(my_player),
                "card_id": card_to_play['id'],
                "combo_index": 0 # Default drop
            }
            
            await websocket.send(json.dumps(payload))
            print("PLAY_CARD sent.")
            
            # Expect UPDATE
            response = await websocket.recv()
            data = json.loads(response)
            if data['type'] == 'UPDATE':
                print("SUCCESS: Received UPDATE after play.")
            else:
                print(f"Received unexpected: {data['type']}")
                
    except websockets.exceptions.ConnectionClosed as e:
        print(f"CRITICAL FAILURE: Connection Closed {e.code} {e.reason}")
        sys.exit(1)
    except Exception as e:
        print(f"FAILURE: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_gameplay())

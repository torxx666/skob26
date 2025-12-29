import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from game_logic import ChkoubaEngine, GameState
from typing import Dict, List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for game sessions
games: Dict[str, ChkoubaEngine] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, game_id: str, websocket: WebSocket):
        await websocket.accept()
        if game_id not in self.active_connections:
            self.active_connections[game_id] = []
        self.active_connections[game_id].append(websocket)

    def disconnect(self, game_id: str, websocket: WebSocket):
        self.active_connections[game_id].remove(websocket)

    async def broadcast(self, game_id: str, message: dict):
        if game_id in self.active_connections:
            for connection in self.active_connections[game_id]:
                await connection.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/{game_id}/{player_name}")
async def websocket_endpoint(websocket: WebSocket, game_id: str, player_name: str):
    await manager.connect(game_id, websocket)
    
    # Initialize or join game
    player_name = player_name.strip()
    if game_id not in games or games[game_id].state.game_over:
        print(f"DEBUG: Starting new game for session {game_id}")
        games[game_id] = ChkoubaEngine([player_name], ai_count=1)
    else:
        # If human player joins existing game, add them if not already there
        if not any(p.name == player_name for p in games[game_id].state.players):
             print(f"DEBUG: Player {player_name} joined existing game {game_id}")
             # In full multi, we'd add the player here. For now, we stick to AI vs 1 Human.
             # If the name is different, we could either reject or update the name.
             # Let's just update the first human player's name for this simple AI mode.
             for p in games[game_id].state.players:
                 if not p.is_ai:
                     p.name = player_name
                     break
    
    try:
        # Send initial state
        await websocket.send_json({
            "type": "INIT",
            "state": games[game_id].state.dict()
        })
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message.get("type") == "GET_STATE":
                    await websocket.send_json({
                        "type": "UPDATE",
                        "state": games[game_id].state.dict()
                    })
                
                elif message.get("type") == "PLAY_CARD":
                    player_idx = message.get("player_index")
                    card_id = message.get("card_id")
                    combo_idx = message.get("combo_index")
                    
                    if card_id is None or player_idx is None:
                        continue

                    success = games[game_id].play_card(player_idx, card_id, combo_idx)
                    
                    if success:
                        # Broadcast updated state
                        await manager.broadcast(game_id, {
                            "type": "UPDATE",
                            "state": games[game_id].state.dict()
                        })
                        
                        # If it's AI's turn, handle it
                        while not games[game_id].state.round_finished and games[game_id].state.players[games[game_id].state.current_player_index].is_ai:
                            await asyncio.sleep(1) # Delay for realism
                            ai_card_id, ai_combo = games[game_id].get_ai_move()
                            games[game_id].play_card(games[game_id].state.current_player_index, ai_card_id, ai_combo)
                            await manager.broadcast(game_id, {
                                "type": "UPDATE",
                                "state": games[game_id].state.dict()
                            })

                elif message.get("type") == "RESET":
                    print(f"DEBUG: Resetting game {game_id}")
                    # Keep same players but reset state
                    old_players = [p.name for p in games[game_id].state.players if not p.is_ai]
                    games[game_id] = ChkoubaEngine(old_players, ai_count=1)
                    await manager.broadcast(game_id, {
                        "type": "INIT",
                        "state": games[game_id].state.dict()
                    })
            except WebSocketDisconnect:
                # Re-raise to be caught by the outer handler
                raise
            except Exception as e:
                print(f"Error processing message: {e}")
                continue

    except WebSocketDisconnect:
        manager.disconnect(game_id, websocket)

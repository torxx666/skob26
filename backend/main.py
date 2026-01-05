import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from game_logic import ChkoubaEngine, GameState
from typing import Dict, List
from fastapi.encoders import jsonable_encoder

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
        if game_id in self.active_connections:
            if websocket in self.active_connections[game_id]:
                self.active_connections[game_id].remove(websocket)

    async def broadcast(self, game_id: str, message: dict):
        if game_id in self.active_connections:
            for connection in self.active_connections[game_id]:
                await connection.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/{game_id}/{player_name}")
async def websocket_endpoint(websocket: WebSocket, game_id: str, player_name: str, count: int = 2):
    print(f"DEBUG: New connection request: {game_id}, {player_name}", flush=True)
    try:
        await manager.connect(game_id, websocket)
        print(f"DEBUG: Connection accepted for {game_id}", flush=True)
    except Exception as e:
        print(f"ERROR: Failed to accept connection: {e}", flush=True)
        return

    # Initialize or join game
    player_name = player_name.strip()
    try:
        if game_id not in games or games[game_id].state.game_over:
            # count is total players. So AI = count - 1
            ai_count = max(0, count - 1)
            print(f"DEBUG: Starting new game {game_id} with 1 Human + {ai_count} AI", flush=True)
            games[game_id] = ChkoubaEngine([player_name], ai_count=ai_count)
            print(f"DEBUG: Game engine started", flush=True)
        else:
            # If human player joins existing game, add them if not already there
            if not any(p.name == player_name for p in games[game_id].state.players):
                 print(f"DEBUG: Player {player_name} joined existing game {game_id}", flush=True)
                 for p in games[game_id].state.players:
                     if not p.is_ai:
                         p.name = player_name
                         break
    except Exception as e:
        print(f"CRITICAL ERROR Initializing Game: {e}", flush=True)
        import traceback
        traceback.print_exc()
        try:
             await websocket.close(code=1011, reason=f"Init Error: {str(e)}")
        except:
             pass
        return
    
    try:
        # Send initial state
        print(f"DEBUG: Sending initial state for {game_id}", flush=True)
        state_data = jsonable_encoder(games[game_id].state)
        
        await websocket.send_json({
            "type": "INIT",
            "state": state_data
        })
        print(f"DEBUG: Initial state sent", flush=True)
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message.get("type") == "GET_STATE":
                    state_data = jsonable_encoder(games[game_id].state)
                    await websocket.send_json({
                        "type": "UPDATE",
                        "state": state_data
                    })
                
                elif message.get("type") == "PLAY_CARD":
                    p_idx = message.get("player_index")
                    c_id = message.get("card_id")
                    combo_idx = message.get("combo_index")
                    
                    if p_idx is not None and c_id:
                        print(f"DEBUG: Player {p_idx} playing {c_id}", flush=True)
                        try:
                            game = games[game_id]
                            success = game.play_card(p_idx, c_id, combo_idx)
                            if success:
                                # Verify if round ended
                                if game.state.round_finished:
                                    print(f"DEBUG: Round finished, dealing new", flush=True)
                                    game.start_new_round()
                                
                                # Broadcast State
                                # Broadcast State
                                state_data = jsonable_encoder(game.state)
                                await manager.broadcast(game_id, {
                                    "type": "UPDATE",
                                    "state": state_data
                                })
                                
                                # NO AI LOOP HERE. Wait for ANIMATION_COMPLETE.

                        except Exception as inner_e:
                            print(f"ERROR playing card: {inner_e}", flush=True)
                            import traceback
                            traceback.print_exc()

                elif message.get("type") == "ANIMATION_COMPLETE":
                    try:
                        game = games[game_id]
                        if not game.state.round_finished and not game.state.game_over:
                            current_p = game.state.players[game.state.current_player_index]
                            if current_p.is_ai:
                                print(f"DEBUG: ANIMATION_COMPLETE received. Executing AI Turn for {current_p.name}", flush=True)
                                
                                # Small thinking delay for realism (non-blocking animation)
                                await asyncio.sleep(0.5)
                                
                                ai_idx = game.state.current_player_index
                                ai_card_id, ai_combo_idx = game.get_ai_move()
                                
                                if ai_card_id:
                                    print(f"DEBUG: AI plays {ai_card_id}, combo {ai_combo_idx}", flush=True)
                                    game.play_card(ai_idx, ai_card_id, ai_combo_idx)
                                    
                                    # Broadcast New State (triggering frontend animation)
                                    state_data = jsonable_encoder(game.state)
                                    await manager.broadcast(game_id, {
                                        "type": "UPDATE",
                                        "state": state_data
                                    })
                                    
                                    # Check for Mid-Round Hand Refill
                                    players_empty = all(not p.hand for p in game.state.players)
                                    if players_empty and game.state.deck and not game.state.round_finished:
                                        await asyncio.sleep(2.0) # Wait for table clear anim
                                        game.deal_cards()
                                        state_data = jsonable_encoder(game.state)
                                        await manager.broadcast(game_id, {
                                            "type": "UPDATE",
                                            "state": state_data
                                        })
                    except Exception as inner_e:
                        print(f"ERROR playing card: {inner_e}", flush=True)
                        import traceback
                        traceback.print_exc()

                elif message.get("type") == "NEXT_ROUND":
                    game = games[game_id]
                    game.start_new_round()
                    state_data = jsonable_encoder(game.state)
                    await manager.broadcast(game_id, {
                        "type": "UPDATE", 
                        "state": state_data
                    })
                            
                elif message.get("type") == "RESET":
                    print(f"DEBUG: Resetting game {game_id}", flush=True)
                    game = games[game_id]
                    # Fix: Preserve existing AI count
                    current_ai_count = sum(1 for p in game.state.players if p.is_ai)
                    game.__init__([p.name for p in game.state.players if not p.is_ai], ai_count=current_ai_count)
                    
                    state_data = jsonable_encoder(game.state)
                    await manager.broadcast(game_id, {
                        "type": "INIT",
                        "state": state_data
                    })
                    print(f"DEBUG: RESET Game {game_id} with {current_ai_count} AI", flush=True)

            except WebSocketDisconnect:
                print(f"DEBUG: Client disconnected {game_id}", flush=True)
                manager.disconnect(game_id, websocket)
                break
            except Exception as e:
                print(f"ERROR inside loop: {e}", flush=True)
                break
                
    except Exception as e:
        print(f"CRITICAL Connection Error: {e}", flush=True)
        manager.disconnect(game_id, websocket)

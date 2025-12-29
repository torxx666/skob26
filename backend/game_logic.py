import random
from typing import List, Tuple, Optional, Dict
from pydantic import BaseModel

class Card(BaseModel):
    suit: str  # D (Dinari), C (Copas), S (Spadas), B (Bastoni)
    value: int # 1 to 10
    id: str

class Player(BaseModel):
    name: str
    hand: List[Card] = []
    captured_cards: List[Card] = []
    chkoubas: int = 0
    is_ai: bool = False

class GameState(BaseModel):
    deck: List[Card] = []
    table: List[Card] = []
    players: List[Player] = []
    last_capture_player_index: Optional[int] = None
    current_player_index: int = 0
    round_finished: bool = False
    game_over: bool = False
    scores: Dict[str, int] = {} # Overall game scores

def create_deck() -> List[Card]:
    suits = ['H', 'S', 'D', 'C'] # Hearts, Spades, Diamonds, Clubs
    deck = []
    for suit in suits:
        for val in range(1, 11):
            deck.append(Card(suit=suit, value=val, id=f"{val}{suit}")) # Value then Suit for ID
    random.shuffle(deck)
    return deck

class ChkoubaEngine:
    def __init__(self, player_names: List[str], ai_count: int = 0):
        self.state = GameState()
        for name in player_names:
            self.state.players.append(Player(name=name))
        for i in range(ai_count):
            self.state.players.append(Player(name=f"AI {i+1}", is_ai=True))
        
        self.start_new_round()
        print(f"DEBUG: Game initialized with players: {[p.name for p in self.state.players]}")
        print(f"DEBUG: Initial Table: {[c.id for c in self.state.table]}")

    def start_new_round(self):
        self.state.deck = create_deck()
        self.state.table = [self.state.deck.pop() for _ in range(4)]
        # Check for 3 of a kind on table
        while len(set(c.value for c in self.state.table)) <= 1 and len(self.state.table) >= 3:
             self.state.deck = create_deck()
             self.state.table = [self.state.deck.pop() for _ in range(4)]
        
        self.deal_cards()
        self.state.round_finished = False

    def deal_cards(self):
        if not self.state.deck:
            return
        for player in self.state.players:
            player.hand = [self.state.deck.pop() for _ in range(3)]

    def get_valid_captures(self, card: Card) -> List[List[Card]]:
        from itertools import combinations
        
        # Priority rule: must take equal card if exists
        direct_match = [c for c in self.state.table if c.value == card.value]
        if direct_match:
            return [[c] for c in direct_match]
        
        # Sums
        results = []
        for i in range(2, len(self.state.table) + 1):
            for combo in combinations(self.state.table, i):
                if sum(c.value for c in combo) == card.value:
                    results.append(list(combo))
        return results

    def play_card(self, player_index: int, card_id: str, capture_combo_index: Optional[int] = None):
        player = self.state.players[player_index]
        card = next((c for c in player.hand if c.id == card_id), None)
        if not card:
            return False
        
        valid_combos = self.get_valid_captures(card)
        
        if valid_combos and capture_combo_index is not None:
            combo = valid_combos[capture_combo_index]
            # Capture
            player.captured_cards.append(card)
            player.captured_cards.extend(combo)
            # Remove from table
            self.state.table = [c for c in self.state.table if c not in combo]
            # Check for Chkouba
            if not self.state.table and not self.is_last_card_of_round():
                player.chkoubas += 1
            self.state.last_capture_player_index = player_index
        else:
            # Drop card
            self.state.table.append(card)
        
        player.hand.remove(card)
        current_scores = {p.name: self.state.scores.get(p.name, 0) for p in self.state.players}
        print(f"DEBUG: Player {player.name} played {card.id}. Scores: {current_scores}")
        self.next_turn()
        return True

    def next_turn(self):
        self.state.current_player_index = (self.state.current_player_index + 1) % len(self.state.players)
        
        # Check if hands are empty
        if all(not p.hand for p in self.state.players):
            if self.state.deck:
                self.deal_cards()
            else:
                self.end_round()

    def is_last_card_of_round(self) -> bool:
        return not self.state.deck and all(len(p.hand) == 0 for p in self.state.players)

    def end_round(self):
        # Last player to capture takes remaining cards
        if self.state.last_capture_player_index is not None:
            self.state.players[self.state.last_capture_player_index].captured_cards.extend(self.state.table)
        self.state.table = []
        self.state.round_finished = True
        self.calculate_points()

    def calculate_points(self): # Returns round points
        p1_cards = self.state.players[0].captured_cards
        p2_cards = self.state.players[1].captured_cards
        
        round_points = [0] * len(self.state.players)
        
        # 1. Carta
        counts = [len(p.captured_cards) for p in self.state.players]
        max_count = max(counts)
        if counts.count(max_count) == 1:
            round_points[counts.index(max_count)] += 1
            
        # 2. Dinari (Diamonds)
        dinari_counts = [len([c for c in p.captured_cards if c.suit == 'D']) for p in self.state.players]
        max_dinari = max(dinari_counts)
        if dinari_counts.count(max_dinari) == 1:
            round_points[dinari_counts.index(max_dinari)] += 1
            
        # 3. Sebaa Dinari (7 of Diamonds)
        for i, p in enumerate(self.state.players):
            if any(c.id == '7D' for c in p.captured_cards):
                round_points[i] += 1
                break
                
        # 4. Bermila (Primary)
        # Simplify: Most 7s, else most 6s, etc.
        for val in [7, 6, 5, 4, 3, 2, 1, 10, 9, 8]:
            val_counts = [len([c for c in p.captured_cards if c.value == val]) for p in self.state.players]
            max_val = max(val_counts)
            if val_counts.count(max_val) == 1:
                round_points[val_counts.index(max_val)] += 1
                break
        
        # 5. Chkoubas
        for i, p in enumerate(self.state.players):
            round_points[i] += p.chkoubas

        # Update total scores
        for i, pts in enumerate(round_points):
            name = self.state.players[i].name
            self.state.scores[name] = self.state.scores.get(name, 0) + pts
            
        # Check for game over (usually 21 points)
        for name, score in self.state.scores.items():
            if score >= 21:
                self.state.game_over = True
        
        return round_points

    def get_ai_move(self) -> Tuple[str, Optional[int]]:
        player = self.state.players[self.state.current_player_index]
        
        best_card_id = None
        best_combo_idx = None
        best_score = -1

        for card in player.hand:
            combos = self.get_valid_captures(card)
            if not combos:
                continue
                
            for idx, combo in enumerate(combos):
                score = 0
                # Priority 1: Seven of Diamonds (D7)
                if any(c.id == '7D' for c in combo) or card.id == '7D':
                    score += 100
                
                # Priority 2: Diamonds
                diamonds = len([c for c in combo if c.suit == 'D'])
                if card.suit == 'D':
                    diamonds += 1
                score += diamonds * 10
                
                # Priority 3: Quantity of cards
                score += len(combo) + 1
                
                if score > best_score:
                    best_score = score
                    best_card_id = card.id
                    best_combo_idx = idx

        if best_card_id:
            return best_card_id, best_combo_idx
            
        # If no capture, drop the lowest value card to avoid giving big points
        # (Very simple defensive play)
        lowest_card = min(player.hand, key=lambda c: c.value)
        return lowest_card.id, None

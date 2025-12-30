import sys
import traceback

try:
    print("Importing game_logic...")
    from game_logic import ChkoubaEngine, Card, create_deck
    print("Import successful.")

    print("Testing create_deck()...")
    deck = create_deck()
    print(f"Deck created. Size: {len(deck)}")
    if len(deck) != 40:
        print("ERROR: Deck size is not 40!")
    print(f"Sample card: {deck[0]}")

    print("Initializing ChkoubaEngine...")
    game = ChkoubaEngine(["TestPlayer"], ai_count=1)
    print("Engine initialized.")
    
    print("State Check:")
    print(f"- Table: {len(game.state.table)} cards")
    print(f"- P1 Hand: {len(game.state.players[0].hand)} cards")
    print(f"- AI Hand: {len(game.state.players[1].hand)} cards")
    
    if len(game.state.table) != 4:
        print("ERROR: Table should have 4 cards.")
        
    print("Test Complete: SUCCESS")

except Exception as e:
    print("\nCRITICAL FAILURE:")
    traceback.print_exc()
    sys.exit(1)

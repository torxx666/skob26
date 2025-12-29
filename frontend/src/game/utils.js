// Helper to get card asset names
export const getCardId = (suit, value) => `${suit}${value}`;

export const CARD_SUITS = {
    D: 'Dinari',
    C: 'Copas',
    S: 'Spadas',
    B: 'Bastoni'
};

export const CARD_VALUES = {
    1: 'As',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: 'Dame',
    9: 'Valet',
    10: 'Roi'
};

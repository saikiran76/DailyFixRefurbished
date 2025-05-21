/**
 * EmojiUtils - Functions to generate emojis for contact avatars
 */

// Map of letters to emojis for consistent display
const letterToEmojiMap = {
  'a': '👨‍🎨', 'b': '🐻', 'c': '🍪', 'd': '🐶', 'e': '🦅', 
  'f': '🦊', 'g': '🦒', 'h': '🏠', 'i': '🍦', 'j': '🤹‍♂️',
  'k': '🔑', 'l': '🦁', 'm': '🌙', 'n': '📝', 'o': '🦉',
  'p': '🐼', 'q': '👸', 'r': '🤖', 's': '🌟', 't': '🐯',
  'u': '☂️', 'v': '🌋', 'w': '🌊', 'x': '❌', 'y': '🧠',
  'z': '⚡', '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣',
  '4': '4️⃣', '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'
};

// Special emojis for specific common names
const nameToEmojiMap = {
  'mom': '👩‍👦',
  'dad': '👨‍👦',
  'grandma': '👵',
  'grandpa': '👴',
  'sister': '👧',
  'brother': '👦',
  'work': '💼',
  'boss': '👨‍💼',
  'friend': '🤝',
  'bestfriend': '🫂',
  'support': '🛟',
  'help': '🆘',
  'info': 'ℹ️',
  'news': '📰',
  'telegram': '📱',
  'group': '👥',
  'team': '🏆',
  'family': '👨‍👩‍👧‍👦'
};

/**
 * Generate an emoji for a display name
 * @param {string} displayName - The contact's display name
 * @returns {string|null} - An emoji representing the contact, or null if no match
 */
export const getEmojiForDisplayName = (displayName) => {
  if (!displayName) return null;
  
  // Convert to lowercase for matching
  const lowerName = displayName.toLowerCase();
  
  // Check if name directly matches any special names
  for (const [name, emoji] of Object.entries(nameToEmojiMap)) {
    if (lowerName.includes(name)) {
      return emoji;
    }
  }
  
  // Otherwise use first character
  const firstChar = lowerName.charAt(0).toLowerCase();
  return letterToEmojiMap[firstChar] || null;
};

/**
 * Generate a color for a display name (for avatar background)
 * @param {string} displayName - The contact's display name
 * @returns {string} - A CSS color value
 */
export const getColorForDisplayName = (displayName) => {
  if (!displayName) return '#2b5278'; // Default blue
  
  // Simple hash function for consistent colors
  let hash = 0;
  for (let i = 0; i < displayName.length; i++) {
    hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Convert to RGB
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Light blue
    '#FFA5A5', // Pink  
    '#98D8C8', // Mint
    '#FFBE76', // Orange
    '#A29BFE', // Purple
    '#55E6C1', // Green
    '#F78FB3', // Rose
    '#3498DB', // Blue
    '#9B59B6', // Violet
    '#1ABC9C', // Turquoise
    '#F1C40F', // Yellow
    '#E67E22', // Dark orange
    '#E74C3C', // Dark red
    '#2ECC71'  // Emerald
  ];
  
  // Use the hash to select a color
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

export default {
  getEmojiForDisplayName,
  getColorForDisplayName
}; 
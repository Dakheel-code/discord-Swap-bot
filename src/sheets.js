import { google } from 'googleapis';
import { config } from './config.js';
import fs from 'fs';

let sheetsClient = null;
let sheetsClientWithAuth = null; // For write operations

/**
 * Initialize Google Sheets API client using API Key
 */
export async function initializeSheetsClient() {
  try {
    // Use API Key for read operations
    sheetsClient = google.sheets({ 
      version: 'v4', 
      auth: config.googleSheets.apiKey 
    });
    
    // Try to initialize Service Account for write operations
    let credentials = null;
    
    // Method 1: Try to read from environment variable (for Railway/Heroku)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        console.log('✅ Service Account loaded from environment variable');
      } catch (parseError) {
        console.error('❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', parseError.message);
      }
    }
    
    // Method 2: Try to read from file (for local development)
    if (!credentials && config.googleSheets.serviceAccountPath && fs.existsSync(config.googleSheets.serviceAccountPath)) {
      try {
        credentials = JSON.parse(fs.readFileSync(config.googleSheets.serviceAccountPath, 'utf8'));
        console.log('✅ Service Account loaded from file');
      } catch (fileError) {
        console.error('❌ Failed to read service account file:', fileError.message);
      }
    }
    
    // Initialize auth if credentials are available
    if (credentials) {
      try {
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        sheetsClientWithAuth = google.sheets({ version: 'v4', auth });
        console.log('✅ Google Sheets API initialized with write access');
      } catch (authError) {
        console.error('❌ Failed to initialize auth:', authError.message);
      }
    } else {
      console.warn('⚠️ Service Account not configured. Write operations will fail.');
      console.warn('   Add GOOGLE_SERVICE_ACCOUNT_JSON to environment variables');
      console.warn('   OR add GOOGLE_SERVICE_ACCOUNT_PATH to .env file');
    }
    
    console.log('✅ Google Sheets API initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Google Sheets API:', error.message);
    return false;
  }
}

/**
 * Fetch data from Google Sheets
 * @returns {Promise<Array<Object>>} Array of player objects
 */
export async function fetchPlayersData() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: config.googleSheets.range,
    });

    const rows = response.data.values;
    
    if (!rows || rows.length === 0) {
      console.log('No data found in sheet');
      return [];
    }

    // First row is headers
    const headers = rows[0].map(h => h.trim());
    const players = [];

    // Find Clan column index
    let clanColumnIndex = -1;
    const clanHeaders = ['Clan', 'clan', 'CLAN', 'Team', 'team', 'TEAM', 'Guild', 'guild'];
    
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].trim();
      if (clanHeaders.includes(header)) {
        clanColumnIndex = i;
        console.log(`✅ Found Clan column at index ${i} (${header})`);
        break;
      }
    }
    
    // Convert rows to objects
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const player = {};
      
      headers.forEach((header, index) => {
        player[header] = row[index] || '';
      });

      // Add Clan column if found
      if (clanColumnIndex !== -1 && row[clanColumnIndex]) {
        player.Clan = row[clanColumnIndex].trim();
      }

      players.push(player);
    }

    console.log(`✅ Fetched ${players.length} players from Google Sheets`);
    return players;
  } catch (error) {
    console.error('❌ Error fetching data from Google Sheets:', error.message);
    throw error;
  }
}

/**
 * Fetch Discord name mapping from DiscordMap sheet
 * @returns {Promise<Map<string, object>>} Map of Player_ID -> {discordName, action}
 */
export async function fetchDiscordMapping() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:C',
    });

    const rows = response.data.values;
    const mapping = new Map();

    if (!rows || rows.length === 0) {
      console.log('⚠️ No Discord mapping found');
      return mapping;
    }

    // Skip header row, map Player_ID (column A) to {discordName (column B), action (column C)}
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] && row[1]) {
        const playerId = String(row[0]).trim();
        const discordName = String(row[1]).trim();
        const action = row[2] ? String(row[2]).trim() : '';
        mapping.set(playerId, { discordName, action });
      }
    }

    console.log(`✅ Loaded ${mapping.size} Discord name mappings`);
    return mapping;
  } catch (error) {
    console.error('⚠️ Error fetching Discord mapping:', error.message);
    return new Map(); // Return empty map if sheet doesn't exist
  }
}

/**
 * Fetch data from Google Sheets with Discord names
 * @returns {Promise<Array<Object>>} Array of player objects with Discord names
 */
export async function fetchPlayersDataWithDiscordNames() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    // Fetch players data
    const players = await fetchPlayersData();
    
    // Fetch Discord mapping
    const discordMapping = await fetchDiscordMapping();

    // Replace names with Discord names based on Player_ID
    let playersWithDiscordId = 0;
    players.forEach((player, index) => {
      // Try to find Player_ID in different possible column names
      const playerId = player['Player_ID'] || player['PlayerID'] || player['ID'] || player['player_id'];
      
      if (playerId && discordMapping.has(String(playerId).trim())) {
        const mappingData = discordMapping.get(String(playerId).trim());
        let discordName = mappingData.discordName;
        let discordId = null;
        const action = mappingData.action;
        
        // Check if it's a Discord User ID (numeric) or username
        if (discordName) {
          // If it's all digits, it's a Discord User ID - format as mention
          if (/^\d+$/.test(discordName.trim())) {
            discordId = discordName.trim(); // Store the raw Discord ID
            discordName = `<@${discordName.trim()}>`;
            playersWithDiscordId++;
          } 
          // If it already has <@...> format, extract the ID
          else if (discordName.startsWith('<@') && discordName.endsWith('>')) {
            const match = discordName.match(/<@!?(\d+)>/);
            if (match) {
              discordId = match[1]; // Extract Discord ID from mention
              playersWithDiscordId++;
            }
          }
          // Otherwise, it's a username - add @ prefix
          else if (!discordName.startsWith('@')) {
            discordName = '@' + discordName;
          }
        }
        
        player.DiscordName = discordName;
        player['Discord-ID'] = discordId; // Add Discord ID as a separate field
        player.Action = action; // Add Action from DiscordMap
        player.OriginalName = player.Name || player.Player || player.USERNAME;
        // Update the display name
        player.DisplayName = discordName;
        
        // Debug: Log first 3 players with Discord ID
        if (index < 3 && discordId) {
          console.log(`📋 Player ${index + 1}: PlayerId="${playerId}", DiscordName="${discordName}", Discord-ID="${discordId}", Action="${action}"`);
        }
      } else {
        // Keep original name if no mapping found
        player.DisplayName = player.Name || player.Player || player.USERNAME || 'Unknown';
      }
    });

    console.log(`✅ Processed ${players.length} players with Discord names (${playersWithDiscordId} with Discord IDs)`);
    return players;
  } catch (error) {
    console.error('❌ Error fetching players with Discord names:', error.message);
    throw error;
  }
}

/**
 * Get available columns from the sheet
 * @returns {Promise<Array<string>>} Array of column names
 */
export async function getAvailableColumns() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: config.googleSheets.range.split('!')[0] + '!1:1',
    });

    const headers = response.data.values?.[0] || [];
    return headers.map(h => h.trim());
  } catch (error) {
    console.error('❌ Error fetching columns:', error.message);
    throw error;
  }
}

/**
 * Write Discord mapping to DiscordMap sheet
 * @param {string} ingameId - In-game player name/ID
 * @param {string} discordId - Discord user ID or username
 * @returns {Promise<boolean>} Success status
 */
export async function writeDiscordMapping(ingameId, discordId, discordUsername = '') {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  try {
    // Get all current data from DiscordMap sheet
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:D',
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    // Check if Discord ID already exists in column B
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] && String(rows[i][1]).trim() === String(discordId).trim()) {
        rowIndex = i + 1; // +1 because sheets are 1-indexed
        break;
      }
    }

    // Prepare the data to write: A=Ingame-ID, B=Discord-ID, C=Action, D=Username
    const values = [[ingameId, discordId, '', discordUsername]];

    if (rowIndex > 0) {
      // Update existing row
      await sheetsClientWithAuth.spreadsheets.values.update({
        spreadsheetId: config.googleSheets.sheetId,
        range: `DiscordMap!A${rowIndex}:D${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values },
      });
      console.log(`✅ Updated Discord mapping for ${ingameId}`);
    } else {
      // Append new row
      await sheetsClientWithAuth.spreadsheets.values.append({
        spreadsheetId: config.googleSheets.sheetId,
        range: 'DiscordMap!A:D',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values },
      });
      console.log(`✅ Added new Discord mapping for ${ingameId}`);
    }

    return true;
  } catch (error) {
    console.error('❌ Error writing Discord mapping:', error.message);
    throw error;
  }
}

/**
 * Get Ingame-ID from Discord mention by looking up DiscordMap sheet
 * @param {string} playerName - Player name (could be Discord mention or Ingame-ID)
 * @returns {Promise<string>} Ingame-ID
 */
async function getIngameId(playerName) {
  // If it's a Discord mention (<@123456>), look it up in DiscordMap
  if (playerName.startsWith('<@') && playerName.endsWith('>')) {
    try {
      const discordId = playerName.replace(/<@!?(\d+)>/, '$1');
      
      // Get DiscordMap data
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: config.googleSheets.sheetId,
        range: 'DiscordMap!A:C',
      });

      const rows = response.data.values || [];
      
      // Find the row with matching Discord_ID (column B)
      for (let i = 1; i < rows.length; i++) {
        const rowDiscordId = rows[i][1]; // Column B
        if (rowDiscordId && String(rowDiscordId).trim() === discordId) {
          // Return Ingame-ID from column C (index 2)
          const ingameId = rows[i][2];
          if (ingameId) {
            console.log(`✅ Found Ingame-ID "${ingameId}" for Discord mention ${playerName}`);
            return String(ingameId).trim();
          }
        }
      }
      
      console.warn(`⚠️ No Ingame-ID found for Discord mention ${playerName}`);
    } catch (error) {
      console.warn(`⚠️ Error looking up DiscordMap: ${error.message}`);
    }
  }
  
  // Return original name if not a mention or not found
  return playerName;
}

/**
 * Write action to DiscordMap sheet column C (Action)
 * @param {string} discordId - Discord user ID (numeric string)
 * @param {string} action - Action to write (clan name or 'Hold')
 * @returns {Promise<boolean>} Success status
 */
export async function writePlayerAction(discordId, action) {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  try {
    console.log(`🔍 Searching for Discord ID: "${discordId}" in DiscordMap sheet`);
    
    // Get DiscordMap sheet data
    const discordMapResponse = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:Z',
    });

    const discordMapRows = discordMapResponse.data.values || [];
    if (discordMapRows.length === 0) {
      throw new Error('No data found in DiscordMap sheet');
    }

    console.log(`📊 DiscordMap: ${discordMapRows.length} rows`);
    console.log(`📋 DiscordMap Headers: ${discordMapRows[0] ? discordMapRows[0].join(' | ') : 'No headers'}`);
    
    // Find Discord-ID column
    let discordIdCol = -1;
    
    if (discordMapRows[0]) {
      for (let col = 0; col < discordMapRows[0].length; col++) {
        const header = String(discordMapRows[0][col]).toLowerCase().trim();
        if (header.includes('discord') && header.includes('id')) {
          discordIdCol = col;
          console.log(`✅ Found Discord-ID column at index ${col} (${discordMapRows[0][col]})`);
          break;
        }
      }
    }
    
    // If not found, assume column B (index 1)
    if (discordIdCol === -1) {
      discordIdCol = 1;
      console.log(`⚠️ Discord-ID column not found, assuming column B (index 1)`);
    }
    
    // Find player by Discord ID
    let rowIndex = -1;
    
    console.log(`🔍 Searching for Discord ID "${discordId}" in column ${discordIdCol}...`);
    
    for (let i = 1; i < discordMapRows.length; i++) {
      const rowDiscordId = discordMapRows[i][discordIdCol];
      
      // Debug: Log first 5 rows
      if (i <= 5) {
        console.log(`  Row ${i + 1}: Discord-ID = "${rowDiscordId}" (comparing with "${discordId}")`);
      }
      
      if (rowDiscordId && String(rowDiscordId).trim() === String(discordId).trim()) {
        rowIndex = i + 1; // +1 because sheets are 1-indexed
        console.log(`✅ Found Discord ID at row ${rowIndex}`);
        break;
      }
    }

    if (rowIndex === -1) {
      const allDiscordIds = discordMapRows.slice(1, Math.min(11, discordMapRows.length))
        .map((r, idx) => `Row ${idx + 2}: Discord-ID="${r[discordIdCol] || 'empty'}"`).join('\n');
      throw new Error(`Player not found: Discord ID "${discordId}" not found in DiscordMap sheet (Column: ${discordMapRows[0][discordIdCol]}).\n\nFirst 10 rows:\n${allDiscordIds}\n\nPlease use /map command to link this player first.`);
    }

    // Write to column C (Action) in DiscordMap
    const range = `DiscordMap!C${rowIndex}`;

    await sheetsClientWithAuth.spreadsheets.values.update({
      spreadsheetId: config.googleSheets.sheetId,
      range: range,
      valueInputOption: 'RAW',
      resource: { values: [[action]] },
    });

    console.log(`✅ Updated Action for Discord ID "${discordId}" to "${action}" at ${range}`);
    return true;
  } catch (error) {
    console.error('❌ Error writing player action:', error.message);
    throw error;
  }
}

/**
 * Clear action from DiscordMap sheet column C
 * @param {string} discordId - Discord user ID (numeric string)
 * @returns {Promise<{success: boolean, previousValue: string}>} Result with previous value
 */
export async function clearPlayerAction(discordId) {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  try {
    console.log(`🔍 Clearing action for Discord ID: "${discordId}" in DiscordMap`);
    
    // Get DiscordMap sheet data
    const discordMapResponse = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:Z',
    });

    const discordMapRows = discordMapResponse.data.values || [];
    if (discordMapRows.length === 0) {
      throw new Error('No data found in DiscordMap sheet');
    }
    
    console.log(`📊 DiscordMap: ${discordMapRows.length} rows`);
    
    // Find Discord-ID column
    let discordIdCol = -1;
    
    if (discordMapRows[0]) {
      for (let col = 0; col < discordMapRows[0].length; col++) {
        const header = String(discordMapRows[0][col]).toLowerCase().trim();
        if (header.includes('discord') && header.includes('id')) {
          discordIdCol = col;
          break;
        }
      }
    }
    
    // If not found, assume column B (index 1)
    if (discordIdCol === -1) {
      discordIdCol = 1;
    }
    
    // Find player row in DiscordMap
    let rowIndex = -1;
    
    for (let i = 1; i < discordMapRows.length; i++) {
      const rowDiscordId = discordMapRows[i][discordIdCol];
      if (rowDiscordId && String(rowDiscordId).trim() === String(discordId).trim()) {
        rowIndex = i + 1; // +1 because sheets are 1-indexed
        console.log(`✅ Found player at row ${rowIndex} in DiscordMap`);
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error(`Player not found: Discord ID "${discordId}" not found in DiscordMap sheet`);
    }

    // Get current value before clearing (Column C is index 2)
    const currentValue = discordMapRows[rowIndex - 1][2] || '';
    console.log(`📋 Current Action value: "${currentValue}"`);
    
    // Clear column C (Action) in DiscordMap
    const range = `DiscordMap!C${rowIndex}`;

    await sheetsClientWithAuth.spreadsheets.values.update({
      spreadsheetId: config.googleSheets.sheetId,
      range: range,
      valueInputOption: 'RAW',
      resource: { values: [['']] },
    });

    console.log(`✅ Cleared Action for Discord ID ${discordId} at ${range}`);
    return { success: true, previousValue: currentValue };
  } catch (error) {
    console.error('❌ Error clearing player action:', error.message);
    throw error;
  }
}

/**
 * Clear all actions from DiscordMap sheet column C (Action)
 * @returns {Promise<{success: boolean, clearedCount: number}>} Result with count of cleared rows
 */
export async function clearAllPlayerActions() {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  try {
    console.log(`🔍 Clearing all actions from DiscordMap sheet...`);
    
    // Get all data from DiscordMap sheet
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:Z',
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      throw new Error('No data found in DiscordMap sheet');
    }

    console.log(`📊 DiscordMap: ${rows.length} rows`);
    
    // Count how many rows have actions
    let clearedCount = 0;
    const emptyValues = [];
    
    // Start from row 2 (skip header)
    for (let i = 1; i < rows.length; i++) {
      const currentAction = rows[i][2] || ''; // Column C is index 2
      if (currentAction.trim()) {
        clearedCount++;
      }
      emptyValues.push(['']); // Empty value for each row
    }

    if (clearedCount === 0) {
      console.log('ℹ️ No actions found to clear');
      return { success: true, clearedCount: 0 };
    }

    // Clear entire column C (from row 2 to last row)
    const range = `DiscordMap!C2:C${rows.length}`;

    await sheetsClientWithAuth.spreadsheets.values.update({
      spreadsheetId: config.googleSheets.sheetId,
      range: range,
      valueInputOption: 'RAW',
      resource: { values: emptyValues },
    });

    console.log(`✅ Cleared ${clearedCount} actions from DiscordMap column C (${range})`);
    return { success: true, clearedCount };
    
  } catch (error) {
    console.error('❌ Error clearing all player actions:', error.message);
    throw error;
  }
}

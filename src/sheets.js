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
    if (config.googleSheets.serviceAccountPath && fs.existsSync(config.googleSheets.serviceAccountPath)) {
      try {
        const credentials = JSON.parse(fs.readFileSync(config.googleSheets.serviceAccountPath, 'utf8'));
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        sheetsClientWithAuth = google.sheets({ version: 'v4', auth });
        console.log('✅ Google Sheets API initialized with write access');
      } catch (authError) {
        console.warn('⚠️ Service Account not configured. Write operations will fail.');
        console.warn('   To enable /map command, add GOOGLE_SERVICE_ACCOUNT_PATH to .env');
      }
    } else {
      console.warn('⚠️ Service Account not found. Read-only mode.');
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

    // Convert rows to objects
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const player = {};
      
      headers.forEach((header, index) => {
        player[header] = row[index] || '';
      });

      // Add column E as 'Clan' regardless of header name (E is index 4)
      if (row[4]) {
        player.Clan = row[4].trim();
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
 * @returns {Promise<Map<string, string>>} Map of Player_ID -> Discord_Name
 */
export async function fetchDiscordMapping() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:B',
    });

    const rows = response.data.values;
    const mapping = new Map();

    if (!rows || rows.length === 0) {
      console.log('⚠️ No Discord mapping found');
      return mapping;
    }

    // Skip header row, map Player_ID (column A) to Discord_Name (column B)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] && row[1]) {
        const playerId = String(row[0]).trim();
        const discordName = String(row[1]).trim();
        mapping.set(playerId, discordName);
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
    players.forEach(player => {
      // Try to find Player_ID in different possible column names
      const playerId = player['Player_ID'] || player['PlayerID'] || player['ID'] || player['player_id'];
      
      if (playerId && discordMapping.has(String(playerId).trim())) {
        let discordName = discordMapping.get(String(playerId).trim());
        
        // Check if it's a Discord User ID (numeric) or username
        if (discordName) {
          // If it's all digits, it's a Discord User ID - format as mention
          if (/^\d+$/.test(discordName.trim())) {
            discordName = `<@${discordName.trim()}>`;
          } 
          // If it already has <@...> format, keep it
          else if (discordName.startsWith('<@') && discordName.endsWith('>')) {
            // Already in mention format, keep as is
          }
          // Otherwise, it's a username - add @ prefix
          else if (!discordName.startsWith('@')) {
            discordName = '@' + discordName;
          }
        }
        
        player.DiscordName = discordName;
        player.OriginalName = player.Name || player.Player || player.USERNAME;
        // Update the display name
        player.DisplayName = discordName;
      } else {
        // Keep original name if no mapping found
        player.DisplayName = player.Name || player.Player || player.USERNAME || 'Unknown';
      }
    });

    console.log(`✅ Processed ${players.length} players with Discord names`);
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
export async function writeDiscordMapping(ingameId, discordId) {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  try {
    // Get all current data from DiscordMap sheet
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:B',
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    // Check if ingameId already exists
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] && String(rows[i][0]).trim() === ingameId.trim()) {
        rowIndex = i + 1; // +1 because sheets are 1-indexed
        break;
      }
    }

    // Prepare the data to write
    const values = [[ingameId, discordId]];

    if (rowIndex > 0) {
      // Update existing row
      await sheetsClientWithAuth.spreadsheets.values.update({
        spreadsheetId: config.googleSheets.sheetId,
        range: `DiscordMap!A${rowIndex}:B${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values },
      });
      console.log(`✅ Updated Discord mapping for ${ingameId}`);
    } else {
      // Append new row
      await sheetsClientWithAuth.spreadsheets.values.append({
        spreadsheetId: config.googleSheets.sheetId,
        range: 'DiscordMap!A:B',
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

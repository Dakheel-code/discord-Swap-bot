import { google } from 'googleapis';
import { config } from './config.js';
import fs from 'fs';

let sheetsClient = null;
let sheetsClientWithAuth = null; // For write operations

function safeJsonParse(raw, contextLabel = 'JSON') {
  const text = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    const prefix = text.slice(0, 40);
    throw new Error(`Failed to parse ${contextLabel}: ${error.message}. Starts with: ${JSON.stringify(prefix)}`);
  }
}

async function ensureDiscordMapHeaders() {
  if (!sheetsClientWithAuth) {
    return false;
  }

  const desired = ['Ingame-ID', 'Discord-ID', 'Action', 'Name'];

  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A1:D1',
    });

    const current = (res.data.values && res.data.values[0]) ? res.data.values[0] : [];

    let needsUpdate = false;
    for (let i = 0; i < desired.length; i++) {
      const cur = current[i] ? String(current[i]).trim() : '';
      if (cur !== desired[i]) {
        needsUpdate = true;
        break;
      }
    }

    if (!needsUpdate) {
      return true;
    }

    await sheetsClientWithAuth.spreadsheets.values.update({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A1:D1',
      valueInputOption: 'RAW',
      resource: { values: [desired] },
    });

    try {
      const dataRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: config.googleSheets.sheetId,
        range: 'DiscordMap!A:D',
      });

      const rows = dataRes.data.values || [];
      if (rows.length > 1) {
        const updates = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] || [];
          const ingameId = row[0] ? String(row[0]).trim() : '';
          const colB = row[1] ? String(row[1]).trim() : '';
          const action = row[2] ? String(row[2]).trim() : '';
          const colD = row[3] ? String(row[3]).trim() : '';

          const bLooksLikeId = /^\d{17,20}$/.test(colB);
          const dLooksLikeId = /^\d{17,20}$/.test(colD);

          if (!bLooksLikeId && dLooksLikeId && ingameId) {
            updates.push({
              range: `DiscordMap!A${i + 1}:D${i + 1}`,
              values: [[ingameId, colD, action, '']],
            });
          }
        }

        if (updates.length) {
          await sheetsClientWithAuth.spreadsheets.values.batchUpdate({
            spreadsheetId: config.googleSheets.sheetId,
            resource: {
              valueInputOption: 'RAW',
              data: updates,
            },
          });
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to migrate legacy DiscordMap columns:', error.message);
    }

    return true;
  } catch (error) {
    console.warn('⚠️ Failed to ensure DiscordMap headers:', error.message);
    return false;
  }
}

function normalizeHeader(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_]/g, '');
}

function findHeaderIndex(headers, candidates) {
  const normalized = headers.map(h => normalizeHeader(h));
  const want = candidates.map(c => normalizeHeader(c));
  for (let i = 0; i < normalized.length; i++) {
    if (want.includes(normalized[i])) {
      return i;
    }
  }
  return -1;
}

async function buildMasterCsvNameMap() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  const sheetName = config.googleSheets.masterCsvSheetName || 'Master_CSV';
  const range = `${sheetName}!A:Z`;

  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.sheetId,
    range,
  });

  const rows = response.data.values || [];
  if (!rows.length) {
    return new Map();
  }

  const headers = rows[0] || [];
  const ingameIdIdx = findHeaderIndex(headers, [
    'Ingame-ID',
    'IngameID',
    'Ingame_ID',
    'Player_ID',
    'PlayerID',
    'ID',
  ]);

  const nameIdx = findHeaderIndex(headers, [
    'Name',
    'Player',
    'PlayerName',
    'Username',
  ]);

  if (ingameIdIdx === -1 || nameIdx === -1) {
    return new Map();
  }

  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const ingameId = row[ingameIdIdx] ? String(row[ingameIdIdx]).trim() : '';
    const name = row[nameIdx] ? String(row[nameIdx]).trim() : '';
    if (ingameId) {
      map.set(ingameId, name);
    }
  }

  return map;
}

export async function syncDiscordMapNamesFromMasterCsv() {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  await ensureDiscordMapHeaders();

  const nameMap = await buildMasterCsvNameMap();
  if (!nameMap.size) {
    return { updated: 0, skipped: 0 };
  }

  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.sheetId,
    range: 'DiscordMap!A:D',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return { updated: 0, skipped: 0 };
  }

  const data = [];
  let updated = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const ingameId = row[0] ? String(row[0]).trim() : '';
    const currentName = row[3] ? String(row[3]).trim() : '';
    if (!ingameId) {
      skipped++;
      continue;
    }
    if (currentName) {
      skipped++;
      continue;
    }
    const masterName = nameMap.get(ingameId);
    if (!masterName) {
      skipped++;
      continue;
    }
    updated++;
    data.push({ range: `DiscordMap!D${i + 1}`, values: [[masterName]] });
  }

  if (data.length) {
    await sheetsClientWithAuth.spreadsheets.values.batchUpdate({
      spreadsheetId: config.googleSheets.sheetId,
      resource: {
        valueInputOption: 'RAW',
        data,
      },
    });
  }

  return { updated, skipped };
}

function columnIndexToLetter(index) {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

async function getSheetPropertiesByTitle(sheetTitle) {
  const client = sheetsClientWithAuth || sheetsClient;
  if (!client) {
    throw new Error('Sheets client not initialized');
  }

  const meta = await client.spreadsheets.get({
    spreadsheetId: config.googleSheets.sheetId,
  });

  const sheets = meta.data.sheets || [];
  const sheet = sheets.find(s => s.properties && s.properties.title === sheetTitle);
  if (!sheet || !sheet.properties) {
    throw new Error(`Sheet not found: ${sheetTitle}`);
  }

  return sheet.properties;
}

export async function updateBotState(partialState) {
  const current = (await loadBotState()) || {};

  const mergedMasterSync = {
    ...(current.masterSync || {}),
    ...((partialState && partialState.masterSync) || {}),
  };

  const merged = {
    ...current,
    ...(partialState || {}),
    masterSync: mergedMasterSync,
  };

  await saveBotState(merged);
  return merged;
}

export async function syncMasterCsvToFinal(options = {}) {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  const sourceSheetName = options.sourceSheetName || config.googleSheets.masterCsvSheetName || 'Master_CSV';
  const targetSheetName = options.targetSheetName || config.googleSheets.masterFinalSheetName || 'Master_Final';

  const sourceProps = await getSheetPropertiesByTitle(sourceSheetName);
  const targetProps = await getSheetPropertiesByTitle(targetSheetName);

  const headerRes = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.sheetId,
    range: `${sourceSheetName}!1:1`,
  });
  const headerRow = (headerRes.data.values && headerRes.data.values[0]) ? headerRes.data.values[0] : [];
  const columnCount = headerRow.length;

  if (!columnCount) {
    return { copiedRows: 0, lastCopiedRow: options.lastCopiedRow || 1 };
  }

  const endCol = columnIndexToLetter(Math.max(0, columnCount - 1));
  const sourceDataRange = `${sourceSheetName}!A1:${endCol}`;
  const sourceDataRes = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.sheetId,
    range: sourceDataRange,
  });
  const sourceRows = sourceDataRes.data.values ? sourceDataRes.data.values.length : 0;
  const lastSourceRow = Math.max(0, sourceRows);

  const abortIfSourceEmpty = options.abortIfSourceEmpty !== false;
  if (abortIfSourceEmpty && lastSourceRow <= 1) {
    return {
      copiedRows: 0,
      lastCopiedRow: options.fullSync ? 0 : (options.lastCopiedRow || 0),
      frozeExistingTarget: false,
      aborted: true,
      abortReason: 'Source sheet has no data rows',
      sourceRows: lastSourceRow,
    };
  }

  const targetColRange = `${targetSheetName}!A:A`;
  const targetColRes = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.sheetId,
    range: targetColRange,
  });
  const targetRowsInA = targetColRes.data.values ? targetColRes.data.values.length : 0;

  let frozeExistingTarget = false;
  if (options.freezeExistingTarget && targetRowsInA > 0) {
    const endCol = columnIndexToLetter(Math.max(0, columnCount - 1));
    const freezeRange = `${targetSheetName}!A1:${endCol}${targetRowsInA}`;

    const freezeRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: freezeRange,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = freezeRes.data.values || [];
    if (values.length > 0) {
      await sheetsClientWithAuth.spreadsheets.values.update({
        spreadsheetId: config.googleSheets.sheetId,
        range: freezeRange,
        valueInputOption: 'RAW',
        resource: { values },
      });
      frozeExistingTarget = true;
    }
  }

  const inferredLastCopiedRow = Math.max(0, targetRowsInA);
  const lastCopiedRow = options.fullSync
    ? 0
    : Math.max(0, Number(options.lastCopiedRow ?? inferredLastCopiedRow) || 0);

  const startRow = lastCopiedRow + 1;
  if (startRow > lastSourceRow) {
    return { copiedRows: 0, lastCopiedRow, frozeExistingTarget };
  }

  const neededRowCount = lastSourceRow;
  const neededColCount = columnCount;

  const targetRowCount = targetProps.gridProperties && targetProps.gridProperties.rowCount ? targetProps.gridProperties.rowCount : 0;
  const targetColCount = targetProps.gridProperties && targetProps.gridProperties.columnCount ? targetProps.gridProperties.columnCount : 0;

  const requests = [];

  if (targetRowCount < neededRowCount || targetColCount < neededColCount) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: targetProps.sheetId,
          gridProperties: {
            rowCount: Math.max(targetRowCount, neededRowCount),
            columnCount: Math.max(targetColCount, neededColCount),
          },
        },
        fields: 'gridProperties(rowCount,columnCount)',
      },
    });
  }

  requests.push({
    copyPaste: {
      source: {
        sheetId: sourceProps.sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: lastSourceRow,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      destination: {
        sheetId: targetProps.sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: lastSourceRow,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      pasteType: 'PASTE_FORMAT',
      pasteOrientation: 'NORMAL',
    },
  });

  requests.push({
    copyPaste: {
      source: {
        sheetId: sourceProps.sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: lastSourceRow,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      destination: {
        sheetId: targetProps.sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: lastSourceRow,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      pasteType: 'PASTE_VALUES',
      pasteOrientation: 'NORMAL',
    },
  });

  await sheetsClientWithAuth.spreadsheets.batchUpdate({
    spreadsheetId: config.googleSheets.sheetId,
    resource: { requests },
  });

  const copiedRows = lastSourceRow - startRow + 1;
  return { copiedRows, lastCopiedRow: lastSourceRow, frozeExistingTarget };
}

/**
 * Initialize Google Sheets API client using API Key
 * Supports both environment variable (Railway) and file path (local)
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
        credentials = safeJsonParse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'GOOGLE_SERVICE_ACCOUNT_JSON');
        console.log('✅ Service Account loaded from environment variable');
      } catch (parseError) {
        console.error('❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', parseError.message);
      }
    }
    
    // Method 2: Try to read from file (for local development)
    if (!credentials && config.googleSheets.serviceAccountPath && fs.existsSync(config.googleSheets.serviceAccountPath)) {
      try {
        const raw = fs.readFileSync(config.googleSheets.serviceAccountPath, 'utf8');
        credentials = safeJsonParse(raw, `service account file (${config.googleSheets.serviceAccountPath})`);
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
export async function fetchPlayersData(options = {}) {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: options.range || config.googleSheets.range,
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
 * @returns {Promise<Map<string, object>>} Map of Player_ID -> {discordName, action, discordId}
 */
export async function fetchDiscordMapping() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:D', // Read up to column D for Discord-ID
    });

    const rows = response.data.values;
    const mapping = new Map();

    if (!rows || rows.length === 0) {
      console.log('⚠️ No Discord mapping found');
      return mapping;
    }

    // Skip header row, map Player_ID (column A) to {discordName (column B), action (column C), discordId (column D)}
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0]) { // At least Player_ID must exist
        const playerId = String(row[0]).trim();
        const discordId = row[1] ? String(row[1]).trim() : '';
        const action = row[2] ? String(row[2]).trim() : '';
        const name = row[3] ? String(row[3]).trim() : '';
        mapping.set(playerId, { discordId, action, name });
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
export async function fetchPlayersDataWithDiscordNames(options = {}) {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    // Fetch players data
    const players = await fetchPlayersData(options);
    
    // Fetch Discord mapping
    const discordMapping = await fetchDiscordMapping();

    // Replace names with Discord names based on Ingame-ID (player name)
    let playersWithDiscordId = 0;
    let playersWithMention = 0;
    players.forEach((player, index) => {
      // Get player's Ingame-ID - try different possible column names
      const ingameId = player['Ingame-ID'] || player['IngameID'] || player['Ingame_ID'] || player['INGAME-ID'] || 
                       player['Player_ID'] || player['PlayerID'] || player['ID'] || player['player_id'] ||
                       player['Name'] || player['Player'] || player['USERNAME'];
      
      if (ingameId && discordMapping.has(String(ingameId).trim())) {
        const mappingData = discordMapping.get(String(ingameId).trim());
        let discordId = mappingData.discordId;
        let discordName = '';
        const action = mappingData.action;
        
        if (discordId && /^\d{17,20}$/.test(String(discordId).trim())) {
          discordId = String(discordId).trim();
          discordName = `<@${discordId}>`;
          playersWithDiscordId++;
          playersWithMention++;
        } else if (discordId && String(discordId).startsWith('<@') && String(discordId).endsWith('>')) {
          const match = String(discordId).match(/<@!?(\d+)>/);
          if (match) {
            discordId = match[1];
            discordName = `<@${discordId}>`;
            playersWithDiscordId++;
            playersWithMention++;
          }
        }
        
        player.DiscordName = discordName; // This will be the mention for messages
        player['Discord-ID'] = discordId; // Add Discord ID as a separate field
        player.Action = action; // Add Action from DiscordMap
        player.OriginalName = player.Name || player.Player || player.USERNAME;
        // Keep DisplayName as original name (not mention) for dropdowns/lists
        player.DisplayName = player.OriginalName;
        
        // Debug: Log first 3 players
        if (index < 3) {
          console.log(`📋 Player ${index + 1}: IngameId="${ingameId}", DiscordName="${discordName}", Discord-ID="${discordId || 'N/A'}", Action="${action}"`);
        }
      } else {
        // Keep original name if no mapping found
        player.DisplayName = player.Name || player.Player || player.USERNAME || 'Unknown';
      }
    });

    console.log(`✅ Processed ${players.length} players with Discord names (${playersWithMention} with mentions, ${playersWithDiscordId} with Discord IDs)`);
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
    await ensureDiscordMapHeaders();

    const masterNameMap = await buildMasterCsvNameMap();
    const masterName = masterNameMap.get(String(ingameId).trim()) || '';

    // Get all current data from DiscordMap sheet
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'DiscordMap!A:D',
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    const ingameKey = String(ingameId).trim();
    const discordKey = String(discordId).trim();
    let existingAction = '';

    // Update existing row if either Ingame-ID (col A) or Discord-ID (col B) already exists
    for (let i = 1; i < rows.length; i++) {
      const rowIngame = rows[i][0] ? String(rows[i][0]).trim() : '';
      const rowDiscord = rows[i][1] ? String(rows[i][1]).trim() : '';
      if ((rowIngame && rowIngame === ingameKey) || (rowDiscord && rowDiscord === discordKey)) {
        rowIndex = i + 1; // +1 because sheets are 1-indexed
        existingAction = rows[i][2] ? String(rows[i][2]).trim() : '';
        break;
      }
    }

    // Prepare the data to write: A=Ingame-ID, B=Discord-ID, C=Action, D=Username
    // Preserve existing Action (column C) if present
    const values = [[ingameId, discordId, existingAction, masterName]];

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
        range: 'DiscordMap!A:B',
      });

      const rows = response.data.values || [];
      
      // Find the row with matching Discord_ID (column B)
      for (let i = 1; i < rows.length; i++) {
        const rowDiscordId = rows[i][1]; // Column B
        if (rowDiscordId && String(rowDiscordId).trim() === discordId) {
          const ingameId = rows[i][0];
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

async function ensureBotStateSheetExists() {
  if (!sheetsClientWithAuth) {
    return false;
  }

  try {
    const meta = await sheetsClientWithAuth.spreadsheets.get({
      spreadsheetId: config.googleSheets.sheetId,
    });

    const sheets = meta.data.sheets || [];
    const exists = sheets.some(s => s.properties && s.properties.title === 'BotState');
    if (exists) {
      return true;
    }

    await sheetsClientWithAuth.spreadsheets.batchUpdate({
      spreadsheetId: config.googleSheets.sheetId,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: 'BotState',
              },
            },
          },
        ],
      },
    });

    return true;
  } catch (error) {
    console.warn('⚠️ Failed to ensure BotState sheet exists:', error.message);
    return false;
  }
}

export async function saveBotState(state) {
  if (!sheetsClientWithAuth) {
    throw new Error('Write access not available. Please configure Service Account credentials in .env file (GOOGLE_SERVICE_ACCOUNT_PATH)');
  }

  const ok = await ensureBotStateSheetExists();
  if (!ok) {
    throw new Error('Failed to create/find BotState sheet');
  }

  const values = [
    ['key', 'value'],
    ['state', state ? JSON.stringify(state) : ''],
  ];

  await sheetsClientWithAuth.spreadsheets.values.update({
    spreadsheetId: config.googleSheets.sheetId,
    range: 'BotState!A1:B2',
    valueInputOption: 'RAW',
    resource: { values },
  });

  return true;
}

export async function loadBotState() {
  if (!sheetsClient) {
    throw new Error('Sheets client not initialized');
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.sheetId,
      range: 'BotState!A:B',
    });

    const rows = response.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const key = rows[i][0] ? String(rows[i][0]).trim() : '';
      const value = rows[i][1] ? String(rows[i][1]).trim() : '';
      if (key === 'state' && value) {
        return JSON.parse(value);
      }
    }

    return null;
  } catch (error) {
    if (String(error.message || '').includes('Unable to parse range')) {
      // Sheet/tab likely doesn't exist yet
      try {
        await ensureBotStateSheetExists();
      } catch {
        // ignore
      }
      return null;
    }

    console.warn('ℹ️ No BotState found in Google Sheets:', error.message);
    return null;
  }
}

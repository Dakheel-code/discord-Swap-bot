import { config } from './config.js';

/**
 * Player distribution manager
 */
export class DistributionManager {
  constructor() {
    this.groups = {
      RGR: [],
      OTL: [],
      RND: [],
      WILDCARDS: [], // Excluded and manually moved players
    };
    this.excludedPlayers = new Set();
    this.manualAssignments = new Map(); // player -> group
    this.manualMoveCount = { RGR: 0, OTL: 0, RND: 0 }; // Count of manually moved players
    this.wildcardInfo = new Map(); // player identifier -> {type: 'excluded'|'manual', target: 'clan'|'group'}
    this.sortColumn = null;
    this.allPlayers = [];
    this.completedPlayers = new Set(); // Players marked as done (moved)
  }

  /**
   * Distribute players into groups based on a column
   * @param {Array<Object>} players - Array of player objects
   * @param {string} columnName - Column to sort by
   * @param {string} seasonNumber - Optional season number to override config
   */
  distribute(players, columnName, seasonNumber = null) {
    this.allPlayers = players;
    this.sortColumn = columnName;
    this.customSeasonNumber = seasonNumber;

    // Reset groups and WILDCARDS
    this.groups = {
      RGR: [],
      OTL: [],
      RND: [],
      WILDCARDS: [],
    };
    
    // Clear previous wildcard info
    this.wildcardInfo.clear();
    
    console.log(`🔍 distribute: Processing ${players.length} players`);
    
    // Sort ALL players by trophies first
    const sortedPlayers = [...players].sort((a, b) => {
      const valueA = this.parseValue(a[columnName]);
      const valueB = this.parseValue(b[columnName]);
      return valueB - valueA; // Descending order
    });
    
    // Count Hold players per clan first
    const holdCountPerClan = { RGR: 0, OTL: 0, RND: 0 };
    
    sortedPlayers.forEach(player => {
      const action = player.Action ? player.Action.trim() : '';
      const currentClan = this.getPlayerClan(player);
      
      if (action === 'Hold' && holdCountPerClan[currentClan] !== undefined) {
        holdCountPerClan[currentClan]++;
      }
    });
    
    console.log(`📊 Hold count per clan:`, holdCountPerClan);
    
    // Initialize counters with Hold count
    let rgrCount = holdCountPerClan.RGR;
    let otlCount = holdCountPerClan.OTL;
    let rndCount = holdCountPerClan.RND;
    
    // Process all players
    const playersWithAction = [];
    
    sortedPlayers.forEach((player, index) => {
      const action = player.Action ? player.Action.trim() : '';
      const identifier = this.getPlayerIdentifier(player);
      const currentClan = this.getPlayerClan(player);
      
      if (action === 'Hold') {
        // Hold - stays in current clan, occupies a slot
        playersWithAction.push(player);
        this.wildcardInfo.set(identifier, {
          type: 'excluded',
          target: currentClan || 'Unknown'
        });
        this.excludedPlayers.add(identifier);
        
      } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
        // Manual move - add to WILDCARDS
        playersWithAction.push(player);
        
        if (currentClan === action) {
          this.wildcardInfo.set(identifier, {
            type: 'stay',
            target: action
          });
        } else {
          this.wildcardInfo.set(identifier, {
            type: 'manual',
            target: action
          });
        }
        
      } else {
        // Automatic distribution
        let targetClan = null;
        
        if (rgrCount < 50) {
          targetClan = 'RGR';
          rgrCount++;
        } else if (otlCount < 50) {
          targetClan = 'OTL';
          otlCount++;
        } else {
          targetClan = 'RND';
          rndCount++;
        }
        
        // Only add to group if player needs to move
        if (currentClan !== targetClan) {
          this.groups[targetClan].push(player);
        }
      }
    });
    
    // Set WILDCARDS
    this.groups.WILDCARDS = playersWithAction;
    
    console.log(`📊 Final distribution:`);
    console.log(`  - RGR: ${this.groups.RGR.length} moving (${rgrCount} total)`);
    console.log(`  - OTL: ${this.groups.OTL.length} moving (${otlCount} total)`);
    console.log(`  - RND: ${this.groups.RND.length} moving (${rndCount} total)`);
    console.log(`  - WILDCARDS: ${this.groups.WILDCARDS.length}`);

    return this.groups;
  }

  /**
   * Get player's clan from player object
   * @param {Object} player - Player object
   * @returns {string|null} Player's clan or null
   */
  getPlayerClan(player) {
    // Try common clan column names
    const clanColumns = ['Clan', 'clan', 'Team', 'team', 'Guild', 'guild', 'CLAN', 'TEAM'];
    
    for (const col of clanColumns) {
      if (player[col]) {
        return String(player[col]).trim();
      }
    }

    return null;
  }

  /**
   * Move a player to a specific group (adds to WILDCARDS)
   * @param {string} playerName - Name of the player
   * @param {string} targetGroup - Target group (RGR, OTL, or RND)
   */
  movePlayer(playerName, targetGroup) {
    if (!config.groups.names.includes(targetGroup)) {
      throw new Error(`Invalid group: ${targetGroup}. Must be one of: ${config.groups.names.join(', ')}`);
    }

    // Find the player
    const player = this.findPlayer(playerName);
    if (!player) {
      throw new Error(`Player not found: ${playerName}`);
    }

    const identifier = this.getPlayerIdentifier(player);

    // Remove from all main groups
    for (const groupName of config.groups.names) {
      this.groups[groupName] = this.groups[groupName].filter(
        p => this.getPlayerIdentifier(p) !== identifier
      );
    }

    // Add to WILDCARDS with manual move info
    const alreadyInWildcards = this.groups.WILDCARDS.some(
      p => this.getPlayerIdentifier(p) === identifier
    );
    if (!alreadyInWildcards) {
      this.groups.WILDCARDS.push(player);
    }
    
    // Store manual move info
    this.wildcardInfo.set(identifier, {
      type: 'manual',
      target: targetGroup
    });

    this.manualAssignments.set(identifier, targetGroup);

    return true;
  }

  /**
   * Exclude a player from distribution (move to WILDCARDS)
   * @param {string} playerName - Name of the player
   */
  excludePlayer(playerName) {
    const player = this.findPlayer(playerName);
    if (!player) {
      throw new Error(`Player not found: ${playerName}`);
    }

    const identifier = this.getPlayerIdentifier(player);
    this.excludedPlayers.add(identifier);

    // Remove from all main groups
    for (const groupName of config.groups.names) {
      this.groups[groupName] = this.groups[groupName].filter(
        p => this.getPlayerIdentifier(p) !== identifier
      );
    }

    // Add to WILDCARDS if not already there
    const alreadyInWildcards = this.groups.WILDCARDS.some(
      p => this.getPlayerIdentifier(p) === identifier
    );
    if (!alreadyInWildcards) {
      this.groups.WILDCARDS.push(player);
    }

    // Store excluded info with current clan
    const playerClan = this.getPlayerClan(player) || 'Unknown';
    this.wildcardInfo.set(identifier, {
      type: 'excluded',
      target: playerClan
    });

    return true;
  }

  /**
   * Include a previously excluded player (remove from WILDCARDS)
   * @param {string} playerName - Name of the player
   */
  includePlayer(playerName) {
    const player = this.findPlayer(playerName);
    if (!player) {
      throw new Error(`Player not found: ${playerName}`);
    }

    const identifier = this.getPlayerIdentifier(player);
    this.excludedPlayers.delete(identifier);

    // Remove from WILDCARDS
    this.groups.WILDCARDS = this.groups.WILDCARDS.filter(
      p => this.getPlayerIdentifier(p) !== identifier
    );

    // Remove wildcard info
    this.wildcardInfo.delete(identifier);

    return true;
  }

  /**
   * Find a player by name or Discord ID (case-insensitive)
   * @param {string} playerName - Name or Discord ID to search for
   * @returns {Object|null} Player object or null
   */
  findPlayer(playerName) {
    let searchTerm = String(playerName).trim();
    
    console.log(`🔍 findPlayer: Searching for "${playerName}"`);
    console.log(`📊 Total players in allPlayers: ${this.allPlayers.length}`);
    console.log(`📊 Total players in WILDCARDS: ${this.groups.WILDCARDS ? this.groups.WILDCARDS.length : 0}`);
    
    // Debug: Show first 3 players in WILDCARDS
    if (this.groups.WILDCARDS && this.groups.WILDCARDS.length > 0) {
      console.log(`📋 First 3 WILDCARDS players:`);
      for (let i = 0; i < Math.min(3, this.groups.WILDCARDS.length); i++) {
        const p = this.groups.WILDCARDS[i];
        console.log(`  ${i + 1}. Name: "${this.getPlayerName(p)}", DiscordName: "${p.DiscordName || 'N/A'}", Discord-ID: "${p['Discord-ID'] || 'N/A'}"`);
      }
    }
    
    // Extract Discord ID from mention if provided (<@123456> or <@!123456>)
    let discordId = null;
    const mentionMatch = searchTerm.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      discordId = mentionMatch[1]; // Extract Discord ID
      console.log(`✅ Extracted Discord ID from mention: ${discordId}`);
    }
    
    const searchTermLower = searchTerm.toLowerCase();
    
    // Search in all players
    console.log(`🔍 Searching in allPlayers...`);
    console.log(`🔍 Looking for: "${searchTerm}"`);
    
    // Debug: Show first 5 players' DiscordNames
    for (let i = 0; i < Math.min(5, this.allPlayers.length); i++) {
      const p = this.allPlayers[i];
      console.log(`  📋 Player ${i + 1}: DiscordName="${p.DiscordName || 'N/A'}"`);
    }
    
    for (const player of this.allPlayers) {
      // Check by DiscordName (exact match for mentions)
      if (player.DiscordName && player.DiscordName.trim() === searchTerm) {
        console.log(`✅ Found player in allPlayers by DiscordName exact match: ${this.getPlayerName(player)}`);
        return player;
      }
      
      // Check by name
      const playerNameValue = this.getPlayerName(player).toLowerCase().trim();
      if (playerNameValue === searchTermLower || playerNameValue.includes(searchTermLower)) {
        console.log(`✅ Found player in allPlayers by name: ${this.getPlayerName(player)}`);
        return player;
      }
      
      // If we have a Discord ID to search for
      if (discordId) {
        // Check if player has a direct Discord ID field
        if (player['Discord-ID'] || player['Discord_ID'] || player.DiscordID) {
          const playerDiscordId = String(player['Discord-ID'] || player['Discord_ID'] || player.DiscordID).trim();
          if (playerDiscordId === discordId) {
            console.log(`✅ Found player in allPlayers by Discord-ID: ${this.getPlayerName(player)}`);
            return player;
          }
        }
      }
    }
    
    console.log(`⚠️ Player not found in allPlayers, searching in groups...`);

    // Search in all groups (RGR, OTL, RND, WILDCARDS)
    const allGroups = ['RGR', 'OTL', 'RND', 'WILDCARDS'];
    for (const groupName of allGroups) {
      if (this.groups[groupName] && this.groups[groupName].length > 0) {
        console.log(`🔍 Searching in ${groupName} (${this.groups[groupName].length} players)...`);
        
        // Debug: Show first player in this group
        const firstPlayer = this.groups[groupName][0];
        console.log(`  📋 First player in ${groupName}: Name="${this.getPlayerName(firstPlayer)}", DiscordName="${firstPlayer.DiscordName || 'N/A'}", Discord-ID="${firstPlayer['Discord-ID'] || 'N/A'}"`);
        
        for (const player of this.groups[groupName]) {
          // Check by DiscordName (exact match for mentions)
          if (player.DiscordName && player.DiscordName.trim() === searchTerm) {
            console.log(`✅ Found player in ${groupName} by DiscordName exact match: ${this.getPlayerName(player)}`);
            return player;
          }
          
          // Check by name
          const playerNameValue = this.getPlayerName(player).toLowerCase().trim();
          if (playerNameValue === searchTermLower || playerNameValue.includes(searchTermLower)) {
            console.log(`✅ Found player in ${groupName} by name: ${this.getPlayerName(player)}`);
            return player;
          }
          
          // If we have a Discord ID to search for
          if (discordId) {
            // Check if player has a direct Discord ID field
            if (player['Discord-ID'] || player['Discord_ID'] || player.DiscordID) {
              const playerDiscordId = String(player['Discord-ID'] || player['Discord_ID'] || player.DiscordID).trim();
              if (playerDiscordId === discordId) {
                console.log(`✅ Found player in ${groupName} by Discord-ID: ${this.getPlayerName(player)}`);
                return player;
              }
            }
          }
        }
      }
    }

    console.log(`❌ Player not found anywhere: "${playerName}"`);
    return null;
  }

  /**
   * Mark player as done (moved)
   * @param {string} playerName - Name of the player or mention
   */
  markPlayerAsDone(playerName) {
    // Try to find the player
    const player = this.findPlayer(playerName);
    
    if (player) {
      // Found player - use their identifier
      const identifier = this.getPlayerIdentifier(player);
      this.completedPlayers.add(identifier);
      console.log(`✅ Marked player as done using identifier: ${identifier}`);
    } else {
      // Player not found - use the mention/name directly
      this.completedPlayers.add(playerName);
      console.log(`✅ Marked as done using direct mention: ${playerName}`);
    }
    
    return true;
  }

  /**
   * Unmark player as done (remove checkmark)
   * @param {string} playerName - Name of the player or mention
   */
  unmarkPlayerAsDone(playerName) {
    // Try to find the player
    const player = this.findPlayer(playerName);
    
    if (player) {
      // Found player - use their identifier
      const identifier = this.getPlayerIdentifier(player);
      this.completedPlayers.delete(identifier);
      console.log(`✅ Unmarked player using identifier: ${identifier}`);
    } else {
      // Player not found - use the mention/name directly
      this.completedPlayers.delete(playerName);
      console.log(`✅ Unmarked using direct mention: ${playerName}`);
    }
    
    return true;
  }

  /**
   * Get player identifier (first column or name)
   * @param {Object} player - Player object
   * @returns {string} Player identifier
   */
  getPlayerIdentifier(player) {
    return this.getPlayerName(player);
  }

  /**
   * Get player name from player object
   * @param {Object} player - Player object
   * @returns {string} Player name
   */
  getPlayerName(player) {
    // First priority: Use DisplayName if available (Discord name)
    if (player.DisplayName) {
      return String(player.DisplayName).trim();
    }

    // Second priority: Use DiscordName if available
    if (player.DiscordName) {
      return String(player.DiscordName).trim();
    }

    // Fallback: Try common name columns
    const nameColumns = ['Name', 'name', 'Player', 'player', 'USERNAME', 'username'];
    
    for (const col of nameColumns) {
      if (player[col]) {
        return String(player[col]).trim();
      }
    }

    // Return first non-empty value
    const firstValue = Object.values(player).find(v => v && String(v).trim());
    return firstValue ? String(firstValue).trim() : 'Unknown';
  }

  /**
   * Parse value to number
   * @param {any} value - Value to parse
   * @returns {number} Parsed number
   */
  parseValue(value) {
    if (value === null || value === undefined || value === '') {
      return 0;
    }

    const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? 0 : num;
  }

  /**
   * Get current distribution summary
   * @returns {Object} Distribution summary
   */
  getSummary() {
    return {
      groups: {
        RGR: this.groups.RGR.length,
        OTL: this.groups.OTL.length,
        RND: this.groups.RND.length,
      },
      total: this.groups.RGR.length + this.groups.OTL.length + this.groups.RND.length,
      excluded: this.groups.WILDCARDS ? this.groups.WILDCARDS.length : 0,
      sortColumn: this.sortColumn,
    };
  }

  /**
   * Get formatted distribution for display
   * @returns {Array<string>} Array of formatted text messages (one per clan + wildcards + footer)
   */
  getFormattedDistribution() {
    // Generate formatted distribution messages (3 messages: Title+RGR, OTL, RND+footer)
    // Use custom season number if provided, otherwise use config
    const seasonNum = parseInt(this.customSeasonNumber || config.seasonNumber) || 156;
    const escapeMd = (value) => {
      if (value === null || value === undefined) return '';
      return String(value).replace(/[\\`*_~|]/g, '\\$&');
    };
    
    const messages = [];
    
    // Build all clan sections first
    const clanSections = {};
    
    for (const groupName of config.groups.names) {
      const players = this.groups[groupName];
      const playerCount = players.length;
      
      let clanOutput = '';
      
      // Show player count only if > 0
      const countText = playerCount > 0 ? ` (${playerCount})` : '';
      
      // For RGR, include title on separate line above
      if (groupName === 'RGR') {
        clanOutput += `<:RGR:1238937013940523008> **SWAP LIST SEASON ${seasonNum}** <:RGR:1238937013940523008>\n\n**to ${groupName}${countText}:**\n\n`;
      } else {
        clanOutput += `**to ${groupName}${countText}:**\n\n`;
      }
      
      if (players.length === 0) {
        clanOutput += '_No players_\n';
      } else {
        players.forEach((player, index) => {
          // Get Discord mention and original name
          const discordMention = player.DiscordName || '';
          const originalName = escapeMd(player.OriginalName || player.Name || player.Player || player.USERNAME || '');
          
          const identifier = this.getPlayerIdentifier(player);
          
          // Check if marked as done by identifier OR by DiscordName mention OR by Discord-ID
          let isDone = this.completedPlayers.has(identifier);
          
          // Also check by DiscordName (exact match)
          if (!isDone && player.DiscordName) {
            isDone = this.completedPlayers.has(player.DiscordName);
          }
          
          // Also check by Discord-ID (extract from mention and compare)
          if (!isDone && player['Discord-ID']) {
            // Check if any completed player mention contains this Discord-ID
            for (const completed of this.completedPlayers) {
              if (completed.includes(player['Discord-ID'])) {
                isDone = true;
                break;
              }
            }
          }
          
          // Try to get trophies value from different possible column names
          let value = '';
          if (this.sortColumn) {
            value = player[this.sortColumn] || '';
          }
          // Fallback: try common trophy column names
          if (!value) {
            value = player['Trophies'] || player['trophies'] || player['TROPHIES'] || 
                    player['Trophy'] || player['trophy'] || player['Cups'] || player['cups'] ||
                    player['Score'] || player['score'] || '';
          }
          
          // Get player name from Name column (column B)
          const playerName = escapeMd(player['Name'] || player['name'] || player['Player'] || '');
          
          // Format: - <@mention> name trophies
          let line = `- `;
          
          if (discordMention) {
            line += discordMention;
            // Add player name after mention if available
            if (playerName) {
              line += ` ${playerName}`;
            }
          } else {
            const displayName = originalName || escapeMd(this.getPlayerName(player));
            line += displayName;
          }
          
          if (value) {
            line += ` ${value}`;
          }
          if (isDone) {
            line += ' ✅';
          }
          clanOutput += line + '\n';
        });
      }
      
      clanSections[groupName] = clanOutput;
    }

    // Message 1: Title + RGR
    if (clanSections['RGR']) {
      messages.push(clanSections['RGR']);
    }
    
    // Message 2: OTL
    if (clanSections['OTL']) {
      messages.push(clanSections['OTL']);
    }
    
    // Message 3: RND + WILDCARDS + footer
    let message3 = '';
    if (clanSections['RND']) {
      message3 += clanSections['RND'];
    }
    
    // Add WILDCARDS to message 3
    if (this.groups.WILDCARDS && this.groups.WILDCARDS.length > 0) {
      message3 += `\n**WILDCARDS (${this.groups.WILDCARDS.length}):**\n`;
      this.groups.WILDCARDS.forEach((player, index) => {
        // Get Discord mention and original name
        const discordMention = player.DiscordName || '';
        const originalName = escapeMd(player.OriginalName || player.Name || player.Player || player.USERNAME || '');
        
        const identifier = this.getPlayerIdentifier(player);
        
        // Check if marked as done by identifier OR by DiscordName mention OR by Discord-ID
        let isDone = this.completedPlayers.has(identifier);
        
        // Also check by DiscordName (exact match)
        if (!isDone && player.DiscordName) {
          isDone = this.completedPlayers.has(player.DiscordName);
        }
        
        // Also check by Discord-ID (extract from mention and compare)
        if (!isDone && player['Discord-ID']) {
          // Check if any completed player mention contains this Discord-ID
          for (const completed of this.completedPlayers) {
            if (completed.includes(player['Discord-ID'])) {
              isDone = true;
              break;
            }
          }
        }
        
        const info = this.wildcardInfo.get(identifier);
        
        // Get player name from Name column (column B)
        const playerName = escapeMd(player['Name'] || player['name'] || player['Player'] || '');
        
        // Build line: - @mention name stays/moves
        let line = '- ';
        if (discordMention) {
          line += discordMention;
          // Add player name after mention if available
          if (playerName) {
            line += ` ${playerName}`;
          }
        } else {
          const displayName = originalName || escapeMd(this.getPlayerName(player));
          line += displayName;
        }
        
        if (info) {
          if (info.type === 'excluded' || info.type === 'stay') {
            line += ` stays in ${info.target}`;
          } else if (info.type === 'manual') {
            line += ` moves to ${info.target}`;
          }
        }
        
        if (isDone) {
          line += ' ✅';
        }
        message3 += line + '\n';
      });
    }
    
    // Add footer to message 3
    message3 += '\nStop: ❌  Hold: ✋  Done: ✅\n\n';
    message3 += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
    message3 += 'AND DON\'T FORGET TO HIT MANTICORE BEFORE YOU MOVE!\n\n';
    message3 += '❗**18-HOUR-RULE**❗\n';
    message3 += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__';
    
    messages.push(message3);

    return messages;
  }

  /**
   * Get formatted list of players for Swaps Left
   * @param {boolean} hideCompleted - If true, hide players who are already done (for new messages)
   * @param {Array} specificPlayers - If provided, only show these players (for updates)
   * @returns {object} { text: string, players: Array } - Formatted text and list of players shown
   */
  getSwapsLeft(hideCompleted = true, specificPlayers = null) {
    let output = '**SWAPS LEFT**\n\n';

    const getSwapsDisplayName = (player) => {
      if (!player) return 'Unknown';

      const preferredColumns = [
        'OriginalName',
        'Name',
        'name',
        'Player',
        'player',
        'USERNAME',
        'username'
      ];

      for (const col of preferredColumns) {
        if (player[col]) {
          const v = String(player[col]).trim();
          if (v) return v;
        }
      }

      if (player.DisplayName) {
        const v = String(player.DisplayName).trim();
        if (v) return v;
      }

      if (player.DiscordName) {
        const v = String(player.DiscordName).trim();
        if (v) return v;
      }

      const firstValue = Object.values(player).find(v => v && String(v).trim());
      return firstValue ? String(firstValue).trim() : 'Unknown';
    };
    
    // If specificPlayers is provided, use that list for updates
    if (specificPlayers && specificPlayers.length > 0) {
      let doneCount = 0;
      const totalCount = specificPlayers.length;
      
      // Update isDone status for each player
      specificPlayers.forEach(player => {
        const identifier = player.identifier || player.name;
        let isDone = this.completedPlayers.has(identifier);
        
        // Check by mention
        if (!isDone && player.mention) {
          isDone = this.completedPlayers.has(player.mention);
        }
        
        // Check by Discord-ID in mention
        if (!isDone && player.mention) {
          const match = player.mention.match(/<@!?(\d+)>/);
          if (match) {
            for (const completed of this.completedPlayers) {
              if (completed.includes(match[1])) {
                isDone = true;
                break;
              }
            }
          }
        }
        
        player.isDone = isDone;
        if (isDone) doneCount++;

        if (!player.name || player.name === 'Unknown') {
          let resolved = null;
          if (player.mention) {
            resolved = this.findPlayer(player.mention);
          }
          if (!resolved && player.discordId) {
            resolved = this.findPlayer(`<@${player.discordId}>`);
          }
          if (resolved) {
            player.name = getSwapsDisplayName(resolved);
            player.identifier = this.getPlayerIdentifier(resolved);
          }
        }
      });
      
      const remainingCount = totalCount - doneCount;
      output += `Total players remaining: **${remainingCount}** / ${totalCount}\n\n`;
      
      specificPlayers.forEach(player => {
        const playerDisplay = player.mention ? `${player.mention} ${player.name}` : player.name;
        const checkmark = player.isDone ? ' ✅' : '';
        output += `• ${playerDisplay} - Please move to **${player.targetClan}**${checkmark}\n`;
      });
      
      return {
        text: output,
        players: specificPlayers,
        remainingCount,
        totalCount,
        completed: remainingCount === 0 && totalCount > 0
      };
    }
    
    // Build new list from scratch
    const allPlayers = [];
    let doneCount = 0;
    let totalCount = 0;

    // Check all groups (RGR, OTL, RND)
    ['RGR', 'OTL', 'RND'].forEach(groupName => {
      if (!this.groups[groupName] || !Array.isArray(this.groups[groupName])) {
        return; // Skip if group doesn't exist or is not an array
      }
      
      this.groups[groupName].forEach(player => {
        const displayName = getSwapsDisplayName(player);
        const mention = player.DiscordName; // Keep mention for reference
        const discordId = player['Discord-ID'] || null;
        const identifier = this.getPlayerIdentifier(player);
        
        // Check if marked as done
        let isDone = this.completedPlayers.has(identifier);
        
        // Also check by DiscordName (mention)
        if (!isDone && player.DiscordName) {
          isDone = this.completedPlayers.has(player.DiscordName);
        }
        
        // Also check by Discord-ID
        if (!isDone && player['Discord-ID']) {
          for (const completed of this.completedPlayers) {
            if (completed.includes(player['Discord-ID'])) {
              isDone = true;
              break;
            }
          }
        }
        
        totalCount++;
        if (isDone) doneCount++;
        
        // Add player to list (skip if hideCompleted and player is done)
        if (!hideCompleted || !isDone) {
          allPlayers.push({
            name: displayName,
            mention: mention,
            discordId: discordId,
            identifier: identifier,
            targetClan: groupName,
            isDone: isDone
          });
        }
      });
    });

    // Check WILDCARDS (manual moves)
    if (this.groups.WILDCARDS && this.groups.WILDCARDS.length > 0) {
      this.groups.WILDCARDS.forEach(player => {
        const displayName = getSwapsDisplayName(player);
        const mention = player.DiscordName; // Keep mention for reference
        const discordId = player['Discord-ID'] || null;
        const identifier = this.getPlayerIdentifier(player);
        
        // Check if marked as done
        let isDone = this.completedPlayers.has(identifier);
        
        if (!isDone && player.DiscordName) {
          isDone = this.completedPlayers.has(player.DiscordName);
        }
        
        if (!isDone && player['Discord-ID']) {
          for (const completed of this.completedPlayers) {
            if (completed.includes(player['Discord-ID'])) {
              isDone = true;
              break;
            }
          }
        }
        
        // Get target clan from wildcard info
        const info = this.wildcardInfo.get(identifier);
        let targetClan = 'Unknown';
        
        if (info) {
          if (info.type === 'manual') {
            targetClan = info.target;
          } else if (info.type === 'excluded') {
            // Skip excluded players (Hold)
            return;
          }
        }
        
        totalCount++;
        if (isDone) doneCount++;
        
        // Add player to list (skip if hideCompleted and player is done)
        if (!hideCompleted || !isDone) {
          allPlayers.push({
            name: displayName,
            mention: mention,
            discordId: discordId,
            identifier: identifier,
            targetClan: targetClan,
            isDone: isDone
          });
        }
      });
    }

    // Format output
    const remainingCount = totalCount - doneCount;
    output += `Total players remaining: **${remainingCount}** / ${totalCount}\n\n`;
    
    allPlayers.forEach(player => {
      // Use mention if available, add name after mention
      const playerDisplay = player.mention ? `${player.mention} ${player.name}` : player.name;
      const checkmark = player.isDone ? ' ✅' : '';
      output += `• ${playerDisplay} - Please move to **${player.targetClan}**${checkmark}\n`;
    });

    return {
      text: output,
      players: allPlayers,
      remainingCount,
      totalCount,
      completed: remainingCount === 0 && totalCount > 0
    };
  }
}

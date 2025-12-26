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
    this.customSeasonNumber = seasonNumber; // Store custom season number

    // Reset groups and WILDCARDS
    this.groups = {
      RGR: [],
      OTL: [],
      RND: [],
      WILDCARDS: [],
    };
    
    // Clear previous wildcard info
    this.wildcardInfo.clear();
    
    // Process players with Action column
    const playersWithAction = [];
    const availablePlayers = [];
    
    console.log(`🔍 distribute: Processing ${players.length} players`);
    console.log(`🔍 First player keys:`, players.length > 0 ? Object.keys(players[0]) : 'No players');
    
    players.forEach((player, index) => {
      const action = player.Action ? player.Action.trim() : '';
      const identifier = this.getPlayerIdentifier(player);
      
      if (index < 3) {
        console.log(`🔍 Player ${index + 1}: Name="${identifier}", Action="${action}"`);
      }
      
      if (action) {
        // Player has an action - add to WILDCARDS
        console.log(`✅ Adding to WILDCARDS: ${identifier} (Action: ${action})`);
        playersWithAction.push(player);
        
        // Store wildcard info
        if (action === 'Hold') {
          // Get player's current clan
          const currentClan = this.getPlayerClan(player);
          this.wildcardInfo.set(identifier, {
            type: 'excluded',
            target: currentClan || 'Unknown'
          });
          // Add to excludedPlayers set for count
          this.excludedPlayers.add(identifier);
        } else if (action === 'RGR' || action === 'OTL' || action === 'RND') {
          // Check if Action matches current clan
          const currentClan = this.getPlayerClan(player);
          
          if (currentClan === action) {
            // Player stays in same clan
            this.wildcardInfo.set(identifier, {
              type: 'stay',
              target: action
            });
          } else {
            // Player moves to different clan
            this.wildcardInfo.set(identifier, {
              type: 'manual',
              target: action
            });
          }
        } else {
          // Unknown action
          this.wildcardInfo.set(identifier, {
            type: 'other',
            target: action
          });
        }
      } else {
        // No action - available for distribution
        availablePlayers.push(player);
      }
    });
    
    console.log(`📊 After processing:`);
    console.log(`  - playersWithAction: ${playersWithAction.length}`);
    console.log(`  - availablePlayers: ${availablePlayers.length}`);
    
    // Add players with actions to WILDCARDS
    this.groups.WILDCARDS = playersWithAction;
    console.log(`📊 WILDCARDS set to ${this.groups.WILDCARDS.length} players`);

    // Sort available players by the specified column (descending)
    const sortedPlayers = [...availablePlayers].sort((a, b) => {
      const valueA = this.parseValue(a[columnName]);
      const valueB = this.parseValue(b[columnName]);
      return valueB - valueA; // Descending order
    });

    // Distribute players in order: RGR -> OTL -> RND
    const groupNames = config.groups.names;
    let currentGroupIndex = 0;
    let groupCounts = { RGR: 0, OTL: 0, RND: 0 }; // Track actual count including skipped

    for (const player of sortedPlayers) {
      // Get player's clan from column E (Clan, Team, Guild, etc.)
      const playerClan = this.getPlayerClan(player);
      
      // Find next available group (based on count, not array length)
      while (groupCounts[groupNames[currentGroupIndex]] >= config.groups.maxPlayersPerGroup) {
        currentGroupIndex++;
        if (currentGroupIndex >= groupNames.length) {
          console.warn('⚠️ All groups are full, some players cannot be assigned');
          break;
        }
      }

      if (currentGroupIndex < groupNames.length) {
        const targetGroup = groupNames[currentGroupIndex];
        
        // Increment count regardless
        groupCounts[targetGroup]++;
        
        // Check if player's clan matches the target group
        if (playerClan && playerClan.toUpperCase() === targetGroup.toUpperCase()) {
          console.log(`⏭️ Skipping display of ${this.getPlayerName(player)} in ${targetGroup} - already in clan ${playerClan}`);
          // Don't add to group array (won't be displayed), but count is incremented
        } else {
          // Add player to group (will be displayed)
          this.groups[targetGroup].push(player);
        }
      }
    }

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
   * @returns {string} Formatted text
   */
  getFormattedDistribution() {
    // Header with season number
    // Use custom season number if provided, otherwise use config
    const seasonNum = parseInt(this.customSeasonNumber || config.seasonNumber) || 156;
    let output = `# :RGR: SWAP LIST SEASON ${seasonNum} :RGR:\n\n`;

    // Display main groups with "to" prefix and player count
    for (const groupName of config.groups.names) {
      const players = this.groups[groupName];
      const playerCount = players.length; // Count only players in the actual group (automatic distribution)
      
      // Show player count only if > 0
      const countText = playerCount > 0 ? ` (${playerCount})` : '';
      output += `## to ${groupName}${countText}\n`;
      
      if (players.length === 0) {
        output += '_No players_\n\n';
      } else {
        players.forEach((player, index) => {
          // Get Discord mention and original name
          const discordMention = player.DiscordName || '';
          const originalName = player.OriginalName || player.Name || player.Player || player.USERNAME || '';
          
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
          
          // Format: › @mention • Name • **value**
          let line = '› ';
          if (discordMention) {
            line += discordMention;
            if (originalName) {
              line += ` • ${originalName}`;
            }
          } else {
            const displayName = originalName || this.getPlayerName(player);
            line += displayName;
          }
          
          if (value) {
            line += ` • **${value}**`;
          }
          if (isDone) {
            line += ' ✅';
          }
          output += line + '\n';
        });
        output += '\n';
      }
    }

    // Display WILDCARDS group (excluded + manually moved)
    if (this.groups.WILDCARDS && this.groups.WILDCARDS.length > 0) {
      // Count moves per clan
      const clanCounts = { RGR: 0, OTL: 0, RND: 0 };
      this.groups.WILDCARDS.forEach(player => {
        const identifier = this.getPlayerIdentifier(player);
        const info = this.wildcardInfo.get(identifier);
        if (info && info.type === 'manual') {
          if (clanCounts[info.target] !== undefined) {
            clanCounts[info.target]++;
          }
        }
      });

      output += `# WILDCARDS (${this.groups.WILDCARDS.length})\n`;
      this.groups.WILDCARDS.forEach((player, index) => {
        // Get Discord mention and original name
        const discordMention = player.DiscordName || '';
        const originalName = player.OriginalName || player.Name || player.Player || player.USERNAME || '';
        
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
        
        // Build line: @mention •Name• moves ➜ CLAN or ⏸ Stay in CLAN
        let line = '';
        if (discordMention) {
          line += discordMention;
          if (originalName) {
            line += ` •${originalName}•`;
          }
        } else {
          const displayName = originalName || this.getPlayerName(player);
          line += `•${displayName}•`;
        }
        
        if (info) {
          if (info.type === 'excluded' || info.type === 'stay') {
            line += ` stays in **${info.target}**`;
          } else if (info.type === 'manual') {
            line += ` moves to **${info.target}**`;
          }
        }
        
        if (isDone) {
          line += ' ✅';
        }
        output += line + '\n';
      });
      output += '\n';
    }

    // Footer message
    output += '---\n\n';
    output += 'Done: ✅\n\n';
    output += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
    output += ':exclamation: **| 18-HOUR-RULE |** :exclamation:\n';
    output += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';

    return output;
  }

  /**
   * Get formatted list of players for Swaps Left
   * @param {boolean} hideCompleted - If true, hide players who are already done (for new messages)
   * @param {Array} specificPlayers - If provided, only show these players (for updates)
   * @returns {object} { text: string, players: Array } - Formatted text and list of players shown
   */
  getSwapsLeft(hideCompleted = true, specificPlayers = null) {
    let output = '**SWAPS LEFT**\n\n';
    
    // If specificPlayers is provided, use that list for updates
    if (specificPlayers && specificPlayers.length > 0) {
      let doneCount = 0;
      const totalCount = specificPlayers.length;
      
      // Update isDone status for each player
      specificPlayers.forEach(player => {
        const identifier = player.name;
        let isDone = this.completedPlayers.has(identifier);
        
        // Check by mention
        if (!isDone && player.mention) {
          isDone = this.completedPlayers.has(player.mention);
        }
        
        // Check by Discord-ID in mention
        if (!isDone && player.mention) {
          const match = player.mention.match(/<@(\d+)>/);
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
      });
      
      const remainingCount = totalCount - doneCount;
      if (remainingCount === 0) {
        output += '✅ All players have moved!\n';
      } else {
        output += `Total players remaining: **${remainingCount}** / ${totalCount}\n\n`;
      }
      
      specificPlayers.forEach(player => {
        const playerDisplay = player.mention ? `${player.mention} ${player.name}` : player.name;
        const checkmark = player.isDone ? ' ✅' : '';
        output += `• ${playerDisplay} - Please move to **${player.targetClan}**${checkmark}\n`;
      });
      
      return { text: output, players: specificPlayers };
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
        // Use original name for display, not Discord mention
        const displayName = this.getPlayerName(player);
        const mention = player.DiscordName; // Keep mention for reference
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
            targetClan: groupName,
            isDone: isDone
          });
        }
      });
    });

    // Check WILDCARDS (manual moves)
    if (this.groups.WILDCARDS && this.groups.WILDCARDS.length > 0) {
      this.groups.WILDCARDS.forEach(player => {
        // Use original name for display, not Discord mention
        const displayName = this.getPlayerName(player);
        const mention = player.DiscordName; // Keep mention for reference
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
            targetClan: targetClan,
            isDone: isDone
          });
        }
      });
    }

    // Format output
    const remainingCount = allPlayers.filter(p => !p.isDone).length;
    if (remainingCount === 0 && allPlayers.length > 0) {
      output += '✅ All players have moved!\n';
    } else {
      output += `Total players remaining: **${remainingCount}** / ${allPlayers.length}\n\n`;
    }
    
    allPlayers.forEach(player => {
      // Use mention if available, add name after mention
      const playerDisplay = player.mention ? `${player.mention} ${player.name}` : player.name;
      const checkmark = player.isDone ? ' ✅' : '';
      output += `• ${playerDisplay} - Please move ➜ **${player.targetClan}**${checkmark}\n`;
    });

    return { text: output, players: allPlayers };
  }
}

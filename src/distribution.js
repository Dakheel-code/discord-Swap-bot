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

    // Keep WILDCARDS, excludedPlayers, manualAssignments, wildcardInfo, and manualMoveCount
    const wildcards = this.groups.WILDCARDS || [];
    this.groups = {
      RGR: [],
      OTL: [],
      RND: [],
      WILDCARDS: wildcards,
    };
    
    // Don't reset manual move count - keep it to preserve manual assignments
    // this.manualMoveCount is already set and should be preserved

    // Filter out excluded players
    const availablePlayers = players.filter(
      player => !this.excludedPlayers.has(this.getPlayerIdentifier(player))
    );

    // Sort players by the specified column (descending)
    const sortedPlayers = [...availablePlayers].sort((a, b) => {
      const valueA = this.parseValue(a[columnName]);
      const valueB = this.parseValue(b[columnName]);
      return valueB - valueA; // Descending order
    });

    // First, count manually assigned players (but don't add them to groups - they go to WILDCARDS)
    const manuallyAssigned = [];
    sortedPlayers.forEach(player => {
      const identifier = this.getPlayerIdentifier(player);
      if (this.manualAssignments.has(identifier)) {
        const targetGroup = this.manualAssignments.get(identifier);
        manuallyAssigned.push(identifier);
        // Count manual moves for main groups only (for display purposes)
        if (targetGroup === 'RGR' || targetGroup === 'OTL' || targetGroup === 'RND') {
          this.manualMoveCount[targetGroup]++;
        }
      }
    });

    // Remove manually assigned players from sorted list
    const remainingPlayers = sortedPlayers.filter(
      player => !manuallyAssigned.includes(this.getPlayerIdentifier(player))
    );

    // Distribute remaining players in order: RGR -> OTL -> RND
    const groupNames = config.groups.names;
    let currentGroupIndex = 0;
    let groupCounts = { RGR: 0, OTL: 0, RND: 0 }; // Track actual count including skipped

    for (const player of remainingPlayers) {
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
   * Find a player by name (case-insensitive)
   * @param {string} playerName - Name to search for
   * @returns {Object|null} Player object or null
   */
  findPlayer(playerName) {
    const searchName = playerName.toLowerCase().trim();
    
    // Search in all players
    for (const player of this.allPlayers) {
      const playerNameValue = this.getPlayerName(player).toLowerCase().trim();
      if (playerNameValue === searchName || playerNameValue.includes(searchName)) {
        return player;
      }
    }

    // Search in WILDCARDS if not found in allPlayers
    if (this.groups.WILDCARDS) {
      for (const player of this.groups.WILDCARDS) {
        const playerNameValue = this.getPlayerName(player).toLowerCase().trim();
        if (playerNameValue === searchName || playerNameValue.includes(searchName)) {
          return player;
        }
      }
    }

    return null;
  }

  /**
   * Mark player as done (moved)
   * @param {string} playerName - Name of the player
   */
  markPlayerAsDone(playerName) {
    const player = this.findPlayer(playerName);
    if (!player) {
      throw new Error(`Player not found: ${playerName}`);
    }

    const identifier = this.getPlayerIdentifier(player);
    this.completedPlayers.add(identifier);
    return true;
  }

  /**
   * Unmark player as done (remove checkmark)
   * @param {string} playerName - Name of the player
   */
  unmarkPlayerAsDone(playerName) {
    const player = this.findPlayer(playerName);
    if (!player) {
      throw new Error(`Player not found: ${playerName}`);
    }

    const identifier = this.getPlayerIdentifier(player);
    this.completedPlayers.delete(identifier);
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
      excluded: this.excludedPlayers.size,
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
          const name = this.getPlayerName(player);
          const identifier = this.getPlayerIdentifier(player);
          const isDone = this.completedPlayers.has(identifier);
          const value = this.sortColumn ? player[this.sortColumn] : '';
          
          output += `• ${name}`;
          if (value) {
            output += ` - ${value}`;
          }
          if (isDone) {
            output += ' ✅';
          }
          output += '\n';
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

      output += `## WILDCARDS (${this.groups.WILDCARDS.length})\n`;
      this.groups.WILDCARDS.forEach((player, index) => {
        const name = this.getPlayerName(player);
        const identifier = this.getPlayerIdentifier(player);
        const isDone = this.completedPlayers.has(identifier);
        const info = this.wildcardInfo.get(identifier);
        
        let suffix = '';
        if (info) {
          if (info.type === 'excluded') {
            suffix = ` - stays in **${info.target}**`;
          } else if (info.type === 'manual') {
            suffix = ` - Move to **${info.target}**`;
          }
        }
        
        output += `• ${name}${suffix}`;
        if (isDone) {
          output += ' ✅';
        }
        output += '\n';
      });
      output += '\n';
    }

    // Footer message
    output += '---\n\n';
    output += 'Stop: ❌ Hold: ✋ Done: ✅\n\n';
    output += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
    output += 'AND DON\'T FORGET TO HIT MANTICORE BEFORE YOU MOVE!\n\n';
    output += ':exclamation: **| 18-HOUR-RULE |** :exclamation:\n';
    output += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';

    return output;
  }
}

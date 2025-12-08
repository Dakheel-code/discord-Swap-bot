import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Distribute players into groups based on Trophies')
    .addStringOption(option =>
      option
        .setName('season')
        .setDescription('Season number (e.g., 156)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move players to a specific clan')
    .addUserOption(option =>
      option
        .setName('player')
        .setDescription('Discord user to move')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('clan')
        .setDescription('Target clan (RGR, OTL, or RND)')
        .setRequired(true)
        .addChoices(
          { name: 'RGR', value: 'RGR' },
          { name: 'OTL', value: 'OTL' },
          { name: 'RND', value: 'RND' }
        )
    ),

  new SlashCommandBuilder()
    .setName('hold')
    .setDescription('Exclude players from distribution')
    .addUserOption(option =>
      option
        .setName('player')
        .setDescription('Discord user to exclude')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('include')
    .setDescription('Include a previously excluded player')
    .addUserOption(option =>
      option
        .setName('player')
        .setDescription('Discord user to include')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('show')
    .setDescription('Show current distribution'),

  new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Refresh data from Google Sheets'),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset settings')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('What to reset')
        .setRequired(true)
        .addChoices(
          { name: 'Reset All Settings (Actions + Distribution)', value: 'all' },
          { name: 'Reset Distribution Only', value: 'swap' }
        )
    ),

  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule automatic distribution posting (UTC timezone)')
    .addStringOption(option =>
      option
        .setName('datetime')
        .setDescription('Date and time in UTC (YYYY-MM-DD HH:MM, e.g., 2024-12-25 14:30)')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to post in')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('cancelschedule')
    .setDescription('Cancel scheduled distribution'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands and usage instructions'),

  new SlashCommandBuilder()
    .setName('map')
    .setDescription('Map in-game player name to Discord account')
    .addStringOption(option =>
      option
        .setName('ingame_id')
        .setDescription('In-game player name/ID')
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName('discord_id')
        .setDescription('Discord user to map')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('done')
    .setDescription('Mark players as moved (adds/removes checkmark)')
    .addStringOption(option =>
      option
        .setName('players')
        .setDescription('Player names (separate multiple names with commas)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Add or remove checkmark')
        .setRequired(true)
        .addChoices(
          { name: 'Add ✅', value: 'add' },
          { name: 'Remove ❌', value: 'remove' }
        )
    ),

  new SlashCommandBuilder()
    .setName('swapsleft')
    .setDescription('Show players who have not moved yet'),
];

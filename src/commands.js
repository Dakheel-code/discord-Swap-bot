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
          { name: 'Reset All Settings (Actions + Swap)', value: 'all' },
          { name: 'Reset Swap Only', value: 'swap' }
        )
    ),

  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage scheduled distribution posting')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new scheduled distribution (UTC timezone)')
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
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View current scheduled distribution')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit scheduled distribution')
        .addStringOption(option =>
          option
            .setName('datetime')
            .setDescription('New date and time in UTC (YYYY-MM-DD HH:MM)')
            .setRequired(false)
        )
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('New channel to post in')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete scheduled distribution')
    ),

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
    .setDescription('Open dropdown menus to mark players as done'),

  new SlashCommandBuilder()
    .setName('swapsleft')
    .setDescription('Show players who have not moved yet'),
];

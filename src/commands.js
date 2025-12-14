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
    .setName('swapsleft')
    .setDescription('Show players who have not moved yet'),

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Show Admin Controls panel'),
];

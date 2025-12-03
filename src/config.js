import dotenv from 'dotenv';

dotenv.config();

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
  },
  googleSheets: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    range: process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:Z',
    apiKey: process.env.GOOGLE_API_KEY,
    serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
  },
  groups: {
    names: ['RGR', 'OTL', 'RND'],
    maxPlayersPerGroup: 50,
  },
  seasonNumber: process.env.SEASON_NUMBER || '156',
};

export function validateConfig() {
  const errors = [];

  if (!config.discord.token) {
    errors.push('DISCORD_TOKEN is not set in .env file');
  }

  if (!config.googleSheets.sheetId) {
    errors.push('GOOGLE_SHEET_ID is not set in .env file');
  }

  if (!config.googleSheets.apiKey) {
    errors.push('GOOGLE_API_KEY is not set in .env file');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(error => console.error(`  - ${error}`));
    return false;
  }

  return true;
}

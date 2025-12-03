# How to Setup Service Account for Write Access

To enable the `/map` command (writing to Google Sheets), you need to configure a Service Account.

## Steps:

### 1. Create Service Account in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Go to **IAM & Admin** > **Service Accounts**
4. Click **Create Service Account**
5. Give it a name (e.g., "Discord Bot Sheets Writer")
6. Click **Create and Continue**
7. Skip the optional steps and click **Done**

### 2. Create and Download Credentials

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Choose **JSON** format
5. Click **Create**
6. The JSON file will be downloaded automatically
7. Save this file as `credentials.json` in your bot's root directory

### 3. Share Google Sheet with Service Account

1. Open the downloaded `credentials.json` file
2. Find the `client_email` field (looks like: `your-service-account@project-id.iam.gserviceaccount.com`)
3. Copy this email address
4. Open your Google Sheet
5. Click **Share** button
6. Paste the service account email
7. Give it **Editor** permissions
8. Click **Send**

### 4. Update .env File

Add this line to your `.env` file:

```env
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials.json
```

### 5. Restart the Bot

Stop and restart your bot. You should see:
```
✅ Google Sheets API initialized with write access
```

## Testing

Try the `/map` command:
```
/map ingame_id:PlayerName discord_id:@DiscordUser
```

If successful, you'll see:
```
✅ Discord Mapping Added
Successfully mapped PlayerName to @DiscordUser
```

## Troubleshooting

### Error: "Write access not available"
- Make sure `credentials.json` exists in the bot directory
- Check that `GOOGLE_SERVICE_ACCOUNT_PATH` is set correctly in `.env`
- Restart the bot

### Error: "Permission denied"
- Make sure you shared the Google Sheet with the service account email
- Give it **Editor** permissions (not just Viewer)

### Error: "File not found"
- Check the path in `GOOGLE_SERVICE_ACCOUNT_PATH`
- Make sure `credentials.json` is in the correct location

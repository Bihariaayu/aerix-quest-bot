import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';
import { startDiscordBot } from './src/bot';

process.on('unhandledRejection', (reason) => {
	console.error('[Error:] Unhandled Rejection', reason);
});

process.on('uncaughtException', (error) => {
	console.error('Uncaught Exception:', error.message);
});

async function main() {
	if (process.env.DISCORD_BOT_TOKEN) {
		console.log('[System] Starting Multi-User Discord Bot...');
		await startDiscordBot();
		return;
	}

	if (process.env.TOKEN) {
		console.log('------------------------------------------------------------');
		console.log('[System] Running in Single-User CLI Selfbot mode (TOKEN from .env).');
		console.log('[Info] To enable the Multi-User Discord Bot so ANYONE can use it');
		console.log('       at the same time, add DISCORD_BOT_TOKEN to your .env file!');
		console.log('------------------------------------------------------------');

		const client = new ClientQuest(process.env.TOKEN);

		client.once(GatewayDispatchEvents.Ready, async ({ data }) => {
			if (process.env.GITHUB_ACTIONS === 'true') {
				console.log('Logged in!');
			} else {
				console.log(`Logged in as @${data.user.username}`);
			}

			await client.fetchQuests(false);
			const questsValid = client.questManager!.filterQuestsValidToDo();
			console.log(`Found ${questsValid.length} valid quests to do.`);

			await Promise.allSettled(
				questsValid.map((quest) => client.questManager!.doingQuest(quest)),
			);

			console.log('All quests processed. Disconnecting...');
			await client.destroy();
		});

		await client.connect();
		return;
	}

	console.error('[Error] Neither DISCORD_BOT_TOKEN nor TOKEN was found in your .env file.');
	console.log('\nTo configure the Multi-User Discord Bot:');
	console.log('1. Go to https://discord.com/developers/applications and create an Application.');
	console.log('2. Under "Bot", click "Reset Token" to copy your Bot Token.');
	console.log('3. In your .env file, add:');
	console.log('   DISCORD_BOT_TOKEN=your_discord_bot_token_here');
	console.log('4. Run `npm start` again!\n');
	process.exit(1);
}

main().catch((err) => {
	console.error('Fatal error in bot startup:', err);
	process.exit(1);
});

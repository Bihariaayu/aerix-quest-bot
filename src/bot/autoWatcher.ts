import { Client as DiscordClient } from 'discord.js';
import { REST, DefaultRestOptions, ResponseLike } from '@discordjs/rest';
import type { RequestInit } from 'undici';
import { linkManager, type LinkedAccount } from './linkManager';
import { taskManager } from './taskManager';
import { Utils } from '../utils';
import { QuestManager } from '../questManager';
import { ClientQuest, makeRequest, customAgent } from '../client';
import { createQuestStatusEmbed, toSmallCaps, THEME_PURPLE } from './embeds';
import { EmbedBuilder } from 'discord.js';

export class AutoQuestWatcher {
	private timer: NodeJS.Timeout | null = null;
	private isScanning = false;
	private discordClient: DiscordClient | null = null;

	public start(client: DiscordClient, intervalMs = 20 * 60 * 1000): void {
		this.discordClient = client;
		if (this.timer) return;

		console.log(`[Auto-Pilot] Quest Watcher initialized (Interval: ${(intervalMs / 60000).toFixed(0)}m).`);

		// Initial check 5 seconds after bot connects
		setTimeout(() => {
			this.scanAll().catch((err) => console.error('[Auto-Pilot] Initial scan error:', err.message));
		}, 5_000);

		// Recurring interval
		this.timer = setInterval(() => {
			this.scanAll().catch((err) => console.error('[Auto-Pilot] Scheduled scan error:', err.message));
		}, intervalMs);
	}

	public stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	public async scanAll(): Promise<void> {
		if (this.isScanning) return;
		this.isScanning = true;

		try {
			const accounts = linkManager.getAutoCompleteAccounts();
			if (accounts.length === 0) return;

			console.log(`[Auto-Pilot] Scanning for newly dropped quests across ${accounts.length} enrolled account(s)...`);

			for (const account of accounts) {
				await this.checkAccount(account);
			}
		} catch (error: any) {
			console.error('[Auto-Pilot] Error during batch scan:', error.message);
		} finally {
			this.isScanning = false;
		}
	}

	public async checkAccount(account: LinkedAccount): Promise<boolean> {
		// If user already has an active or queued task, do not duplicate
		if (taskManager.getTask(account.discordUserId)) {
			return false;
		}

		try {
			// Fast REST check for active quests
			const rest = new REST({ version: '10', timeout: 30_000, agent: customAgent as any, makeRequest }).setToken(account.userToken);
			const response: any = await rest.get('/quests/@me');
			if (!response || !response.quests) return false;

			// Check for valid uncompleted quests
			const fakeClient = new ClientQuest(account.userToken);
			const manager = await QuestManager.fromResponse(fakeClient, response, false);
			const validQuests = manager.filterQuestsValidToDo();

			if (validQuests.length === 0) {
				return false;
			}

			console.log(
				`[Auto-Pilot] Detected ${validQuests.length} new quest(s) for @${account.targetUser.username}. Dispatching...`,
			);

			// Notify user in DM
			if (this.discordClient) {
				try {
					const user = await this.discordClient.users.fetch(account.discordUserId);
					const headerBox =
						'```prolog\n' +
						`┌── ${toSmallCaps('AUTO-PILOT DISPATCH')} ───────────────────┐\n` +
						`│ NEW DISCORD QUESTS DETECTED                  │\n` +
						'└──────────────────────────────────────────────┘\n' +
						'```';

					const dmEmbed = new EmbedBuilder()
						.setColor(THEME_PURPLE)
						.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('AUTOMATED DISPATCH')}` })
						.setDescription(
							`${headerBox}\n` +
								`Detected **${validQuests.length}** newly available Discord Quest(s).\n\n` +
								validQuests.map((q) => `◈ **${q.config.messages.quest_name}**`).join('\n') +
								`\n\nAutomatically initializing execution in the background...`,
						)
						.setFooter({ text: `AERIX QUEST INFRASTRUCTURE · AUTO-PILOT` });

					await user.send({ embeds: [dmEmbed] });
				} catch {}
			}

			// Launch task in taskManager
			const mode = account.autoMode || 'one_by_one';
			await taskManager.startTask(
				account.discordUserId,
				account.targetUser.username,
				account.userToken,
				async (task) => {
					if (task.status === 'completed' && this.discordClient) {
						try {
							const user = await this.discordClient.users.fetch(account.discordUserId);
							const completeBox =
								'```prolog\n' +
								`┌── ${toSmallCaps('AUTO-PILOT COMPLETED')} ──────────────────┐\n` +
								`│ ALL ELIGIBLE QUESTS COMPLETED                │\n` +
								'└──────────────────────────────────────────────┘\n' +
								'```';

							const completeEmbed = new EmbedBuilder()
								.setColor(THEME_PURPLE)
								.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('EXECUTION SUCCESS')}` })
								.setDescription(
									`${completeBox}\n` +
										`All **${task.totalQuests}** quest(s) have been successfully completed automatically.\n` +
										`Rewards have been accredited to your Discord account.`,
								)
								.setFooter({ text: `AERIX QUEST INFRASTRUCTURE · AUTO-PILOT` });

							await user.send({ embeds: [completeEmbed] });
						} catch {}
					}
				},
				mode,
			);

			return true;
		} catch (err: any) {
			console.error(`[Auto-Pilot] Failed check for @${account.targetUser.username}:`, err.message);
			return false;
		}
	}
}

export const autoQuestWatcher = new AutoQuestWatcher();

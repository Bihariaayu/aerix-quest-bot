import {
	Client,
	GatewayIntentBits,
	Partials,
	Interaction,
	PermissionFlagsBits,
	ChatInputCommandInteraction,
	ButtonInteraction,
	ModalSubmitInteraction,
	Message,
	Events,
} from 'discord.js';
import { taskManager } from './taskManager';
import { linkManager, type LinkedAccount } from './linkManager';
import { settingsManager } from './settingsManager';
import {
	createQuestStatusEmbed,
	createStatusActionRow,
	createPanelEmbed,
	createPanelActionRow,
	createHelpEmbed,
	createTokenModal,
	createLinkModal,
	createLinkEmbed,
	createLinkActionRow,
	createAutoToggleEmbed,
	createAutoToggleActionRow,
	createChannelRestrictionEmbed,
	createChannelConfiguredEmbed,
	createChannelClearedEmbed,
	createModeSelectionEmbed,
	createModeSelectionActionRow,
	toSmallCaps,
} from './embeds';
import { autoQuestWatcher } from './autoWatcher';
import { registerCommands, clearGuildCommands } from './commands';
import type { QuestUserTask, ExecutionMode } from './types';

export const PREFIX = 'c?';

export function createDiscordBot(botToken: string, withMessageContent = true): Client {
	const intents = [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.DirectMessages,
	];

	if (withMessageContent) {
		intents.push(GatewayIntentBits.MessageContent);
	}

	const client = new Client({
		intents,
		partials: [Partials.Channel, Partials.Message],
	});

	client.once(Events.ClientReady, async () => {
		console.log(`[System] Discord Bot connected as @${client.user?.tag} (ID: ${client.user?.id})`);
		console.log(`[System] Max concurrent quest slots: ${taskManager.getMaxConcurrent()}`);
		console.log(`[System] Total linked accounts stored: ${linkManager.getCount()}`);
		console.log(`[System] Command Prefix: "${PREFIX}" | Slash Commands: "/quest", "/link", "/unlink", "/help"`);

		if (client.user?.id) {
			const guildIds = client.guilds.cache.map((g) => g.id);
			console.log(`[System] Registering commands for ${guildIds.length} connected guild(s): ${guildIds.join(', ')}`);
			await registerCommands(botToken, client.user.id, guildIds);
		}

		// Restore any in-flight quest tasks interrupted by restart/update
		const recovered = await taskManager.restoreTasks(client);
		if (recovered > 0) {
			console.log(`[Recovery] Successfully restored and resumed ${recovered} active task(s).`);
		}

		// Initialize background quest watcher for auto-pilot accounts
		autoQuestWatcher.start(client);
		console.log(`[System] Auto-pilot active accounts: ${linkManager.getAutoCompleteAccounts().length}`);
	});

	client.on(Events.GuildCreate, async (guild) => {
		if (client.user?.id) {
			console.log(`[System] Joined guild ${guild.name} (${guild.id}), ensuring no duplicate commands...`);
			await clearGuildCommands(botToken, client.user.id, guild.id);
		}
	});

	client.on(Events.Error, (error) => {
		console.error('[System Error] Discord Client:', error);
	});

	client.on(Events.ShardError, (error, shardId) => {
		console.error(`[System Error] Shard ${shardId}:`, error);
	});

	client.on(Events.ShardDisconnect, (event, shardId) => {
		console.warn(`[System Warning] Shard ${shardId} disconnected (code ${event.code}). Auto-reconnecting...`);
	});

	client.on(Events.ShardReconnecting, (shardId) => {
		console.log(`[System Info] Shard ${shardId} reconnecting to Gateway...`);
	});

	client.on(Events.ShardResume, (shardId, replayedEvents) => {
		console.log(`[System Info] Shard ${shardId} resumed connection (${replayedEvents} events replayed).`);
	});

	client.on(Events.InteractionCreate, async (interaction: Interaction) => {
		try {
			if (interaction.isChatInputCommand()) {
				await handleChatInput(interaction);
			} else if (interaction.isButton()) {
				await handleButton(interaction);
			} else if (interaction.isModalSubmit()) {
				await handleModalSubmit(interaction);
			}
		} catch (error: any) {
			console.error('Error handling interaction:', error);
			if (interaction.isRepliable()) {
				const errMsg = error?.message || 'An unexpected error occurred.';
				if (interaction.deferred || interaction.replied) {
					await interaction.followUp({ content: `◈ ERROR: ${errMsg}`, ephemeral: true }).catch(() => {});
				} else {
					await interaction.reply({ content: `◈ ERROR: ${errMsg}`, ephemeral: true }).catch(() => {});
				}
			}
		}
	});

	client.on(Events.MessageCreate, async (message: Message) => {
		try {
			await handleMessage(message, client);
		} catch (error: any) {
			console.error('Error handling prefix command:', error);
			await message.reply({ content: `◈ ERROR: ${error?.message || 'An unexpected error occurred.'}` }).catch(() => {});
		}
	});

	return client;
}

// ---------------------------------------------------------
// Prefix Command Handler (c?...)
// ---------------------------------------------------------
async function handleMessage(message: Message, client: Client): Promise<void> {
	if (message.author.bot) return;

	const content = message.content?.trim() || '';
	const lower = content.toLowerCase();
	const botId = client.user?.id;
	const botMention = botId ? `<@${botId}>` : null;
	const botMentionNick = botId ? `<@!${botId}>` : null;

	let rawCmd = '';
	if (lower.startsWith(PREFIX)) {
		rawCmd = content.slice(PREFIX.length).trim();
	} else if (botMention && content.startsWith(botMention)) {
		rawCmd = content.slice(botMention.length).trim();
	} else if (botMentionNick && content.startsWith(botMentionNick)) {
		rawCmd = content.slice(botMentionNick.length).trim();
	} else if (botId && message.mentions.users.has(botId)) {
		rawCmd = content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
	} else {
		return;
	}

	// Also strip prefix if present after mention (e.g. "@bot c?help" -> "help")
	if (rawCmd.toLowerCase().startsWith(PREFIX)) {
		rawCmd = rawCmd.slice(PREFIX.length).trim();
	}

	const args = rawCmd.split(/\s+/).filter(Boolean);
	let command = args[0]?.toLowerCase() || '';
	let param = args.slice(1).join(' ').trim();

	// If command is "quest" and has a sub-command (e.g. "c?quest setchannel #channel" or "c?quest start")
	if (command === 'quest' && args.length > 1) {
		const sub = args[1].toLowerCase();
		if (['start', 'stop', 'cancel', 'status', 'panel', 'help', 'setchannel', 'clearchannel', 'unsetchannel', 'resetchannel', 'channel', 'auto'].includes(sub)) {
			command = sub;
			param = args.slice(2).join(' ').trim();
		}
	}

	// Channel restriction check for servers
	if (message.guildId) {
		const designatedChannelId = settingsManager.getQuestChannel(message.guildId);
		if (designatedChannelId && message.channelId !== designatedChannelId) {
			const isConfigCommand = ['setchannel', 'clearchannel', 'unsetchannel', 'resetchannel', 'channel'].includes(command);
			const isAdmin =
				message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
				message.member?.permissions.has(PermissionFlagsBits.ManageGuild);

			if (!(isConfigCommand && isAdmin)) {
				const { embed, components } = createChannelRestrictionEmbed(designatedChannelId, message.guildId);
				await message.reply({
					content: `◈ NOTICE: If you want to use the quest bot, please use <#${designatedChannelId}>.`,
					embeds: [embed],
					components,
				});
				return;
			}
		}
	}

	// If just mentioned with nothing else
	if (!rawCmd) {
		const linked = linkManager.getLinkedAccount(message.author.id);
		await message.reply({
			content:
				`\`┌── ${toSmallCaps('OPERATOR INTERFACE')} ───────────────────────┐\`\n` +
				`\`│ PREFIX  : ${PREFIX.padEnd(35)} │\`\n` +
				`\`│ HELP    : ${(`${PREFIX}help or /help`).padEnd(35)} │\`\n` +
				`\`│ LINK    : ${(`${PREFIX}link or /link`).padEnd(35)} │\`\n` +
				`\`│ AUTO    : ${(`${PREFIX}auto or /auto`).padEnd(35)} │\`\n` +
				`\`│ EXECUTE : ${(`${PREFIX}start or /quest start`).padEnd(35)} │\`\n` +
				`\`└───────────────────────────────────────────────┘\``,
			components: [createLinkActionRow(Boolean(linked), Boolean(linked?.autoComplete))],
		});
		return;
	}

	switch (command) {
		case 'setchannel':
		case 'channel': {
			if (!message.guild || !message.guildId) {
				await message.reply({ content: '◈ ERROR: Channel configuration is only available inside servers.' });
				return;
			}

			const isAdmin =
				message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
				message.member?.permissions.has(PermissionFlagsBits.ManageGuild);

			if (!isAdmin) {
				await message.reply({ content: '◈ ERROR: Administrative permissions (Manage Server or Administrator) required to configure channels.' });
				return;
			}

			// If command is 'channel' with no param, show current status
			if (command === 'channel' && !param) {
				const current = settingsManager.getQuestChannel(message.guildId);
				if (current) {
					await message.reply({
						content: `◈ NOTICE: Designated quest channel is currently <#${current}>.`,
					});
				} else {
					await message.reply({
						content: '◈ NOTICE: No dedicated channel configured. Quest commands are active across all channels.',
					});
				}
				return;
			}

			let targetChannelId: string | null = null;
			if (message.mentions.channels.size > 0) {
				targetChannelId = message.mentions.channels.first()!.id;
			} else if (param) {
				const mentionMatch = param.match(/<#(\d+)>/);
				if (mentionMatch) {
					targetChannelId = mentionMatch[1];
				} else {
					const idMatch = param.match(/\b\d{17,20}\b/);
					if (idMatch) {
						targetChannelId = idMatch[0];
					}
				}
			}

			if (!targetChannelId) {
				targetChannelId = message.channel.id;
			}

			const targetChannel =
				message.guild.channels.cache.get(targetChannelId) ||
				(await message.guild.channels.fetch(targetChannelId).catch(() => null));
			if (!targetChannel) {
				await message.reply({ content: '◈ ERROR: Specified channel could not be found in this server.' });
				return;
			}

			settingsManager.setQuestChannel(message.guildId, targetChannelId);
			await message.reply({
				embeds: [createChannelConfiguredEmbed(targetChannelId)],
			});
			break;
		}

		case 'clearchannel':
		case 'unsetchannel':
		case 'resetchannel': {
			if (!message.guild || !message.guildId) {
				await message.reply({ content: '◈ ERROR: Channel configuration is only available inside servers.' });
				return;
			}

			const isAdmin =
				message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
				message.member?.permissions.has(PermissionFlagsBits.ManageGuild);

			if (!isAdmin) {
				await message.reply({ content: '◈ ERROR: Administrative permissions (Manage Server or Administrator) required to configure channels.' });
				return;
			}

			settingsManager.clearQuestChannel(message.guildId);
			await message.reply({
				embeds: [createChannelClearedEmbed()],
			});
			break;
		}

		case 'help': {
			await message.reply({ embeds: [createHelpEmbed()] });
			break;
		}

		case 'link': {
			// If user provided a token directly
			if (param) {
				// Delete user message in guild channels to protect their token!
				if (message.guild && message.deletable) {
					await message.delete().catch(() => {});
				}

				try {
					const linked = await linkManager.linkAccount(message.author.id, param);
					await message.reply({
						content: message.guild ? '◈ NOTICE: Token string purged from channel for security.' : undefined,
						embeds: [createLinkEmbed(linked)],
						components: [createLinkActionRow(true, Boolean(linked.autoComplete))],
					});
				} catch (err: any) {
					await message.reply({ content: `◈ ERROR: ${err?.message || 'Invalid credentials provided.'}` });
				}
				return;
			}

			// No token passed: show link panel with modal button
			const linked = linkManager.getLinkedAccount(message.author.id);
			await message.reply({
				embeds: [createLinkEmbed(linked)],
				components: [createLinkActionRow(Boolean(linked), Boolean(linked?.autoComplete))],
			});
			break;
		}

		case 'unlink': {
			const unlinked = linkManager.unlinkAccount(message.author.id);
			if (unlinked) {
				await message.reply({ content: '◈ NOTICE: Account credentials successfully dissociated.' });
			} else {
				await message.reply({ content: '◈ NOTICE: No active credentials associated with this account.' });
			}
			break;
		}

		case 'auto':
		case 'autopilot': {
			const linked = linkManager.getLinkedAccount(message.author.id);
			if (!linked) {
				await message.reply({
					content: '◈ NOTICE: No linked account credentials found.\nAssociate your Discord token first to enable Auto-Pilot.',
					components: [createLinkActionRow(false)],
				});
				return;
			}

			const subArg = param.toLowerCase();
			let targetState: boolean;
			let targetMode: ExecutionMode = linked.autoMode || 'one_by_one';

			if (subArg.includes('all') || subArg.includes('concurrent') || subArg.includes('multi')) {
				targetMode = 'all_at_once';
			} else if (subArg.includes('one') || subArg.includes('seq') || subArg.includes('single')) {
				targetMode = 'one_by_one';
			}

			if (subArg.startsWith('on') || subArg.startsWith('enable') || subArg.startsWith('1') || subArg.startsWith('true')) {
				targetState = true;
			} else if (subArg.startsWith('off') || subArg.startsWith('disable') || subArg.startsWith('0') || subArg.startsWith('false')) {
				targetState = false;
			} else if (subArg.startsWith('status')) {
				targetState = Boolean(linked.autoComplete);
			} else {
				targetState = !Boolean(linked.autoComplete);
			}

			const updated = linkManager.setAutoComplete(message.author.id, targetState, targetMode);
			if (updated) {
				await message.reply({
					embeds: [createAutoToggleEmbed(updated, targetState)],
					components: [createAutoToggleActionRow(targetState)],
				});
			}
			break;
		}

		case 'start':
		case 'run': {
			const linked = linkManager.getLinkedAccount(message.author.id);
			if (!linked) {
				await message.reply({
					content: '◈ NOTICE: No linked account credentials found.\nSelect **`LINK ACCOUNT`** below to authorize your session.',
					components: [createLinkActionRow(false)],
				});
				return;
			}

			const lowerParam = param.toLowerCase();
			if (lowerParam.includes('all') || lowerParam.includes('concurrent') || lowerParam.includes('multi') || lowerParam.includes('same')) {
				await startQuestFromMessage(message, linked.userToken, linked.targetUser, 'all_at_once');
				return;
			}
			if (lowerParam.includes('one') || lowerParam.includes('seq') || lowerParam.includes('single') || lowerParam === '1') {
				await startQuestFromMessage(message, linked.userToken, linked.targetUser, 'one_by_one');
				return;
			}

			await message.reply({
				embeds: [createModeSelectionEmbed()],
				components: [createModeSelectionActionRow()],
			});
			break;
		}

		case 'status': {
			const task = taskManager.getTask(message.author.id);
			if (!task) {
				const linked = linkManager.getLinkedAccount(message.author.id);
				await message.reply({
					content: '◈ NOTICE: No active execution tasks found in queue.',
					components: [linked ? createLinkActionRow(true, Boolean(linked.autoComplete)) : createLinkActionRow(false)],
				});
				return;
			}
			const queuePos = taskManager.getQueuePosition(message.author.id);
			const embed = createQuestStatusEmbed(
				task,
				queuePos,
				taskManager.getRunningCount(),
				taskManager.getMaxConcurrent(),
			);
			const row = createStatusActionRow(task.status);
			await message.reply({ embeds: [embed], components: [row] });
			break;
		}

		case 'stop':
		case 'cancel': {
			const stopped = taskManager.stopTask(message.author.id);
			if (stopped) {
				await message.reply({ content: '◈ NOTICE: Quest execution session terminated.' });
			} else {
				await message.reply({ content: '◈ NOTICE: No active or queued session found to terminate.' });
			}
			break;
		}

		case 'panel': {
			if (
				message.guild &&
				!message.member?.permissions.has(PermissionFlagsBits.Administrator) &&
				!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)
			) {
				await message.reply({ content: '◈ ERROR: Administrative permissions required to deploy control panel.' });
				return;
			}

			if ('send' in message.channel) {
				await message.channel.send({
					embeds: [createPanelEmbed()],
					components: [createPanelActionRow()],
				});
			} else {
				await message.reply({ content: '◈ ERROR: Cannot deploy control panel to this channel.' });
			}
			break;
		}
	}
}

// ---------------------------------------------------------
// Helper: Start Quest from Prefix Message
// ---------------------------------------------------------
async function startQuestFromMessage(
	message: Message,
	token: string,
	targetUser: { username: string },
	mode: ExecutionMode = 'one_by_one',
): Promise<void> {
	const modeLabel = mode === 'all_at_once' ? 'ALL AT ONCE' : 'ONE BY ONE';
	const initialMsg = await message.reply({
		content: `◈ INITIALIZING: Quest execution dispatching for @${targetUser.username} [${modeLabel}]...`,
	});

	let lastEditTime = 0;
	let editTimeout: NodeJS.Timeout | null = null;

	const updateMessage = async (task: QuestUserTask) => {
		const now = Date.now();
		const queuePos = taskManager.getQueuePosition(task.userId);
		const embed = createQuestStatusEmbed(
			task,
			queuePos,
			taskManager.getRunningCount(),
			taskManager.getMaxConcurrent(),
		);
		const row = createStatusActionRow(task.status);
		const isFinal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

		const doEdit = async () => {
			try {
				await initialMsg.edit({ content: '', embeds: [embed], components: [row] });
				lastEditTime = Date.now();
			} catch {}

			if (isFinal) {
				try {
					await message.author.send({
						content: `◈ DISCORD QUEST MONITOR · STATUS UPDATE`,
						embeds: [embed],
					});
				} catch {}
			}
		};

		if (isFinal) {
			if (editTimeout) {
				clearTimeout(editTimeout);
				editTimeout = null;
			}
			await doEdit();
		} else {
			if (now - lastEditTime >= 6000) {
				await doEdit();
			} else if (!editTimeout) {
				editTimeout = setTimeout(async () => {
					editTimeout = null;
					await doEdit();
				}, 6000 - (now - lastEditTime));
			}
		}
	};

	try {
		const task = await taskManager.startTask(
			message.author.id,
			message.author.tag,
			token,
			(updatedTask) => {
				updateMessage(updatedTask);
			},
			mode,
		);
		await updateMessage(task);
	} catch (err: any) {
		await initialMsg.edit({
			content: `◈ ERROR: Could not dispatch quest task: ${err?.message || 'Execution error.'}`,
		});
	}
}

// ---------------------------------------------------------
// Slash Command Handler (/...)
// ---------------------------------------------------------
async function handleChatInput(interaction: ChatInputCommandInteraction): Promise<void> {
	const { commandName } = interaction;

	if (interaction.guildId) {
		const designatedChannelId = settingsManager.getQuestChannel(interaction.guildId);
		if (designatedChannelId && interaction.channelId !== designatedChannelId) {
			let isConfigCommand = false;
			if (commandName === 'setchannel' || commandName === 'clearchannel') {
				isConfigCommand = true;
			} else if (commandName === 'quest') {
				const sub = interaction.options.getSubcommand(false);
				if (sub === 'setchannel' || sub === 'clearchannel') {
					isConfigCommand = true;
				}
			}

			const isAdmin =
				interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
				interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

			if (!(isConfigCommand && isAdmin)) {
				const { embed, components } = createChannelRestrictionEmbed(designatedChannelId, interaction.guildId);
				await interaction.reply({
					content: `◈ NOTICE: If you want to use the quest bot, please use <#${designatedChannelId}>.`,
					embeds: [embed],
					components,
					ephemeral: true,
				});
				return;
			}
		}
	}

	if (commandName === 'setchannel') {
		if (!interaction.guildId) {
			await interaction.reply({ content: '◈ ERROR: Channel configuration is only available inside servers.', ephemeral: true });
			return;
		}
		const isAdmin =
			interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
			interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
		if (!isAdmin) {
			await interaction.reply({ content: '◈ ERROR: Administrative permissions required.', ephemeral: true });
			return;
		}
		const channel = interaction.options.getChannel('channel', true);
		settingsManager.setQuestChannel(interaction.guildId, channel.id);
		await interaction.reply({ embeds: [createChannelConfiguredEmbed(channel.id)], ephemeral: true });
		return;
	}

	if (commandName === 'clearchannel') {
		if (!interaction.guildId) {
			await interaction.reply({ content: '◈ ERROR: Channel configuration is only available inside servers.', ephemeral: true });
			return;
		}
		const isAdmin =
			interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
			interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
		if (!isAdmin) {
			await interaction.reply({ content: '◈ ERROR: Administrative permissions required.', ephemeral: true });
			return;
		}
		settingsManager.clearQuestChannel(interaction.guildId);
		await interaction.reply({ embeds: [createChannelClearedEmbed()], ephemeral: true });
		return;
	}

	if (commandName === 'help') {
		await interaction.reply({ embeds: [createHelpEmbed()], ephemeral: true });
		return;
	}

	if (commandName === 'link') {
		const tokenOpt = interaction.options.getString('token')?.trim();
		if (tokenOpt) {
			await interaction.deferReply({ ephemeral: true });
			try {
				const linked = await linkManager.linkAccount(interaction.user.id, tokenOpt);
				await interaction.editReply({
					embeds: [createLinkEmbed(linked)],
					components: [createLinkActionRow(true, Boolean(linked.autoComplete))],
				});
			} catch (err: any) {
				await interaction.editReply({
					content: `◈ ERROR: ${err?.message || 'Invalid user credentials provided.'}`,
				});
			}
			return;
		}

		const linked = linkManager.getLinkedAccount(interaction.user.id);
		await interaction.reply({
			embeds: [createLinkEmbed(linked)],
			components: [createLinkActionRow(Boolean(linked), Boolean(linked?.autoComplete))],
			ephemeral: true,
		});
		return;
	}

	if (commandName === 'unlink') {
		const unlinked = linkManager.unlinkAccount(interaction.user.id);
		if (unlinked) {
			await interaction.reply({ content: '◈ NOTICE: Account credentials dissociated.', ephemeral: true });
		} else {
			await interaction.reply({ content: '◈ NOTICE: No active credentials associated with this account.', ephemeral: true });
		}
		return;
	}

	if (commandName === 'auto') {
		const linked = linkManager.getLinkedAccount(interaction.user.id);
		if (!linked) {
			await interaction.reply({
				content: '◈ NOTICE: No linked account credentials found.\nAssociate your Discord token first to enable Auto-Pilot.',
				components: [createLinkActionRow(false)],
				ephemeral: true,
			});
			return;
		}

		const stateOpt = interaction.options.getString('state');
		const modeOpt = interaction.options.getString('mode') as ExecutionMode | null;

		let targetState: boolean;
		if (stateOpt === 'enable') {
			targetState = true;
		} else if (stateOpt === 'disable') {
			targetState = false;
		} else {
			targetState = !Boolean(linked.autoComplete);
		}

		const targetMode: ExecutionMode = modeOpt || linked.autoMode || 'one_by_one';
		const updated = linkManager.setAutoComplete(interaction.user.id, targetState, targetMode);
		if (updated) {
			await interaction.reply({
				embeds: [createAutoToggleEmbed(updated, targetState)],
				components: [createAutoToggleActionRow(targetState)],
				ephemeral: true,
			});
		}
		return;
	}

	if (commandName === 'quest') {
		const sub = interaction.options.getSubcommand();

		switch (sub) {
			case 'setchannel': {
				if (!interaction.guildId) {
					await interaction.reply({ content: '◈ ERROR: Channel configuration is only available inside servers.', ephemeral: true });
					return;
				}
				const isAdmin =
					interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
					interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
				if (!isAdmin) {
					await interaction.reply({ content: '◈ ERROR: Administrative permissions required.', ephemeral: true });
					return;
				}
				const channel = interaction.options.getChannel('channel', true);
				settingsManager.setQuestChannel(interaction.guildId, channel.id);
				await interaction.reply({ embeds: [createChannelConfiguredEmbed(channel.id)], ephemeral: true });
				break;
			}
			case 'clearchannel': {
				if (!interaction.guildId) {
					await interaction.reply({ content: '◈ ERROR: Channel configuration is only available inside servers.', ephemeral: true });
					return;
				}
				const isAdmin =
					interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
					interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
				if (!isAdmin) {
					await interaction.reply({ content: '◈ ERROR: Administrative permissions required.', ephemeral: true });
					return;
				}
				settingsManager.clearQuestChannel(interaction.guildId);
				await interaction.reply({ embeds: [createChannelClearedEmbed()], ephemeral: true });
				break;
			}
			case 'help': {
				await interaction.reply({ embeds: [createHelpEmbed()], ephemeral: true });
				break;
			}
			case 'start': {
				const modeOpt = interaction.options.getString('mode') as ExecutionMode | null;
				const tokenOpt = interaction.options.getString('token')?.trim();

				if (tokenOpt) {
					if (!linkManager.getLinkedAccount(interaction.user.id)) {
						try {
							await linkManager.linkAccount(interaction.user.id, tokenOpt);
						} catch {}
					}
					if (modeOpt) {
						await interaction.deferReply({ ephemeral: true });
						await startQuestFromInteraction(interaction, tokenOpt, modeOpt);
						return;
					} else {
						await interaction.reply({
							embeds: [createModeSelectionEmbed()],
							components: [createModeSelectionActionRow()],
							ephemeral: true,
						});
						return;
					}
				}

				// If user already has a linked account
				const linked = linkManager.getLinkedAccount(interaction.user.id);
				if (linked) {
					if (modeOpt) {
						await interaction.deferReply({ ephemeral: true });
						await startQuestFromInteraction(interaction, linked.userToken, modeOpt);
						return;
					} else {
						await interaction.reply({
							embeds: [createModeSelectionEmbed()],
							components: [createModeSelectionActionRow()],
							ephemeral: true,
						});
						return;
					}
				}

				// Otherwise open the modal for manual entry
				const modal = createTokenModal('modal_quest_token');
				await interaction.showModal(modal);
				break;
			}
			case 'status': {
				const task = taskManager.getTask(interaction.user.id);
				if (!task) {
					const linked = linkManager.getLinkedAccount(interaction.user.id);
					await interaction.reply({
						content: '◈ NOTICE: No active quest tasks found.\nSelect **`INITIALIZE`** to start execution.',
						components: [linked ? createLinkActionRow(true, Boolean(linked.autoComplete)) : createStatusActionRow('completed')],
						ephemeral: true,
					});
					return;
				}
				const queuePos = taskManager.getQueuePosition(interaction.user.id);
				const embed = createQuestStatusEmbed(
					task,
					queuePos,
					taskManager.getRunningCount(),
					taskManager.getMaxConcurrent(),
				);
				const row = createStatusActionRow(task.status);
				await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
				break;
			}
			case 'auto': {
				const linked = linkManager.getLinkedAccount(interaction.user.id);
				if (!linked) {
					await interaction.reply({
						content: '◈ NOTICE: No linked account credentials found.\nAssociate your Discord token first to enable Auto-Pilot.',
						components: [createLinkActionRow(false)],
						ephemeral: true,
					});
					return;
				}

				const stateOpt = interaction.options.getString('state');
				const modeOpt = interaction.options.getString('mode') as ExecutionMode | null;

				let targetState: boolean;
				if (stateOpt === 'enable') {
					targetState = true;
				} else if (stateOpt === 'disable') {
					targetState = false;
				} else {
					targetState = !Boolean(linked.autoComplete);
				}

				const targetMode: ExecutionMode = modeOpt || linked.autoMode || 'one_by_one';
				const updated = linkManager.setAutoComplete(interaction.user.id, targetState, targetMode);
				if (updated) {
					await interaction.reply({
						embeds: [createAutoToggleEmbed(updated, targetState)],
						components: [createAutoToggleActionRow(targetState)],
						ephemeral: true,
					});
				}
				break;
			}
			case 'stop': {
				const stopped = taskManager.stopTask(interaction.user.id);
				if (stopped) {
					await interaction.reply({
						content: '◈ NOTICE: Quest execution session terminated.',
						ephemeral: true,
					});
				} else {
					await interaction.reply({
						content: '◈ NOTICE: No active or queued session found to terminate.',
						ephemeral: true,
					});
				}
				break;
			}
			case 'panel': {
				if (
					interaction.guild &&
					!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
					!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
				) {
					await interaction.reply({
						content: '◈ ERROR: Administrative permissions required to deploy control panel.',
						ephemeral: true,
					});
					return;
				}

				if (interaction.channel && 'send' in interaction.channel) {
					await interaction.channel.send({
						embeds: [createPanelEmbed()],
						components: [createPanelActionRow()],
					});
					await interaction.reply({
						content: '◈ NOTICE: Control panel deployed to channel.',
						ephemeral: true,
					});
				} else {
					await interaction.reply({
						content: '◈ ERROR: Unable to deploy panel to this channel.',
						ephemeral: true,
					});
				}
				break;
			}
		}
	}
}

// ---------------------------------------------------------
// Button Handler
// ---------------------------------------------------------
async function handleButton(interaction: ButtonInteraction): Promise<void> {
	if (interaction.guildId) {
		const designatedChannelId = settingsManager.getQuestChannel(interaction.guildId);
		if (designatedChannelId && interaction.channelId !== designatedChannelId) {
			const { embed, components } = createChannelRestrictionEmbed(designatedChannelId, interaction.guildId);
			await interaction.reply({
				content: `◈ NOTICE: If you want to use the quest bot, please use <#${designatedChannelId}>.`,
				embeds: [embed],
				components,
				ephemeral: true,
			});
			return;
		}
	}

	const { customId } = interaction;

	if (customId === 'btn_open_link_modal') {
		const modal = createLinkModal('modal_link_token');
		await interaction.showModal(modal);
		return;
	}

	if (customId === 'btn_unlink_account') {
		linkManager.unlinkAccount(interaction.user.id);
		await interaction.update({
			embeds: [createLinkEmbed(null)],
			components: [createLinkActionRow(false)],
		});
		return;
	}

	if (customId === 'btn_start_linked_quest' || customId === 'btn_start_quest') {
		const linked = linkManager.getLinkedAccount(interaction.user.id);
		if (linked) {
			await interaction.reply({
				embeds: [createModeSelectionEmbed()],
				components: [createModeSelectionActionRow()],
				ephemeral: true,
			});
			return;
		}

		const modal = createTokenModal('modal_quest_token');
		await interaction.showModal(modal);
		return;
	}

	if (customId === 'btn_mode_one_by_one' || customId === 'btn_mode_all_at_once') {
		const mode: ExecutionMode = customId === 'btn_mode_all_at_once' ? 'all_at_once' : 'one_by_one';
		const linked = linkManager.getLinkedAccount(interaction.user.id);
		if (!linked) {
			const modal = createTokenModal('modal_quest_token');
			await interaction.showModal(modal);
			return;
		}

		await interaction.deferReply({ ephemeral: true });
		await startQuestFromInteraction(interaction, linked.userToken, mode);
		return;
	}

	if (customId === 'btn_toggle_auto') {
		const linked = linkManager.getLinkedAccount(interaction.user.id);
		if (!linked) {
			await interaction.reply({
				content: '◈ NOTICE: No linked account credentials found.\nAssociate your Discord token first to enable Auto-Pilot.',
				components: [createLinkActionRow(false)],
				ephemeral: true,
			});
			return;
		}

		const result = linkManager.toggleAutoComplete(interaction.user.id);
		if (!result.account) {
			await interaction.reply({
				content: '◈ ERROR: Could not update auto-pilot state.',
				ephemeral: true,
			});
			return;
		}

		const isLinkEmbed = interaction.message.embeds[0]?.author?.name?.includes('ACCOUNT REGISTRY');
		if (isLinkEmbed) {
			await interaction.update({
				embeds: [createLinkEmbed(result.account)],
				components: [createLinkActionRow(true, result.enabled)],
			});
		} else {
			await interaction.update({
				embeds: [createAutoToggleEmbed(result.account, result.enabled)],
				components: [createAutoToggleActionRow(result.enabled)],
			});
		}
		return;
	}

	if (customId === 'btn_help_quest') {
		await interaction.reply({ embeds: [createHelpEmbed()], ephemeral: true });
		return;
	}

	if (customId === 'btn_stop_quest') {
		const stopped = taskManager.stopTask(interaction.user.id);
		if (stopped) {
			const task = taskManager.getTask(interaction.user.id);
			if (task) {
				const embed = createQuestStatusEmbed(
					task,
					0,
					taskManager.getRunningCount(),
					taskManager.getMaxConcurrent(),
				);
				const row = createStatusActionRow(task.status);
				await interaction.update({ embeds: [embed], components: [row] });
			} else {
				await interaction.reply({ content: '◈ NOTICE: Session terminated.', ephemeral: true });
			}
		} else {
			await interaction.reply({
				content: '◈ NOTICE: No active quest session found to terminate.',
				ephemeral: true,
			});
		}
		return;
	}

	if (customId === 'btn_refresh_quest') {
		const task = taskManager.getTask(interaction.user.id);
		if (!task) {
			await interaction.reply({
				content: '◈ NOTICE: No active task found for this account.',
				ephemeral: true,
			});
			return;
		}
		const queuePos = taskManager.getQueuePosition(interaction.user.id);
		const embed = createQuestStatusEmbed(
			task,
			queuePos,
			taskManager.getRunningCount(),
			taskManager.getMaxConcurrent(),
		);
		const row = createStatusActionRow(task.status);
		await interaction.update({ embeds: [embed], components: [row] });
		return;
	}
}

// ---------------------------------------------------------
// Modal Submit Handler
// ---------------------------------------------------------
async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
	if (interaction.customId === 'modal_link_token') {
		const token = interaction.fields.getTextInputValue('link_token_input').trim();
		await interaction.deferReply({ ephemeral: true });
		try {
			const linked = await linkManager.linkAccount(interaction.user.id, token);
			await interaction.editReply({
				embeds: [createLinkEmbed(linked)],
				components: [createLinkActionRow(true, Boolean(linked.autoComplete))],
			});
		} catch (err: any) {
			await interaction.editReply({
				content: `◈ ERROR: ${err?.message || 'Invalid user credentials provided.'}`,
			});
		}
		return;
	}

	if (interaction.customId === 'modal_quest_token') {
		const token = interaction.fields.getTextInputValue('user_token_input').trim();
		await interaction.deferReply({ ephemeral: true });
		await startQuestFromInteraction(interaction, token);
		return;
	}
}

// ---------------------------------------------------------
// Helper: Start Quest from Slash/Modal Interaction
// ---------------------------------------------------------
async function startQuestFromInteraction(
	interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction,
	token: string,
	mode: ExecutionMode = 'one_by_one',
): Promise<void> {
	let lastEditTime = 0;
	let editTimeout: NodeJS.Timeout | null = null;
	let interactionExpired = false;

	const updateInteraction = async (task: QuestUserTask) => {
		if (interactionExpired) return;
		const now = Date.now();
		const queuePos = taskManager.getQueuePosition(task.userId);
		const embed = createQuestStatusEmbed(
			task,
			queuePos,
			taskManager.getRunningCount(),
			taskManager.getMaxConcurrent(),
		);
		const row = createStatusActionRow(task.status);
		const isFinal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

		const doEdit = async () => {
			try {
				await interaction.editReply({ embeds: [embed], components: [row] });
				lastEditTime = Date.now();
			} catch (err: any) {
				if (err?.code === 10062 || err?.code === 40060) {
					interactionExpired = true;
				}
			}

			if (isFinal && interactionExpired) {
				try {
					await interaction.user.send({
						content: `◈ DISCORD QUEST MONITOR · STATUS UPDATE`,
						embeds: [embed],
					});
				} catch {}
			}
		};

		if (isFinal) {
			if (editTimeout) {
				clearTimeout(editTimeout);
				editTimeout = null;
			}
			await doEdit();
		} else {
			if (now - lastEditTime >= 6000) {
				await doEdit();
			} else if (!editTimeout) {
				editTimeout = setTimeout(async () => {
					editTimeout = null;
					await doEdit();
				}, 6000 - (now - lastEditTime));
			}
		}
	};

	try {
		const task = await taskManager.startTask(
			interaction.user.id,
			interaction.user.tag,
			token,
			(updatedTask) => {
				updateInteraction(updatedTask);
			},
			mode,
		);
		await updateInteraction(task);
	} catch (err: any) {
		await interaction.editReply({
			content: `◈ ERROR: Could not dispatch quest task: ${err?.message || 'Internal error'}`,
		});
	}
}

// ---------------------------------------------------------
// Bot Lifecycle & Startup with Intent Fallback
// ---------------------------------------------------------
export async function startDiscordBot(): Promise<void> {
	const botToken = process.env.DISCORD_BOT_TOKEN;
	if (!botToken) {
		console.error('[Error] DISCORD_BOT_TOKEN is not defined in environment variables.');
		process.exit(1);
	}

	let client: Client;
	try {
		// Attempt to login with MessageContent enabled for standard prefix commands
		client = createDiscordBot(botToken, true);
		await client.login(botToken);
	} catch (err: any) {
		if (err?.message?.includes('disallowed intents') || err?.code === 'DisallowedIntents') {
			console.warn('\n[Warning] Message Content Intent is not toggled on in the Discord Developer Portal.');
			console.warn('   Falling back to standard intents.');
			console.warn('   Slash commands (/quest, /link) work in all channels.');
			console.warn('   Prefix commands (c?link, c?start) will work in DMs or when mentioning the bot.');
			console.warn('   To enable direct "c?" prefix in server channels:');
			console.warn('      1. Go to https://discord.com/developers/applications');
			console.warn('      2. Select your application -> Bot');
			console.warn('      3. Under "Privileged Gateway Intents", toggle "Message Content Intent" ON!\n');

			client = createDiscordBot(botToken, false);
			await client.login(botToken);

			// Automatically poll and upgrade once the user turns ON the intent in Developer Portal
			const intentWatcher = setInterval(async () => {
				try {
					const testClient = new Client({
						intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
					});
					await testClient.login(botToken);
					await testClient.destroy();
					clearInterval(intentWatcher);
					console.log('\n[System] Message Content Intent detected! Upgrading bot to enable "c?" prefix everywhere...');
					await client.destroy();
					await startDiscordBot();
				} catch {}
			}, 15_000);
		} else {
			throw err;
		}
	}

	const shutdown = async (signal?: string) => {
		console.log(`\n[System] Received ${signal || 'shutdown signal'}. Saving state and shutting down gracefully...`);
		try {
			await taskManager.gracefulShutdown();
		} catch (err: any) {
			console.error('[System] Error during task manager shutdown:', err.message);
		}
		try {
			await client.destroy();
		} catch {}
		process.exit(0);
	};

	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Start bot if run directly
if (require.main === module) {
	startDiscordBot().catch((err) => {
		console.error('Fatal error starting Discord bot:', err);
		process.exit(1);
	});
}

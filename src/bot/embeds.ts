import {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import type { QuestUserTask, TaskStatus, ExecutionMode } from './types';
import type { LinkedAccount } from './linkManager';

export const THEME_PURPLE = 0x6d28d9; // Deep Royal Purple

const smallCapsMap: Record<string, string> = {
	a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
	j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
	s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

export function toSmallCaps(text: string): string {
	return text.toLowerCase().split('').map((c) => smallCapsMap[c] || c).join('');
}

export function createProgressBar(percent: number, length = 12): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filledCount = Math.round((clamped / 100) * length);
	const emptyCount = length - filledCount;
	return `\`[${'■'.repeat(filledCount)}${'□'.repeat(emptyCount)}]\` \`${clamped}%\``;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

export function getTaskTypeBadge(type: string): string {
	switch (type) {
		case 'WATCH_VIDEO':
		case 'WATCH_VIDEO_ON_MOBILE':
			return 'VIDEO';
		case 'PLAY_ON_DESKTOP':
		case 'PLAY_ON_XBOX':
		case 'PLAY_ON_PLAYSTATION':
			return 'CLIENT';
		case 'PLAY_ACTIVITY':
			return 'ACTIVITY';
		case 'ACHIEVEMENT_IN_ACTIVITY':
			return 'OAUTH';
		default:
			return 'TASK';
	}
}

export function createQuestStatusEmbed(
	task: QuestUserTask,
	queuePos = 0,
	runningCount = 0,
	maxConcurrent = 5,
): EmbedBuilder {
	const embed = new EmbedBuilder();
	embed.setColor(THEME_PURPLE);

	const targetUser = task.targetUser;
	const avatarUrl = targetUser.avatar
		? `https://cdn.discordapp.com/avatars/${targetUser.id}/${targetUser.avatar}.png`
		: `https://cdn.discordapp.com/embed/avatars/${Number(targetUser.discriminator || '0') % 5}.png`;

	embed.setAuthor({
		name: `AERIX QUEST · ${toSmallCaps('SYSTEM MONITOR')}`,
		iconURL: avatarUrl,
	});

	let statusLabel = 'ACTIVE';
	if (task.status === 'queued') statusLabel = `QUEUED [POSITION #${queuePos}]`;
	else if (task.status === 'completed') statusLabel = 'COMPLETED';
	else if (task.status === 'cancelled') statusLabel = 'TERMINATED';
	else if (task.status === 'failed') statusLabel = 'FAILED';

	const now = task.endedAt ? task.endedAt.getTime() : Date.now();
	const elapsed = task.startedAt ? formatDuration(now - task.startedAt.getTime()) : '00m 00s';

	const modeLabel = task.mode === 'all_at_once' ? 'ALL AT ONCE [CONCURRENT]' : 'ONE BY ONE [SEQUENTIAL]';

	// Closed box header
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('SESSION PROFILE')} ──────────────────────────┐\n` +
		`│ OPERATOR   : @${targetUser.username}\n` +
		`│ IDENTIFIER : ${targetUser.id}\n` +
		`│ STATUS     : ${statusLabel}\n` +
		`│ STRATEGY   : ${modeLabel}\n` +
		`│ DURATION   : ${elapsed}\n` +
		`│ CAPACITY   : [${runningCount}/${maxConcurrent} SLOTS]\n` +
		'└──────────────────────────────────────────────┘\n' +
		'```';

	let description = headerBox;

	if (task.errorMessage) {
		description += `\`\`\`diff\n- ERROR: ${task.errorMessage}\n\`\`\`\n`;
	}

	const overallPercent =
		task.totalQuests > 0
			? Math.round((task.completedQuests / task.totalQuests) * 100)
			: task.status === 'completed'
			? 100
			: 0;

	description +=
		`**${toSmallCaps('EXECUTION PROGRESS')}**\n` +
		`${createProgressBar(overallPercent, 14)} \`[${task.completedQuests}/${task.totalQuests} QUESTS]\`\n\n`;

	if (task.quests.length > 0) {
		const questsList = task.quests
			.map((q) => {
				const badge = getTaskTypeBadge(q.taskType);
				let statusStr = 'PENDING';
				if (q.status === 'completed') statusStr = 'COMPLETED';
				else if (q.status === 'in_progress')
					statusStr = `${q.percent}% ${q.details ? `· ${q.details}` : ''}`;
				else if (q.status === 'failed')
					statusStr = `FAILED · ${q.details || 'SKIPPED'}`;

				return `◈ **${q.name}**\n  └─ \`[${badge}]\` \`${statusStr}\``;
			})
			.slice(0, 10)
			.join('\n');

		description += `**${toSmallCaps('ACTIVE QUEUE')}**\n${questsList}`;
	} else if (task.status === 'completed') {
		description += `\`[ALL ELIGIBLE QUESTS PROCESSED]\``;
	}

	embed.setDescription(description);
	embed.setFooter({
		text: `AERIX QUEST INFRASTRUCTURE · SECURE SESSION DISPATCH`,
	});

	return embed;
}

export function createStatusActionRow(status: TaskStatus): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>();

	if (status === 'running' || status === 'queued') {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId('btn_stop_quest')
				.setLabel('TERMINATE')
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId('btn_refresh_quest')
				.setLabel('SYNCHRONIZE')
				.setStyle(ButtonStyle.Secondary),
		);
	} else {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId('btn_start_quest')
				.setLabel('INITIALIZE')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('btn_open_link_modal')
				.setLabel('ACCOUNT LINK')
				.setStyle(ButtonStyle.Secondary),
		);
	}

	return row;
}

export function createPanelEmbed(): EmbedBuilder {
	const panelBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('QUEST AUTOMATION SYSTEM')} ─────────────────┐\n` +
		`│ AERIX HIGH-PERFORMANCE DISPATCH CORE         │\n` +
		`├──────────────────────────────────────────────┤\n` +
		`│ ◈ CONCURRENT MULTI-SESSION EXECUTION         │\n` +
		`│ ◈ AUTOMATED VIDEO & HEARTBEAT DISPATCH       │\n` +
		`│ ◈ SEAMLESS BACKGROUND BACKGROUND SCHEDULING  │\n` +
		`│ ◈ ENCRYPTED LOCAL CREDENTIAL STORAGE         │\n` +
		`└──────────────────────────────────────────────┘\n` +
		'```';

	return new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('CONTROL PANEL')}` })
		.setDescription(
			`${panelBox}\n` +
				`Execute your active Discord Quests in the background without launching external game clients.\n\n` +
				`Select **\`INITIALIZE\`** below to start or associate your session.`,
		)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · INTERACTIVE STATION`,
		});
}

export function createPanelActionRow(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('btn_start_quest')
			.setLabel('INITIALIZE')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('btn_open_link_modal')
			.setLabel('LINK ACCOUNT')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('btn_help_quest')
			.setLabel('DOCUMENTATION')
			.setStyle(ButtonStyle.Secondary),
	);
}

export function createHelpEmbed(): EmbedBuilder {
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('SYSTEM DOCUMENTATION')} ────────────────────┐\n` +
		`│ AERIX QUEST AUTOMATION PLATFORM              │\n` +
		`└──────────────────────────────────────────────┘\n` +
		'```';

	const content =
		`${headerBox}\n` +
		`**${toSmallCaps('METHOD 1 · NETWORK TAB (RECOMMENDED · 100% RELIABLE)')}**\n` +
		`\`1.\` Press \`Ctrl + Shift + I\` (or \`Cmd + Option + I\`) to open Developer Tools.\n` +
		`\`2.\` Click the **Network** tab at the top.\n` +
		`\`3.\` In the filter box, type \`/api\` or \`messages\`.\n` +
		`\`4.\` Click any channel in Discord (or press \`Ctrl + R\` to refresh).\n` +
		`\`5.\` Click on any request (e.g. \`messages\`, \`science\`, \`@me\`).\n` +
		`\`6.\` Under **Headers** ➔ **Request Headers**, copy the **\`Authorization\`** value.\n\n` +
		`**${toSmallCaps('METHOD 2 · CONSOLE RUNTIME')}**\n` +
		`\`1.\` Open the **Console** tab in Developer Tools.\n` +
		`\`2.\` Paste and execute:\n` +
		'```js\n' +
		'window.webpackChunkdiscord_app.push([[Symbol()],{},e=>{for(let c in e.c){let x=e.c[c]?.exports;if(x?.default?.getToken){console.log(x.default.getToken());return;}if(x?.getToken){console.log(x.getToken());return;}}}]);\n' +
		'```\n\n' +
		`**${toSmallCaps('COMMAND REFERENCE')}**\n` +
		`\`◈\` \`/link\` · \`c?link\` ──── Associate account credentials\n` +
		`\`◈\` \`/unlink\` · \`c?unlink\` ── Remove associated credentials\n` +
		`\`◈\` \`/auto\` · \`c?auto\` ──── Toggle auto-pilot quest completion\n` +
		`\`◈\` \`/quest start\` · \`c?start\` ─ Initialize quest execution\n` +
		`\`◈\` \`/quest status\` · \`c?status\` ─ Inspect active session\n` +
		`\`◈\` \`/quest stop\` · \`c?stop\` ── Terminate active session\n` +
		`\`◈\` \`/quest panel\` · \`c?panel\` ─ Deploy control panel\n` +
		`\`◈\` \`c?setchannel [#ch]\` ─ (Admin) Restrict commands to channel\n` +
		`\`◈\` \`c?clearchannel\` ──── (Admin) Remove channel restriction\n` +
		`\`◈\` \`/help\` · \`c?help\` ────── Display documentation\n\n` +
		`**${toSmallCaps('SECURITY ARCHITECTURE')}**\n` +
		`Account credentials are transmitted exclusively via private Discord modals and retained securely on the local daemon for automated dispatch.`;

	return new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('USER GUIDE')}` })
		.setDescription(content)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · REFERENCE MANUAL`,
		});
}

export function createTokenModal(customId = 'modal_quest_token'): ModalBuilder {
	const modal = new ModalBuilder()
		.setCustomId(customId)
		.setTitle('SESSION AUTHORIZATION');

	const tokenInput = new TextInputBuilder()
		.setCustomId('user_token_input')
		.setLabel('USER ACCOUNT TOKEN')
		.setStyle(TextInputStyle.Paragraph)
		.setPlaceholder('Paste your personal Discord account token...')
		.setMinLength(20)
		.setMaxLength(250)
		.setRequired(true);

	const row = new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput);
	modal.addComponents(row);

	return modal;
}

export function createLinkModal(customId = 'modal_link_token'): ModalBuilder {
	const modal = new ModalBuilder()
		.setCustomId(customId)
		.setTitle('ACCOUNT LINK AUTHORIZATION');

	const tokenInput = new TextInputBuilder()
		.setCustomId('link_token_input')
		.setLabel('USER ACCOUNT TOKEN')
		.setStyle(TextInputStyle.Paragraph)
		.setPlaceholder('Paste your personal Discord account token...')
		.setMinLength(20)
		.setMaxLength(250)
		.setRequired(true);

	const row = new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput);
	modal.addComponents(row);

	return modal;
}

export function createLinkEmbed(
	linked: (LinkedAccount | { targetUser: { id: string; username: string; avatar: string | null; discriminator: string; global_name?: string | null }; linkedAt: string; autoComplete?: boolean; autoMode?: ExecutionMode }) | null,
): EmbedBuilder {
	const embed = new EmbedBuilder();
	embed.setColor(THEME_PURPLE);

	if (linked) {
		const targetUser = linked.targetUser;
		const avatarUrl = targetUser.avatar
			? `https://cdn.discordapp.com/avatars/${targetUser.id}/${targetUser.avatar}.png`
			: `https://cdn.discordapp.com/embed/avatars/${Number(targetUser.discriminator || '0') % 5}.png`;

		const autoStatus = linked.autoComplete
			? `ENABLED (${(linked.autoMode || 'one_by_one').toUpperCase().replace(/_/g, ' ')})`
			: 'DISABLED';
		const dateStr = new Date(linked.linkedAt).toISOString().slice(0, 10);

		const linkBox =
			'```prolog\n' +
			`┌── ${toSmallCaps('CREDENTIAL REGISTRY')} ──────────────────────┐\n` +
			`│ STATUS     : LINKED\n` +
			`│ OPERATOR   : @${targetUser.username}\n` +
			`│ IDENTIFIER : ${targetUser.id}\n` +
			`│ AUTO-PILOT : ${autoStatus}\n` +
			`│ ENROLLED   : ${dateStr}\n` +
			`└──────────────────────────────────────────────┘\n` +
			'```';

		embed
			.setAuthor({
				name: `AERIX QUEST · ${toSmallCaps('ACCOUNT REGISTRY')}`,
				iconURL: avatarUrl,
			})
			.setDescription(
				`${linkBox}\n` +
					`Credentials successfully associated. Quests will automatically execute against this session when triggered with **\`/quest start\`** or **\`c?start\`**.\n\n` +
					`◈ **AUTO-PILOT**: ${linked.autoComplete ? '`ACTIVE` · Background scanner will automatically detect and complete newly dropped quests.' : '`DISABLED` · Click **`AUTO: OFF`** below to automatically complete quests when they arrive.'}\n\n` +
					`Select **\`INITIALIZE\`** below to dispatch quests immediately.`,
			)
			.setFooter({
				text: `AERIX QUEST INFRASTRUCTURE · AUTHENTICATED`,
			});
	} else {
		const unlinkedBox =
			'```prolog\n' +
			`┌── ${toSmallCaps('CREDENTIAL REGISTRY')} ──────────────────────┐\n` +
			`│ STATUS     : UNLINKED\n` +
			`│ NOTICE     : NO CREDENTIALS ASSOCIATED       │\n` +
			`└──────────────────────────────────────────────┘\n` +
			'```';

		embed
			.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('ACCOUNT REGISTRY')}` })
			.setDescription(
				`${unlinkedBox}\n` +
					`Associate your account token to enable instant background quest execution without re-entering credentials.\n\n` +
					`Select **\`LINK ACCOUNT\`** below to open the secure authorization prompt.`,
			)
			.setFooter({
				text: `AERIX QUEST INFRASTRUCTURE · UNLINKED`,
			});
	}

	return embed;
}

export function createLinkActionRow(isLinked: boolean, autoComplete = false): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>();

	if (isLinked) {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId('btn_start_linked_quest')
				.setLabel('INITIALIZE')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('btn_toggle_auto')
				.setLabel(autoComplete ? 'AUTO: ON' : 'AUTO: OFF')
				.setStyle(autoComplete ? ButtonStyle.Success : ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('btn_open_link_modal')
				.setLabel('UPDATE CREDENTIALS')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('btn_unlink_account')
				.setLabel('UNLINK')
				.setStyle(ButtonStyle.Danger),
		);
	} else {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId('btn_open_link_modal')
				.setLabel('LINK ACCOUNT')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('btn_help_quest')
				.setLabel('DOCUMENTATION')
				.setStyle(ButtonStyle.Secondary),
		);
	}

	return row;
}

export function createChannelRestrictionEmbed(
	channelId: string,
	guildId?: string,
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('CHANNEL RESTRICTION')} ────────────────────┐\n` +
		`│ ACCESS RESTRICTED TO DESIGNATED CHANNEL      │\n` +
		'└──────────────────────────────────────────────┘\n' +
		'```';

	const embed = new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('ACCESS CONTROL')}` })
		.setDescription(
			`${headerBox}\n` +
				`Quest commands are not permitted in this channel.\n\n` +
				`If you want to use the quest bot, please use <#${channelId}>.`,
		)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · DESIGNATED CHANNEL ONLY`,
		});

	const components: ActionRowBuilder<ButtonBuilder>[] = [];
	if (guildId) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setLabel('GO TO CHANNEL')
				.setStyle(ButtonStyle.Link)
				.setURL(`https://discord.com/channels/${guildId}/${channelId}`),
		);
		components.push(row);
	}

	return { embed, components };
}

export function createChannelConfiguredEmbed(channelId: string): EmbedBuilder {
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('CHANNEL CONFIGURATION')} ──────────────────┐\n` +
		`│ STATUS     : DEDICATED CHANNEL ASSIGNED      │\n` +
		'└──────────────────────────────────────────────┘\n' +
		'```';

	return new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('ACCESS CONTROL')}` })
		.setDescription(
			`${headerBox}\n` +
				`Designated quest channel successfully set to <#${channelId}>.\n\n` +
				`All non-administrative quest commands are now restricted to that channel.`,
		)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · CONFIGURATION SAVED`,
		});
}

export function createChannelClearedEmbed(): EmbedBuilder {
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('CHANNEL CONFIGURATION')} ──────────────────┐\n` +
		`│ STATUS     : RESTRICTIONS CLEARED            │\n` +
		'└──────────────────────────────────────────────┘\n' +
		'```';

	return new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('ACCESS CONTROL')}` })
		.setDescription(
			`${headerBox}\n` +
				`Channel restriction removed.\n\n` +
				`Quest commands can now be executed across any permitted channel in this server.`,
		)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · CONFIGURATION SAVED`,
		});
}

export function createModeSelectionEmbed(): EmbedBuilder {
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('EXECUTION STRATEGY')} ────────────────────┐\n` +
		`│ SELECT QUEST COMPLETION DISPATCH MODE        │\n` +
		'└──────────────────────────────────────────────┘\n' +
		'```';

	return new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('DISPATCH MODE')}` })
		.setDescription(
			`${headerBox}\n` +
				`Choose how you want your Discord Quests to be processed:\n\n` +
				`◈ **ONE BY ONE** · *Sequential*\n` +
				`  └─ Processes quests one after another in order. Recommended for stability.\n\n` +
				`◈ **ALL AT ONCE** · *Concurrent*\n` +
				`  └─ Processes all eligible quests in parallel at the same time. Faster execution.\n\n` +
				`Select a strategy below to begin execution:`,
		)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · STRATEGY SELECTION`,
		});
}

export function createModeSelectionActionRow(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('btn_mode_one_by_one')
			.setLabel('ONE BY ONE')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('btn_mode_all_at_once')
			.setLabel('ALL AT ONCE')
			.setStyle(ButtonStyle.Secondary),
	);
}

export function createAutoToggleEmbed(
	account: LinkedAccount,
	enabled: boolean,
): EmbedBuilder {
	const headerBox =
		'```prolog\n' +
		`┌── ${toSmallCaps('AUTO-PILOT CONFIGURATION')} ───────────────┐\n` +
		`│ STATUS     : ${enabled ? 'ENABLED' : 'DISABLED'}\n` +
		`│ OPERATOR   : @${account.targetUser.username}\n` +
		`│ IDENTIFIER : ${account.targetUser.id}\n` +
		`│ STRATEGY   : ${(account.autoMode || 'one_by_one').toUpperCase().replace(/_/g, ' ')}\n` +
		`│ SCANNER    : ACTIVE (EVERY 20 MINUTES)\n` +
		'└──────────────────────────────────────────────┘\n' +
		'```';

	const desc = enabled
		? `${headerBox}\n` +
		  `Auto-Pilot is now **ACTIVE** on your account.\n\n` +
		  `Whenever new Discord Quests arrive, Aerix Quest will automatically detect and complete them in the background.\n` +
		  `You will receive direct notifications when quests are detected and when rewards are successfully claimed.`
		: `${headerBox}\n` +
		  `Auto-Pilot is now **DISABLED** on your account.\n\n` +
		  `New quests will not be completed automatically. You can initiate tasks manually with **\`/quest start\`** or **\`c?start\`**, or toggle Auto-Pilot back on anytime.`;

	return new EmbedBuilder()
		.setColor(THEME_PURPLE)
		.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('AUTO-PILOT CONTROLLER')}` })
		.setDescription(desc)
		.setFooter({
			text: `AERIX QUEST INFRASTRUCTURE · BACKGROUND DAEMON`,
		});
}

export function createAutoToggleActionRow(enabled: boolean): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('btn_toggle_auto')
			.setLabel(enabled ? 'AUTO: ON' : 'AUTO: OFF')
			.setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('btn_start_linked_quest')
			.setLabel('INITIALIZE NOW')
			.setStyle(ButtonStyle.Primary),
	);
}



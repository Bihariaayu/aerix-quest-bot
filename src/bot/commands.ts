import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	REST,
	Routes,
} from 'discord.js';

export const questCommand = new SlashCommandBuilder()
	.setName('quest')
	.setDescription('Discord Quest Auto-Completion utilities')
	.addSubcommand((sub) =>
		sub
			.setName('start')
			.setDescription('Start auto-completing Discord Quests on your account')
			.addStringOption((opt) =>
				opt
					.setName('mode')
					.setDescription('Execution strategy: one by one or all at same time')
					.setRequired(false)
					.addChoices(
						{ name: 'ONE BY ONE (Sequential · Recommended)', value: 'one_by_one' },
						{ name: 'ALL AT ONCE (Concurrent · Fast)', value: 'all_at_once' },
					),
			)
			.addStringOption((opt) =>
				opt
					.setName('token')
					.setDescription('Optional: Paste your personal Discord user token directly')
					.setRequired(false),
			),
	)
	.addSubcommand((sub) =>
		sub
			.setName('status')
			.setDescription('View the progress of your active or queued quest task'),
	)
	.addSubcommand((sub) =>
		sub
			.setName('stop')
			.setDescription('Cancel your running or queued quest auto-completion task'),
	)
	.addSubcommand((sub) =>
		sub
			.setName('panel')
			.setDescription('(Admin) Post an interactive quest station button in this channel'),
	)
	.addSubcommand((sub) =>
		sub
			.setName('setchannel')
			.setDescription('(Admin) Restrict quest commands to a dedicated channel')
			.addChannelOption((opt) =>
				opt
					.setName('channel')
					.setDescription('The channel to designate for quest commands')
					.setRequired(true),
			),
	)
	.addSubcommand((sub) =>
		sub
			.setName('clearchannel')
			.setDescription('(Admin) Remove the dedicated quest channel restriction'),
	)
	.addSubcommand((sub) =>
		sub
			.setName('help')
			.setDescription('Learn how to use the bot and safely get your Discord token'),
	);

export const helpCommand = new SlashCommandBuilder()
	.setName('help')
	.setDescription('View guide, token instructions, and safety information');

export const linkCommand = new SlashCommandBuilder()
	.setName('link')
	.setDescription('Link your Discord user account token so the bot can auto-complete quests for you')
	.addStringOption((opt) =>
		opt
			.setName('token')
			.setDescription('Optional: Paste your personal Discord user token directly')
			.setRequired(false),
	);

export const unlinkCommand = new SlashCommandBuilder()
	.setName('unlink')
	.setDescription('Unlink your Discord user account token from the bot');

export const setChannelCommand = new SlashCommandBuilder()
	.setName('setchannel')
	.setDescription('(Admin) Restrict quest commands to a dedicated channel')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.addChannelOption((opt) =>
		opt
			.setName('channel')
			.setDescription('The channel to designate for quest commands')
			.setRequired(true),
	);

export const clearChannelCommand = new SlashCommandBuilder()
	.setName('clearchannel')
	.setDescription('(Admin) Remove the dedicated quest channel restriction')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const allCommands = [
	questCommand.toJSON(),
	linkCommand.toJSON(),
	unlinkCommand.toJSON(),
	helpCommand.toJSON(),
	setChannelCommand.toJSON(),
	clearChannelCommand.toJSON(),
];

export async function registerCommands(
	botToken: string,
	clientId: string,
	guildIds: string[] = [],
): Promise<void> {
	const rest = new REST({ version: '10' }).setToken(botToken);
	try {
		console.log('Registering global application (slash) commands...');
		await rest.put(Routes.applicationCommands(clientId), {
			body: allCommands,
		});
		console.log('Successfully registered global application (slash) commands.');

		// Purge any guild-specific commands so Discord never displays duplicate slash commands!
		for (const guildId of guildIds) {
			try {
				await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
					body: [],
				});
			} catch {}
		}
	} catch (error) {
		console.error('Failed to register application commands:', error);
	}
}

export async function clearGuildCommands(
	botToken: string,
	clientId: string,
	guildId: string,
): Promise<void> {
	const rest = new REST({ version: '10' }).setToken(botToken);
	try {
		await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
			body: [],
		});
	} catch {}
}


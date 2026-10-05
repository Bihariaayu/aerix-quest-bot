import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GuildConfig {
	guildId: string;
	questChannelId?: string | null;
	updatedAt: string;
}

export class SettingsManager {
	private readonly filePath: string;
	private settings = new Map<string, GuildConfig>();

	constructor(dataDir?: string) {
		const dir = dataDir || path.resolve(process.cwd(), 'data');
		if (!fs.existsSync(dir)) {
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch {}
		}
		this.filePath = path.join(dir, 'guild_settings.json');
		this.load();
	}

	private load(): void {
		try {
			if (fs.existsSync(this.filePath)) {
				const content = fs.readFileSync(this.filePath, 'utf-8');
				const raw = JSON.parse(content) as GuildConfig[];
				this.settings = new Map(raw.map((g) => [g.guildId, g]));
			}
		} catch (err) {
			console.error('Failed to load guild settings file:', err);
			this.settings = new Map();
		}
	}

	private save(): void {
		try {
			const data = Array.from(this.settings.values());
			fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
		} catch (err) {
			console.error('Failed to save guild settings file:', err);
		}
	}

	public getQuestChannel(guildId: string): string | null {
		this.load();
		const config = this.settings.get(guildId);
		return config?.questChannelId || null;
	}

	public setQuestChannel(guildId: string, channelId: string): void {
		this.load();
		const config: GuildConfig = {
			guildId,
			questChannelId: channelId,
			updatedAt: new Date().toISOString(),
		};
		this.settings.set(guildId, config);
		this.save();
	}

	public clearQuestChannel(guildId: string): boolean {
		this.load();
		const config = this.settings.get(guildId);
		if (config && config.questChannelId) {
			config.questChannelId = null;
			config.updatedAt = new Date().toISOString();
			this.save();
			return true;
		}
		return false;
	}
}

export const settingsManager = new SettingsManager();

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Utils } from '../utils';
import type { TargetUserInfo } from './types';

export interface LinkedAccount {
	discordUserId: string;
	userToken: string;
	targetUser: TargetUserInfo;
	linkedAt: string;
}

export class LinkManager {
	private readonly filePath: string;
	private accounts: Map<string, LinkedAccount> = new Map();

	constructor(dataDir?: string) {
		const dir = dataDir || path.resolve(process.cwd(), 'data');
		if (!fs.existsSync(dir)) {
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch {}
		}
		this.filePath = path.join(dir, 'linked_accounts.json');
		this.load();
	}

	private load(): void {
		try {
			if (fs.existsSync(this.filePath)) {
				const content = fs.readFileSync(this.filePath, 'utf-8');
				const raw = JSON.parse(content) as LinkedAccount[];
				this.accounts = new Map(raw.map((a) => [a.discordUserId, a]));
			}
		} catch (err) {
			console.error('Failed to load linked accounts file:', err);
			this.accounts = new Map();
		}
	}

	private save(): void {
		try {
			const data = Array.from(this.accounts.values());
			fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
		} catch (err) {
			console.error('Failed to save linked accounts file:', err);
		}
	}

	public getLinkedAccount(discordUserId: string): LinkedAccount | null {
		this.load();
		return this.accounts.get(discordUserId) || null;
	}

	public hasLinkedAccount(discordUserId: string): boolean {
		this.load();
		return this.accounts.has(discordUserId);
	}

	public async linkAccount(discordUserId: string, userToken: string): Promise<LinkedAccount> {
		const clean = Utils.cleanToken(userToken);
		const validation = await Utils.validateUserToken(clean);
		if (!validation.valid || !validation.user) {
			throw new Error(validation.error || 'Invalid Discord user token.');
		}

		const linked: LinkedAccount = {
			discordUserId,
			userToken: clean,
			targetUser: validation.user,
			linkedAt: new Date().toISOString(),
		};

		this.accounts.set(discordUserId, linked);
		this.save();
		return linked;
	}

	public unlinkAccount(discordUserId: string): boolean {
		const existed = this.accounts.delete(discordUserId);
		if (existed) {
			this.save();
		}
		return existed;
	}

	public getCount(): number {
		return this.accounts.size;
	}
}

export const linkManager = new LinkManager();

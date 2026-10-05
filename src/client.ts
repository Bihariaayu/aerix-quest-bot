import { Client, APIGatewayBotInfo, WebhooksAPI } from '@discordjs/core';
import { RequestInit } from 'undici';
import { REST, DefaultRestOptions, ResponseLike } from '@discordjs/rest';
import { WebSocketManager, WebSocketShard } from '@discordjs/ws';
import { GatewaySendPayload, GatewayOpcodes } from 'discord-api-types/v10';
import { QuestManager } from './questManager';
import { AllQuestsResponse } from './interface';
import { Constants } from './constants';
import { Utils } from './utils';

async function makeRequest(
	url: string,
	init: RequestInit,
): Promise<ResponseLike> {
	// console.log(`Making request to ${url} with method ${init.method}...`);
	if (init.headers) {
		init.headers = Utils.makeHeaders(init.headers as any);
	}
	return DefaultRestOptions.makeRequest(url, init);
}

import { randomUUID } from 'node:crypto';

export interface QuestProgressEvent {
	type: 'started' | 'enrolled' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'info';
	questId?: string;
	questName?: string;
	taskName?: string;
	secondsDone?: number;
	secondsNeeded?: number;
	percent?: number;
	message: string;
}

const originalSend = WebSocketShard.prototype.send;
WebSocketShard.prototype.send = async function (payload: GatewaySendPayload) {
	if (
		payload.op === GatewayOpcodes.Identify &&
		Boolean((this as any).strategy?.manager?.isUserQuest || (this as any).isUserQuest)
	) {
		payload.d = {
			token: payload.d.token,
			properties: {
				...Constants.Properties,
				client_launch_id: randomUUID(),
				launch_signature: randomUUID(),
				client_heartbeat_session_id: randomUUID(),
				is_fast_connect: false,
				gateway_connect_reasons: 'AppSkeleton',
			},
			capabilities: 0,
			presence: payload.d.presence,
			compress: payload.d.compress,
			client_state: {
				guild_versions: {},
			},
		} as any;
	}
	return originalSend.call(this, payload);
};

export class ClientQuest extends Client {
	public questManager: QuestManager | null = null;
	public websocketManager: WebSocketManager;
	public webhook = new WebhooksAPI(new REST());
	#webhookId: string | null = null;
	#webhookToken: string | null = null;
	constructor(token: string) {
		if (!token) {
			throw new Error('Token is required to initialize the client.');
		}
		const rest = new REST({ version: '10', makeRequest }).setToken(token);
		rest.on('rateLimited', (info: any) => {
			console.warn(
				`\n[RateLimit]\n` +
					`  -> Route: ${info.method} ${info.route}\n` +
					`  -> Scope: ${info.scope}${info.global ? ' (Global)' : ''}\n` +
					`  -> Limit: ${info.limit} requests\n` +
					`  -> Retry after: ${info.retryAfter}ms (${(info.retryAfter / 1000).toFixed(2)}s)\n`,
			);
		});
		const gateway = new WebSocketManager({
			token: token,
			intents: 0,
			rest,
			readyTimeout: 120_000,
		});
		(gateway as any).isUserQuest = true;
		gateway.fetchGatewayInformation = (
			force?: boolean,
		): Promise<APIGatewayBotInfo> => {
			return Promise.resolve({
				url: 'wss://gateway.discord.gg',
				shards: 1,
				session_start_limit: {
					total: 1000,
					remaining: 1000,
					reset_after: 14400000,
					max_concurrency: 1,
				},
			});
		};
		super({ rest, gateway });
		this.websocketManager = gateway;
		gateway.on('error', () => null);
	}
	public onProgress?: (event: QuestProgressEvent) => void;
	private _abortController = new AbortController();

	public get abortSignal(): AbortSignal {
		return this._abortController.signal;
	}

	public get isAborted(): boolean {
		return this._abortController.signal.aborted;
	}

	public abort() {
		this._abortController.abort();
		return this.destroy();
	}

	public emitProgress(event: QuestProgressEvent) {
		try {
			this.onProgress?.(event);
		} catch (err) {
			console.error('Error in onProgress callback:', err);
		}
	}

	async connect() {
		await Promise.allSettled([
			Utils.updateLatestBuildVersion(),
			this.setupWebhook(),
		]);
		try {
			await this.websocketManager.connect();
		} catch (e: any) {
			console.error('Error during client connection:', e.message);
			this.sendWebhookMessage('Error during client connection: ' + e.message);
			throw e;
		}
	}
	destroy() {
		this._abortController.abort();
		return this.websocketManager.destroy();
	}
	setupWebhook() {
		return Utils.extractWebhookInfo().then((info) => {
			if (info) {
				this.#webhookId = info.id;
				this.#webhookToken = info.token;
				console.log('Webhook setup complete.');
			}
		});
	}
	fetchQuests(fetchExcludedQuests = false) {
		return this.rest
			.get('/quests/@me')
			.then((response) =>
				QuestManager.fromResponse(
					this,
					response as AllQuestsResponse,
					fetchExcludedQuests,
				),
			)
			.then((manager) => {
				this.questManager = manager;
				return manager;
			});
	}
	sendWebhookMessage(content: string) {
		if (this.#webhookId && this.#webhookToken) {
			this.webhook
				.execute(this.#webhookId, this.#webhookToken, {
					content,
				})
				.catch(() => {});
		}
	}
	emitQuestCompleted(questId: string, questName?: string) {
		this.emitProgress({
			type: 'completed',
			questId,
			questName,
			message: `Quest completed: ${questName || questId}`,
		});
		return this.sendWebhookMessage(
			`[Quest Completed!](https://discord.com/quests/${questId})`,
		);
	}
}

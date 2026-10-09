import { Client, APIGatewayBotInfo, WebhooksAPI } from '@discordjs/core';
import { RequestInit, Agent, setGlobalDispatcher } from 'undici';
import { REST, DefaultRestOptions, ResponseLike } from '@discordjs/rest';
import { WebSocketManager, WebSocketShard } from '@discordjs/ws';
import { GatewaySendPayload, GatewayOpcodes } from 'discord-api-types/v10';
import { QuestManager } from './questManager';
import { AllQuestsResponse } from './interface';
import { Constants } from './constants';
import { Utils } from './utils';

export const customAgent = new Agent({
	connect: {
		timeout: 30_000,
		keepAlive: true,
	},
	headersTimeout: 30_000,
	bodyTimeout: 30_000,
});
setGlobalDispatcher(customAgent);

export function isRetryableNetworkError(err: any): boolean {
	if (!err) return false;
	const msg = (err.message || '').toLowerCase();
	const name = (err.name || '').toLowerCase();
	const code = (err.code || '').toLowerCase();

	return (
		name === 'connecttimeouterror' ||
		code === 'und_err_connect_timeout' ||
		code === 'und_err_socket' ||
		code === 'und_err_headers_timeout' ||
		code === 'und_err_body_timeout' ||
		code === 'econnreset' ||
		code === 'etimedout' ||
		code === 'eai_again' ||
		code === 'enotfound' ||
		msg.includes('connect timeout') ||
		msg.includes('connection timeout') ||
		msg.includes('econnreset') ||
		msg.includes('etimedout') ||
		msg.includes('socket hung up') ||
		msg.includes('opening handshake has timed out') ||
		msg.includes('fetch failed')
	);
}

export async function makeRequest(
	url: string,
	init: RequestInit,
): Promise<ResponseLike> {
	if (init.headers) {
		init.headers = Utils.makeHeaders(init.headers as any);
	}
	(init as any).dispatcher = customAgent;

	let lastError: any = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			return await DefaultRestOptions.makeRequest(url, init);
		} catch (err: any) {
			lastError = err;
			if (attempt < 3 && isRetryableNetworkError(err)) {
				const delay = attempt * 1500;
				console.warn(
					`[Network Retry] Transient connection error on ${url}: ${err.message}. Retrying (${attempt}/3) in ${delay}ms...`,
				);
				await new Promise((r) => setTimeout(r, delay));
				continue;
			}
			throw err;
		}
	}
	throw lastError;
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
	public webhook = new WebhooksAPI(new REST({ version: '10', timeout: 30_000, agent: customAgent as any, makeRequest }));
	#webhookId: string | null = null;
	#webhookToken: string | null = null;
	constructor(token: string) {
		if (!token) {
			throw new Error('Token is required to initialize the client.');
		}
		const rest = new REST({ version: '10', timeout: 30_000, agent: customAgent as any, makeRequest }).setToken(token);
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

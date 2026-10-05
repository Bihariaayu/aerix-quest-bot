import { Constants } from './constants';
import { fetch } from 'undici';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import type { ClientQuest } from './client';

export class Utils extends null {
	public static makeHeaders(init: HeadersInit | undefined) {
		let myHeaders = new Headers(init);
		const isAndroidRequest = myHeaders.get('AndroidRequest') === 'true';
		const authHeader = myHeaders.get('Authorization');
		if (authHeader) {
			myHeaders.set(
				'Authorization',
				authHeader.replace(/^Bot\s+/i, ''),
			);
		}
		myHeaders.append('accept-language', 'en-US');
		myHeaders.append('x-debug-options', 'bugReporterEnabled');
		myHeaders.append('x-discord-locale', 'en-US');
		myHeaders.append('x-discord-timezone', 'Asia/Saigon');
		if (isAndroidRequest) {
			myHeaders = Utils.mergeHeaders(
				myHeaders,
				Utils.makeAndroidHeaders(true),
			);
		} else {
			myHeaders = Utils.mergeHeaders(
				myHeaders,
				Utils.makeDesktopHeaders(true, true),
			);
		}
		return myHeaders;
	}
	public static makeDesktopHeaders(
		withDiscordClientProperties = true,
		withOriginAndReferer = true,
	) {
		const myHeaders = new Headers();
		myHeaders.append('accept-language', 'vi');
		myHeaders.append('User-Agent', Constants.USER_AGENT);
		if (withOriginAndReferer) {
			myHeaders.append('origin', 'https://discord.com');
			myHeaders.append('referer', 'https://discord.com/channels/@me');
		}
		myHeaders.append('pragma', 'no-cache');
		myHeaders.append('priority', 'u=1, i');
		myHeaders.append(
			'sec-ch-ua',
			'"Not)A;Brand";v="8", "Chromium";v="138"',
		);
		myHeaders.append('sec-ch-ua-mobile', '?0');
		myHeaders.append('sec-ch-ua-platform', '"Windows"');
		myHeaders.append('sec-fetch-dest', 'empty');
		myHeaders.append('sec-fetch-mode', 'cors');
		myHeaders.append('sec-fetch-site', 'same-origin');
		if (withDiscordClientProperties) {
			myHeaders.append(
				'x-super-properties',
				Buffer.from(JSON.stringify(Constants.Properties)).toString(
					'base64',
				),
			);
		}
		return myHeaders;
	}
	public static makeAndroidHeaders(withDiscordClientProperties = true) {
		const myHeaders = new Headers();
		myHeaders.append('accept-language', 'vi');
		myHeaders.append('User-Agent', Constants.ANDROID_USER_AGENT);
		if (withDiscordClientProperties) {
			myHeaders.append(
				'x-super-properties',
				Buffer.from(
					JSON.stringify(Constants.ANDROID_Properties),
				).toString('base64'),
			);
		}
		return myHeaders;
	}
	public static mergeHeaders(a: Headers, b: Headers) {
		const result = new Headers(a);
		b.forEach((value, key) => {
			result.set(key, value);
		});
		return result;
	}
	public static async getProxyTicket(
		applicationId: string,
		client: ClientQuest,
	): Promise<string> {
		// https://discord.com/api/v9/applications/1495767543946809424/proxy-tickets
		const ticket = (await client.rest.post(
			`/applications/${applicationId}/proxy-tickets`,
			{
				body: {},
			},
		)) as {
			ticket: string;
			expires_at: string;
			application_id: string;
			user_id: string;
		};
		return ticket.ticket;
	}
	public static async getActivityReferrer(
		applicationId: string,
		client: ClientQuest,
	): Promise<string> {
		const proxyTicket = await Utils.getProxyTicket(applicationId, client);
		const referrer = new URL(`https://${applicationId}.discordsays.com/`);

		referrer.searchParams.set('instance_id', 'example-cl-instance');
		referrer.searchParams.set('platform', 'desktop');
		referrer.searchParams.set('discord_proxy_ticket', proxyTicket);

		return referrer.toString();
	}
	public static getActivityHeaders(
		questId: string,
		authToken: string = '',
		activityReferrer?: string,
	): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'X-Auth-Token': authToken,
			'X-Discord-Quest-ID': questId,
		};
		if (activityReferrer) {
			headers.Referer = activityReferrer;
		}
		return headers;
	}

	public static async authorizeDiscordSays(
		applicationId: string,
		questId: string,
		authCode: string,
		client: ClientQuest,
	): Promise<{
		token: string | false;
		error: any;
		activityReferrer: string;
	}> {
		let error = null;
		const headers = Utils.makeDesktopHeaders(false, false);
		const activityReferrer = await Utils.getActivityReferrer(
			applicationId,
			client,
		);
		const discordSaysHeaders = Utils.getActivityHeaders(
			questId,
			'',
			activityReferrer,
		);
		for (const [key, value] of Object.entries(discordSaysHeaders)) {
			headers.append(key, value);
		}
		const token = await fetch(
			`https://${applicationId}.discordsays.com/.proxy/acf/authorize`,
			{
				body: JSON.stringify({ code: authCode }),
				method: 'POST',
				headers,
			},
		)
			.then(
				(res) =>
					res.json() as any as {
						token: string;
					},
			)
			.then((data) => data.token)
			.catch((e) => {
				console.error('Error authorizing with Discord Says:', e);
				error = e instanceof Error ? e.message : String(e);
				return '';
			});
		return { token, error, activityReferrer };
	}
	public static async progressDiscordSays(
		applicationId: string,
		questId: string,
		token: string,
		questTarget: number,
		activityReferrer: string,
	): Promise<{ success: boolean; error: any }> {
		let error = null;
		const headers = Utils.makeDesktopHeaders(false, false);
		const discordSaysHeaders = Utils.getActivityHeaders(
			questId,
			token,
			activityReferrer,
		);
		for (const [key, value] of Object.entries(discordSaysHeaders)) {
			headers.append(key, value);
		}
		const success = await fetch(
			`https://${applicationId}.discordsays.com/.proxy/acf/quest/progress`,
			{
				headers,
				body: JSON.stringify({ progress: questTarget }),
				method: 'POST',
			},
		)
			.then((res) => res.ok)
			.catch((e) => {
				error = e instanceof Error ? e.message : String(e);
				return false;
			});
		return { success, error };
	}
	public static async askQuestion(promptText: string): Promise<string> {
		const rl = readline.createInterface({ input, output });
		try {
			const answer = await rl.question(promptText);
			return answer;
		} finally {
			rl.close();
		}
	}
	private static lastBuildUpdate = 0;
	public static async updateLatestBuildVersion(): Promise<void> {
		if (
			Date.now() - Utils.lastBuildUpdate < 3600000 &&
			Constants.Properties.client_build_number > 0
		) {
			return;
		}
		try {
			console.info(
				'Fetching latest Discord build number (Desktop Version)...',
			);
			const response = await fetch('https://discord.com/app', {
				headers: { 'User-Agent': Constants.USER_AGENT },
			});
			if (!response.ok) {
				console.warn(
					`Failed to fetch Discord page (${response.status})`,
				);
				return;
			}
			const html = await response.text();
			// Find JS asset files
			let scripts = Array.from(
				html.match(/\/assets\/web.([a-f0-9]+)\.js/g) || [],
			);
			if (!scripts || scripts.length === 0) {
				console.warn('No JS assets found in HTML.');
				return;
			}

			for (const scriptPath of scripts) {
				try {
					const assetUrl = `https://discord.com${scriptPath}`;

					const assetResponse = await fetch(assetUrl, {
						headers: { 'User-Agent': Constants.USER_AGENT },
					});
					if (!assetResponse.ok) continue;
					const jsContent = await assetResponse.text();
					const match = jsContent.match(
						/buildNumber["\s:]+["\s]*(\d{5,7})/,
					);
					if (match) {
						const buildNumber = parseInt(match[1], 10);
						console.log(`Build number: ${buildNumber}`);
						Constants.Properties.client_build_number = buildNumber;
						Utils.lastBuildUpdate = Date.now();
						return;
					}
				} catch {
					continue;
				}
			}
			console.warn('Build number not found in any JS assets.');
			return;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error('Error fetching latest build number:', errorMessage);
			return;
		}
	}
	public static cleanToken(raw: string): string {
		let token = raw.trim();
		// Remove markdown code blocks e.g. ```token``` or `token`
		token = token.replace(/^```[a-z]*\n?|```$/gi, '').trim();
		token = token.replace(/^`+|`+$/g, '').trim();
		// Remove quotes
		token = token.replace(/^["']+|["']+$/g, '').trim();
		// Remove common label prefixes if copied directly
		token = token.replace(/^(authorization|token|auth)\s*:\s*/i, '').trim();
		// Remove Bot or Bearer prefixes
		token = token.replace(/^(Bot|Bearer)\s+/i, '').trim();
		// Remove quotes again if inside label
		token = token.replace(/^["']+|["']+$/g, '').trim();
		return token;
	}

	public static async validateUserToken(token: string): Promise<{
		valid: boolean;
		user?: {
			id: string;
			username: string;
			discriminator: string;
			avatar: string | null;
			global_name?: string | null;
		};
		error?: string;
	}> {
		const clean = Utils.cleanToken(token);
		if (!clean) {
			return { valid: false, error: 'Token is empty.' };
		}
		try {
			const res = await fetch('https://discord.com/api/v10/users/@me', {
				headers: {
					Authorization: clean,
					'User-Agent': Constants.USER_AGENT,
					origin: 'https://discord.com',
					referer: 'https://discord.com/channels/@me',
				},
			});
			if (res.status === 200) {
				const user = (await res.json()) as any;
				return {
					valid: true,
					user: {
						id: user.id,
						username: user.username,
						discriminator: user.discriminator,
						avatar: user.avatar,
						global_name: user.global_name,
					},
				};
			}
			if (res.status === 401) {
				// Check if the user accidentally provided a bot token instead of user token
				try {
					const botRes = await fetch('https://discord.com/api/v10/users/@me', {
						headers: {
							Authorization: 'Bot ' + clean,
						},
					});
					if (botRes.status === 200) {
						const botUser = (await botRes.json()) as any;
						return {
							valid: false,
							error: `You entered the Discord BOT token for @${botUser.username}! Discord Quests require your personal Discord user account token, not the bot's token. Use /help to see how to get your user token.`,
						};
					}
				} catch {}

				return {
					valid: false,
					error: 'Invalid Discord account token (401 Unauthorized). Make sure you copied your personal user token from DevTools (F12) while logged in, not the bot token.',
				};
			}
			return { valid: false, error: `Discord API returned status ${res.status}` };
		} catch (e: any) {
			return { valid: false, error: e.message || 'Failed to connect to Discord API.' };
		}
	}
	public static async extractWebhookInfo(): Promise<{
		id: string;
		token: string;
	} | null> {
		const webhookUrl = process.env.WEBHOOK_URL;
		if (!webhookUrl) {
			console.warn('WEBHOOK_URL not set in environment variables.');
			return null;
		}
		// Check valid
		const req = await fetch(webhookUrl);
		if (!req.ok) {
			console.warn(`Failed to fetch webhook URL (${req.status})`);
			return null;
		}
		const parts = webhookUrl.split('/');
		const webhookPathIndex = parts.findIndex((part) => part === 'webhooks');
		if (webhookPathIndex === -1 || parts.length < webhookPathIndex + 3) {
			console.warn('Invalid webhook URL format.');
			return null;
		}
		const id = parts[webhookPathIndex + 1];
		const token = parts[webhookPathIndex + 2];
		return { id, token };
	}
}

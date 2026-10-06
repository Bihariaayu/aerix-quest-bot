import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { EmbedBuilder, Client as DiscordClient } from 'discord.js';
import { ClientQuest } from '../client';
import { Utils } from '../utils';
import { linkManager } from './linkManager';
import { toSmallCaps, THEME_PURPLE } from './embeds';
import type { QuestUserTask, QuestItemProgress, TaskStatus, ExecutionMode, TargetUserInfo } from './types';
import type { QuestTaskConfigType } from '../interface';

export interface PersistedTask {
	id: string;
	userId: string;
	discordTag: string;
	userToken: string;
	targetUser: TargetUserInfo;
	status: 'queued' | 'running';
	mode: ExecutionMode;
	startedAt: string;
}

export class TaskManager {
	private readonly maxConcurrent: number;
	private readonly filePath: string;
	private readonly runningTasks = new Map<string, QuestUserTask>();
	private readonly queuedTasks: QuestUserTask[] = [];
	private readonly completedTaskHistory = new Map<string, QuestUserTask>();

	constructor(maxConcurrent?: number, dataDir?: string) {
		const envMax = Number(process.env.MAX_CONCURRENT_USERS);
		this.maxConcurrent = maxConcurrent ?? (Number.isInteger(envMax) && envMax > 0 ? envMax : 5);

		const dir = dataDir || path.resolve(process.cwd(), 'data');
		if (!fs.existsSync(dir)) {
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch {}
		}
		this.filePath = path.join(dir, 'active_tasks.json');
	}

	public getMaxConcurrent(): number {
		return this.maxConcurrent;
	}

	public getRunningCount(): number {
		return this.runningTasks.size;
	}

	public getQueueLength(): number {
		return this.queuedTasks.length;
	}

	public getTask(userId: string): QuestUserTask | undefined {
		return (
			this.runningTasks.get(userId) ||
			this.queuedTasks.find((t) => t.userId === userId) ||
			this.completedTaskHistory.get(userId)
		);
	}

	public getQueuePosition(userId: string): number {
		const index = this.queuedTasks.findIndex((t) => t.userId === userId);
		return index >= 0 ? index + 1 : 0;
	}

	private saveActiveTasks(): void {
		try {
			const persisted: PersistedTask[] = [];

			for (const task of this.runningTasks.values()) {
				if (task.status === 'running' && task.userToken) {
					persisted.push({
						id: task.id,
						userId: task.userId,
						discordTag: task.discordTag,
						userToken: task.userToken,
						targetUser: task.targetUser,
						status: 'running',
						mode: task.mode || 'one_by_one',
						startedAt: task.startedAt?.toISOString() || new Date().toISOString(),
					});
				}
			}

			for (const task of this.queuedTasks) {
				if (task.status === 'queued' && task.userToken) {
					persisted.push({
						id: task.id,
						userId: task.userId,
						discordTag: task.discordTag,
						userToken: task.userToken,
						targetUser: task.targetUser,
						status: 'queued',
						mode: task.mode || 'one_by_one',
						startedAt: task.startedAt?.toISOString() || new Date().toISOString(),
					});
				}
			}

			fs.writeFileSync(this.filePath, JSON.stringify(persisted, null, 2), 'utf-8');
		} catch (err: any) {
			console.error('[TaskManager] Failed to save active tasks to disk:', err.message);
		}
	}

	public async gracefulShutdown(): Promise<void> {
		console.log('[TaskManager] Performing graceful shutdown of active quest tasks...');
		this.saveActiveTasks();

		// Abort running gateway clients cleanly
		for (const task of this.runningTasks.values()) {
			try {
				task.clientQuest?.abort();
			} catch {}
		}
	}

	public async restoreTasks(discordClient?: DiscordClient): Promise<number> {
		if (!fs.existsSync(this.filePath)) return 0;

		let persisted: PersistedTask[] = [];
		try {
			const raw = fs.readFileSync(this.filePath, 'utf-8');
			persisted = JSON.parse(raw);
		} catch (err: any) {
			console.error('[TaskManager] Could not read active_tasks.json for recovery:', err.message);
			return 0;
		}

		if (!Array.isArray(persisted) || persisted.length === 0) {
			return 0;
		}

		console.log(`[Recovery] Found ${persisted.length} interrupted task(s) from previous daemon session. Resuming...`);

		let restoredCount = 0;
		for (const item of persisted) {
			// Don't duplicate if already running or queued
			if (this.runningTasks.has(item.userId) || this.queuedTasks.some((t) => t.userId === item.userId)) {
				continue;
			}

			// Validate token (fallback to linkManager if wiped)
			let token = item.userToken;
			if (!token) {
				const linked = linkManager.getLinkedAccount(item.userId);
				if (linked?.userToken) {
					token = linked.userToken;
				}
			}

			if (!token) {
				console.warn(`[Recovery] Skipping task for @${item.discordTag}: No credentials available.`);
				continue;
			}

			try {
				console.log(`[Recovery] Resuming quest task for @${item.discordTag} (${item.userId}) [Mode: ${item.mode}]...`);

				// Notify user in DM that their quest has resumed after restart
				if (discordClient) {
					try {
						const user = await discordClient.users.fetch(item.userId);
						const headerBox =
							'```prolog\n' +
							`┌── ${toSmallCaps('SERVICE RECOVERY')} ───────────────────────┐\n` +
							`│ RESUMING UNFINISHED QUEST EXECUTION          │\n` +
							'└──────────────────────────────────────────────┘\n' +
							'```';

						const recoveryEmbed = new EmbedBuilder()
							.setColor(THEME_PURPLE)
							.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('AUTO RECOVERY')}` })
							.setDescription(
								`${headerBox}\n` +
									`The bot service has restarted or updated.\n\n` +
									`Your quest auto-completion task has been **automatically resumed** in the background.\n` +
									`Any remaining uncompleted quests will be finished as scheduled.`,
							)
							.setFooter({ text: `AERIX QUEST INFRASTRUCTURE · RESILIENCE ENGINE` });

						await user.send({ embeds: [recoveryEmbed] });
					} catch {}
				}

				// Launch the task
				await this.startTask(
					item.userId,
					item.discordTag,
					token,
					async (task) => {
						if (task.status === 'completed' && discordClient) {
							try {
								const user = await discordClient.users.fetch(item.userId);
								const completeBox =
									'```prolog\n' +
									`┌── ${toSmallCaps('EXECUTION SUCCESS')} ─────────────────────┐\n` +
									`│ ALL ELIGIBLE QUESTS COMPLETED                │\n` +
									'└──────────────────────────────────────────────┘\n' +
									'```';

								const completeEmbed = new EmbedBuilder()
									.setColor(THEME_PURPLE)
									.setAuthor({ name: `AERIX QUEST · ${toSmallCaps('RECOVERY SUCCESS')}` })
									.setDescription(
										`${completeBox}\n` +
											`All **${task.totalQuests}** quest(s) have been successfully completed.\n` +
											`Rewards have been accredited to your Discord account.`,
									)
									.setFooter({ text: `AERIX QUEST INFRASTRUCTURE · COMPLETED` });

								await user.send({ embeds: [completeEmbed] });
							} catch {}
						}
					},
					item.mode || 'one_by_one',
				);

				restoredCount++;
			} catch (err: any) {
				console.error(`[Recovery] Failed to resume task for @${item.discordTag}:`, err.message);
			}
		}

		// Save updated state
		this.saveActiveTasks();
		return restoredCount;
	}

	public async startTask(
		userId: string,
		discordTag: string,
		userToken: string,
		onUpdate?: (task: QuestUserTask) => void,
		mode: ExecutionMode = 'one_by_one',
	): Promise<QuestUserTask> {
		// Check if user already has an active or queued task
		const existing = this.runningTasks.get(userId) || this.queuedTasks.find((t) => t.userId === userId);
		if (existing) {
			throw new Error('You already have an active or queued quest task. Use `/quest status` or `/quest stop`.');
		}

		// Validate user token first
		const clean = Utils.cleanToken(userToken);
		const validation = await Utils.validateUserToken(clean);
		if (!validation.valid || !validation.user) {
			throw new Error(validation.error || 'Invalid Discord user token.');
		}

		const task: QuestUserTask = {
			id: randomUUID(),
			userId,
			discordTag,
			userToken: clean,
			targetUser: validation.user,
			status: 'queued',
			mode,
			quests: [],
			completedQuests: 0,
			totalQuests: 0,
			onUpdate,
		};

		if (this.runningTasks.size < this.maxConcurrent) {
			this.runningTasks.set(userId, task);
			this.saveActiveTasks();
			this.runTask(task);
		} else {
			this.queuedTasks.push(task);
			task.status = 'queued';
			this.saveActiveTasks();
			task.onUpdate?.(task);
		}

		return task;
	}

	public stopTask(userId: string): boolean {
		// Check running tasks
		const running = this.runningTasks.get(userId);
		if (running) {
			running.status = 'cancelled';
			running.endedAt = new Date();
			try {
				running.clientQuest?.abort();
			} catch {}
			this.runningTasks.delete(userId);
			this.completedTaskHistory.set(userId, running);
			running.userToken = '';
			running.clientQuest = undefined;
			this.saveActiveTasks();
			running.onUpdate?.(running);
			this.processQueue();
			return true;
		}

		// Check queued tasks
		const queueIndex = this.queuedTasks.findIndex((t) => t.userId === userId);
		if (queueIndex >= 0) {
			const [queued] = this.queuedTasks.splice(queueIndex, 1);
			queued.status = 'cancelled';
			queued.endedAt = new Date();
			queued.userToken = '';
			this.completedTaskHistory.set(userId, queued);
			this.saveActiveTasks();
			queued.onUpdate?.(queued);
			return true;
		}

		return false;
	}

	private processQueue(): void {
		while (this.runningTasks.size < this.maxConcurrent && this.queuedTasks.length > 0) {
			const nextTask = this.queuedTasks.shift();
			if (nextTask && nextTask.status === 'queued') {
				this.runningTasks.set(nextTask.userId, nextTask);
				this.saveActiveTasks();
				this.runTask(nextTask);
			}
		}
	}

	private isCancelled(task: QuestUserTask): boolean {
		return (task.status as TaskStatus) === 'cancelled';
	}

	private async runTask(task: QuestUserTask): Promise<void> {
		task.status = 'running';
		task.startedAt = new Date();
		task.onUpdate?.(task);

		let client: ClientQuest | null = null;
		try {
			client = new ClientQuest(task.userToken);
			task.clientQuest = client;

			// Handle progress events
			client.onProgress = (event) => {
				const questItem = task.quests.find((q) => q.id === event.questId);
				if (questItem) {
					if (event.type === 'progress') {
						questItem.status = 'in_progress';
						if (event.secondsDone !== undefined) questItem.secondsDone = event.secondsDone;
						if (event.secondsNeeded !== undefined) questItem.secondsNeeded = event.secondsNeeded;
						if (event.percent !== undefined) questItem.percent = event.percent;
						if (event.message) questItem.details = event.message;
					} else if (event.type === 'completed') {
						questItem.status = 'completed';
						questItem.percent = 100;
						questItem.details = 'Completed!';
					} else if (event.type === 'failed') {
						questItem.status = 'failed';
						questItem.details = event.message;
					}
				}

				if (event.type === 'completed') {
					task.completedQuests = task.quests.filter((q) => q.status === 'completed').length;
				}

				task.onUpdate?.(task);
			};

			// Connect client and wait for Ready
			await new Promise<void>((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					reject(new Error('Connection timed out waiting for Discord Gateway.'));
				}, 60_000);

				client!.once(GatewayDispatchEvents.Ready, () => {
					clearTimeout(timeoutId);
					resolve();
				});

				client!.connect().catch((err) => {
					clearTimeout(timeoutId);
					reject(err);
				});
			});

			if (this.isCancelled(task)) return;

			// Fetch quests
			await client.fetchQuests(false);
			const validQuests = client.questManager!.filterQuestsValidToDo();

			task.quests = validQuests.map((q) => {
				const taskConfig = q.config.task_config_v2;
				const taskName = [
					'WATCH_VIDEO',
					'PLAY_ON_DESKTOP',
					'PLAY_ON_XBOX',
					'PLAY_ON_PLAYSTATION',
					'STREAM_ON_DESKTOP',
					'PLAY_ACTIVITY',
					'WATCH_VIDEO_ON_MOBILE',
					'ACHIEVEMENT_IN_ACTIVITY',
				].find(
					(x) => taskConfig?.tasks?.[x as QuestTaskConfigType] != null,
				) || 'UNKNOWN';

				const target = taskConfig?.tasks?.[taskName as QuestTaskConfigType]?.target || 0;
				const current = (q.userStatus?.progress as any)?.[taskName]?.value || 0;
				const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

				return {
					id: q.id,
					name: q.config.messages.quest_name,
					taskType: taskName,
					status: 'pending',
					secondsDone: current,
					secondsNeeded: target,
					percent,
				};
			});

			task.totalQuests = task.quests.length;
			task.completedQuests = task.quests.filter((q) => q.status === 'completed').length;
			task.onUpdate?.(task);

			if (validQuests.length === 0) {
				task.status = 'completed';
				return;
			}

			// Process valid quests according to selected mode
			if (task.mode === 'one_by_one') {
				// Sequential: execute quests one by one in order
				for (const quest of validQuests) {
					if (this.isCancelled(task)) break;
					const questItem = task.quests.find((q) => q.id === quest.id);
					if (questItem) questItem.status = 'in_progress';
					task.onUpdate?.(task);
					try {
						await client!.questManager!.doingQuest(quest);
						if (questItem && quest.isCompleted()) {
							questItem.status = 'completed';
							questItem.percent = 100;
						}
					} catch (err: any) {
						if (questItem) {
							questItem.status = 'failed';
							questItem.details = err?.message || 'Error executing quest';
						}
					}
					task.completedQuests = task.quests.filter((q) => q.status === 'completed').length;
					task.onUpdate?.(task);
				}
			} else {
				// Concurrent: execute all quests at the same time
				await Promise.allSettled(
					validQuests.map(async (quest) => {
						if (this.isCancelled(task)) return;
						const questItem = task.quests.find((q) => q.id === quest.id);
						if (questItem) questItem.status = 'in_progress';
						task.onUpdate?.(task);
						try {
							await client!.questManager!.doingQuest(quest);
							if (questItem && quest.isCompleted()) {
								questItem.status = 'completed';
								questItem.percent = 100;
							}
						} catch (err: any) {
							if (questItem) {
								questItem.status = 'failed';
								questItem.details = err?.message || 'Error executing quest';
							}
						}
						task.completedQuests = task.quests.filter((q) => q.status === 'completed').length;
						task.onUpdate?.(task);
					}),
				);
			}

			if (!this.isCancelled(task)) {
				task.status = 'completed';
				task.completedQuests = task.quests.filter((q) => q.status === 'completed').length;
			}
		} catch (err: any) {
			if (!this.isCancelled(task)) {
				task.status = 'failed';
				task.errorMessage = err?.message || 'An error occurred while executing quests.';
			}
		} finally {
			task.endedAt = new Date();
			try {
				await client?.destroy();
			} catch {}
			task.userToken = ''; // Security cleanup
			task.clientQuest = undefined;
			this.runningTasks.delete(task.userId);
			this.completedTaskHistory.set(task.userId, task);
			this.saveActiveTasks();
			task.onUpdate?.(task);
			this.processQueue();
		}
	}
}

export const taskManager = new TaskManager();

import { randomUUID } from 'node:crypto';
import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from '../client';
import { Utils } from '../utils';
import type { QuestUserTask, QuestItemProgress, TaskStatus } from './types';
import type { QuestTaskConfigType } from '../interface';

export class TaskManager {
	private readonly maxConcurrent: number;
	private readonly runningTasks = new Map<string, QuestUserTask>();
	private readonly queuedTasks: QuestUserTask[] = [];
	private readonly completedTaskHistory = new Map<string, QuestUserTask>();

	constructor(maxConcurrent?: number) {
		const envMax = Number(process.env.MAX_CONCURRENT_USERS);
		this.maxConcurrent = maxConcurrent ?? (Number.isInteger(envMax) && envMax > 0 ? envMax : 5);
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

	public async startTask(
		userId: string,
		discordTag: string,
		userToken: string,
		onUpdate?: (task: QuestUserTask) => void,
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
			quests: [],
			completedQuests: 0,
			totalQuests: 0,
			onUpdate,
		};

		if (this.runningTasks.size < this.maxConcurrent) {
			this.runningTasks.set(userId, task);
			this.runTask(task);
		} else {
			this.queuedTasks.push(task);
			task.status = 'queued';
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

			// Process valid quests concurrently
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
				}),
			);

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
			task.onUpdate?.(task);
			this.processQueue();
		}
	}
}

export const taskManager = new TaskManager();

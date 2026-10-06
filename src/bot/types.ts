import type { ClientQuest } from '../client';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
export type ExecutionMode = 'one_by_one' | 'all_at_once';

export interface QuestItemProgress {
	id: string;
	name: string;
	taskType: string;
	status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
	secondsDone: number;
	secondsNeeded: number;
	percent: number;
	details?: string;
}

export interface TargetUserInfo {
	id: string;
	username: string;
	discriminator: string;
	avatar: string | null;
	global_name?: string | null;
}

export interface QuestUserTask {
	id: string;
	userId: string;
	discordTag: string;
	userToken: string;
	targetUser: TargetUserInfo;
	status: TaskStatus;
	mode?: ExecutionMode;
	quests: QuestItemProgress[];
	completedQuests: number;
	totalQuests: number;
	startedAt?: Date;
	endedAt?: Date;
	errorMessage?: string;
	clientQuest?: ClientQuest;
	onUpdate?: (task: QuestUserTask) => void;
}

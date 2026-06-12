import {
  XP_CHAT_BASE,
  XP_CHAT_LENGTH_BONUS_MAX,
  XP_PLAN_APPROVED,
  XP_SKILL_INSTALLED,
} from '../constants'
import { chatTurnXpBonus, useProgressStore } from './progression'

export function awardChatTurnXp(contentLength: number) {
  const bonus = Math.min(chatTurnXpBonus(contentLength), XP_CHAT_LENGTH_BONUS_MAX)
  useProgressStore.getState().awardXp(XP_CHAT_BASE + bonus)
}

export function awardPlanApprovedXp() {
  useProgressStore.getState().awardXp(XP_PLAN_APPROVED)
}

export function onSkillInstalled(toolName: string) {
  const progress = useProgressStore.getState()
  progress.recordSkillLearned(toolName)
  progress.awardXp(XP_SKILL_INSTALLED)
}

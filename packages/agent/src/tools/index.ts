import { saveMemoryTool, recallMemoryTool } from "./memory";
import { recallTool } from "./recall";
import { listMeetingsTool } from "./meetings";
import { listEmailsTool, readEmailTool, draftEmailTool } from "./gmail";
import { listCalendarTool, createCalendarTool } from "./calendar";
import {
  openUrlTool,
  launchAppTool,
  runShortcutTool,
  playSpotifyTool,
  controlSpotifyTool,
  applescriptTool,
  typeTextTool,
  pressKeysTool,
  readAppTextTool,
} from "./device";
import {
  browserOpenTool,
  browserScreenshotTool,
  browserReadTool,
  browserClickTool,
  browserTypeTool,
  browserPressTool,
  browserScrollTool,
  browserBackTool,
  browserWaitTool,
} from "./browser";
import {
  imessageReadTool,
  imessageSendTool,
  contactsLookupTool,
  notesReadTool,
  notesCreateTool,
  musicPlayTool,
  musicControlTool,
  obsidianSearchTool,
} from "./mac";
import {
  weatherTool,
  hackernewsTopTool,
  newsHeadlinesTool,
  githubNotificationsTool,
} from "./info";
import { codeAgentTool } from "./code_agent";
import { researchAgentTool } from "./research";
import { outreachAgentTool } from "./outreach";
import { inboxAgentTool } from "./inbox";
import { opsAgentTool } from "./ops";
import { conciergeAgentTool } from "./concierge";
import { startErrandTool, listErrandsTool, errandRespondTool } from "./errand";
import {
  paymentsRevenueTool,
  paymentsCustomersTool,
  paymentsChargesTool,
  paymentsSubscriptionsTool,
} from "./payments";
import {
  commerceOrdersTool,
  commerceProductsTool,
  commerceLowStockTool,
  commerceSalesTool,
} from "./commerce";
import {
  accountingInvoicesTool,
  accountingExpensesTool,
  accountingBalancesTool,
  accountingContactsTool,
} from "./accounting";
import {
  notionSearchTool,
  notionReadPageTool,
  notionAppendTool,
  notionCreatePageTool,
  notionListDatabasesTool,
  notionAddDatabaseRowTool,
} from "./notion";
import {
  devListReposTool,
  devListIssuesTool,
  devListPullRequestsTool,
  devGetIssueTool,
  devCreateIssueTool,
  devCommentTool,
  devNotificationsTool,
  devSearchCodeTool,
} from "./github_dev";
import {
  slackListChannelsTool,
  slackSendMessageTool,
  slackReadChannelTool,
  slackSendDmTool,
  slackListUsersTool,
  slackSearchMessagesTool,
} from "./slack";
import {
  calcomEventTypesTool,
  calcomBookingsTool,
  calcomCancelBookingTool,
  calcomSchedulingUrlTool,
} from "./calcom";
import {
  tasksListTool,
  tasksCreateTool,
  tasksUpdateTool,
  tasksCloseTool,
  tasksCommentTool,
  tasksProjectsTool,
} from "./tasks";
import { sendTransactionalEmailTool } from "./transactional";
import {
  filesSearchTool,
  filesListTool,
  filesReadTool,
  filesCreateFolderTool,
  filesShareTool,
} from "./files";
import {
  listMySubscriptionsTool,
  scanMySubscriptionsTool,
  markSubscriptionCancelledTool,
} from "./subscriptions";
import { listMyReceiptsTool, scanMyReceiptsTool } from "./receipts";
import {
  listMyBudgetsTool,
  setMyBudgetTool,
  removeMyBudgetTool,
} from "./budgets";
import { runEveningWrapTool, runWeeklyReviewTool } from "./review";
import {
  listMyCommitmentsTool,
  scanMyCommitmentsTool,
  markCommitmentDoneTool,
  lookupContactTool,
} from "./commitments";
import { listHabitsTool, logHabitTool, habitStreakTool } from "./habits";
import { focusStatsTool } from "./focus";
import { saveLinkTool, listReadingTool, markLinkReadTool } from "./reading";
import { logCheckinTool, recentCheckinsTool } from "./checkins";
import { setIntentionTool, todayIntentionTool, completeIntentionTool } from "./intentions";
import { logDecisionTool, listDecisionsTool, reviewDecisionTool } from "./decisions";
import { addImportantDateTool, upcomingDatesTool } from "./dates";
import { logWinTool, recentWinsTool } from "./wins";
import { addGoalTool, listGoalsTool, updateGoalTool } from "./goals";
import { logIdeaTool, listIdeasTool, updateIdeaTool } from "./ideas";
import { logQuestionTool, listQuestionsTool, answerQuestionTool } from "./questions";
import { logReflectionTool, listReflectionsTool } from "./reflections";
import { listOpenLoopsTool } from "./loops";
import {
  saveSavedPromptTool,
  listSavedPromptsTool,
  fetchSavedPromptTool,
  deleteSavedPromptTool,
} from "./saved_prompts";
import {
  logPersonTool,
  logInteractionTool,
  listPeopleTool,
  whoToReconnectWithTool,
  getPersonTool,
} from "./people";
import {
  saveCardTool,
  searchCardsTool,
  deleteCardTool,
} from "./knowledge_cards";
import {
  logStandupTool,
  recentStandupsTool,
  listBlockersTool,
} from "./standups";
import {
  saveRoutineTool,
  listRoutinesTool,
  fetchRoutineTool,
  deleteRoutineTool,
} from "./routines";
import { weeklySynthesisTool } from "./retrospective";
import { crossSearchTool } from "./cross_search";
import { lookupTagTool } from "./lookup_tag";
import {
  saveThemeTool,
  updateThemeStateTool,
  listThemesTool,
  getThemeTool,
  closeThemeTool,
} from "./themes";
import {
  savePolicyTool,
  listPoliciesTool,
  checkPoliciesTool,
  deletePolicyTool,
} from "./policies";
import {
  logPredictionTool,
  listPredictionsTool,
  resolvePredictionTool,
  calibrationScoreTool,
} from "./predictions";
import { findDriftTool } from "./reconcile";
import { listObservationsTool } from "./observations";
import { runPremortemTool, listPremortemsTool, updatePremortemStatusTool } from "./premortem";
import { runCounterfactualTool, listCounterfactualsTool } from "./counterfactual";
import { projectTrajectoryTool, listTrajectoriesTool } from "./trajectory";
import { extractIdentityTool, listIdentityTool } from "./identity";
import { askFutureSelfTool, listFutureSelfDialoguesTool } from "./future_self";
import { askPastSelfTool, listPastSelfDialoguesTool } from "./past_self";
import {
  generateConstitutionTool,
  getLatestConstitutionTool,
  listConstitutionVersionsTool,
} from "./constitution";
import {
  scanBeliefContradictionsTool,
  listBeliefContradictionsTool,
  resolveBeliefContradictionTool,
} from "./belief_contradictions";
import {
  conveneInnerCouncilTool,
  listInnerCouncilSessionsTool,
  recordInnerCouncilSynthesisTool,
} from "./inner_council";
import { findEchoesTool, listEchoesTool } from "./echoes";
import { generateSelfMirrorTool, listSelfMirrorsTool } from "./self_mirror";
import {
  schedulePostmortemTool,
  listPostmortemsTool,
  respondToPostmortemTool,
} from "./postmortem";
import { drawSoulMapTool, listSoulMapsTool } from "./soul_map";
import {
  preWriteDraftTool,
  listPreWritesTool,
  resolvePreWriteTool,
} from "./pre_write";
import {
  forecastEnergyTool,
  listEnergyForecastsTool,
  scoreEnergyForecastTool,
} from "./energy_forecast";
import {
  stitchLifeTimelineTool,
  listLifeTimelinesTool,
} from "./life_timeline";
import {
  sealTimeLetterTool,
  listTimeLettersTool,
} from "./time_letters";
import {
  scanLatentDecisionsTool,
  listLatentDecisionsTool,
  respondToLatentDecisionTool,
} from "./latent_decisions";
import {
  generateReverseBriefTool,
  listReverseBriefsTool,
  respondToReverseBriefTool,
} from "./reverse_briefs";
import {
  enterCounterSelfChamberTool,
  listCounterSelfChambersTool,
  respondToCounterSelfTool,
} from "./counter_self";
import {
  scanPatternsTool,
  listPatternsTool,
  respondToPatternTool,
} from "./patterns";
import {
  scanConversationLoopsTool,
  listConversationLoopsTool,
  respondToConversationLoopTool,
} from "./conversation_loops";
import {
  scanPromisesTool,
  listPromisesTool,
  respondToPromiseTool,
} from "./promises";
import {
  scanInnerVoiceTool,
  listInnerVoiceTool,
  respondToInnerVoiceTool,
} from "./inner_voice";
import {
  scanPhantomLimbsTool,
  listPhantomLimbsTool,
  respondToPhantomLimbTool,
} from "./phantom_limbs";
import {
  scanPivotMapTool,
  listPivotMapTool,
  respondToPivotTool,
} from "./pivots";
import {
  scanQuestionGraveyardTool,
  listQuestionGraveyardTool,
  respondToQuestionTool,
} from "./question_graveyard";
import {
  scanMirrorIndexTool,
  listMirrorIndexTool,
  respondToComparisonTool,
} from "./mirror_index";
import {
  scanPermissionLedgerTool,
  listPermissionLedgerTool,
  respondToPermissionSeekingTool,
} from "./permission_ledger";
import {
  scanSelfErasuresTool,
  listSelfErasuresTool,
  respondToSelfErasureTool,
} from "./self_erasures";
import {
  scanDisownedTool,
  listDisownedTool,
  respondToDisownedTool,
} from "./disowned";
import {
  scanUsedToTool,
  listUsedToTool,
  respondToUsedToTool,
} from "./used-to";
import {
  scanShouldsTool,
  listShouldsTool,
  respondToShouldTool,
} from "./shoulds";
import {
  buildCabinetTool,
  listCabinetTool,
  respondToVoiceTool,
} from "./cabinet";
import {
  conveneMindTheatreTool,
  listMindTheatreTool,
  respondToMindTheatreTool,
} from "./mind_theatre";
import {
  scanThresholdsTool,
  listThresholdsTool,
  respondToThresholdTool,
} from "./thresholds";
import {
  scanAlmostsTool,
  listAlmostsTool,
  respondToAlmostTool,
} from "./almosts";
import {
  scanImaginedFuturesTool,
  listImaginedFuturesTool,
  respondToImaginedFutureTool,
} from "./imagined_futures";
import {
  scanVowsTool,
  listVowsTool,
  respondToVowTool,
} from "./vows";
import {
  composeLetterTool,
  listLettersTool,
  respondToLetterTool,
} from "./letters";
import {
  scanLoopsRegisterTool,
  listLoopsRegisterTool,
  respondToLoopTool,
} from "./loops_register";
import {
  scanSaidIWouldsTool,
  listSaidIWouldsTool,
  respondToSaidIWouldTool,
} from "./said_i_woulds";
import {
  scanContradictionsTool,
  listContradictionsTool,
  respondToContradictionTool,
} from "./contradictions";
import {
  scanPermissionSlipsTool,
  listPermissionSlipsTool,
  respondToPermissionSlipTool,
} from "./permission_slips";
import {
  scanOwedToMeTool,
  listOwedToMeTool,
  respondToOwedToMeTool,
} from "./owed_to_me";
import {
  scanGutChecksTool,
  listGutChecksTool,
  respondToGutCheckTool,
} from "./gut_checks";
import {
  scanFearsTool,
  listFearsTool,
  respondToFearTool,
} from "./fears";
import {
  switchModeTool,
  createVentureTool,
  listVenturesTool,
  getVentureTool,
  runOperatorLoopTool,
  proposeDecisionTool,
  respondToDecisionTool,
  logSignalTool,
  logMetricTool,
  updateVentureTool,
  killVentureTool,
  setVentureAutonomyTool,
  panicStopVenturesTool,
  clearPanicStopTool,
} from "./ventures";
import { homeListDevicesTool, homeControlDeviceTool } from "./home";
import {
  bankingAccountsTool,
  bankingTransactionsTool,
  bankingSpendingTool,
} from "./banking";
import {
  cryptoWalletsTool,
  cryptoPortfolioTool,
  cryptoTransactionsTool,
} from "./crypto";
import {
  cryptoSaveAddressTool,
  cryptoListAddressesTool,
  cryptoSendTool,
  listPendingCryptoActionsTool,
  cryptoActionRespondTool,
} from "./crypto_actions";
import { notifyUserTool } from "./notify";
import { snoozeProactiveTool, clearProactiveSnoozeTool } from "./proactive";
import { loadSkillTool } from "./skill";
import { installSkillTool } from "./install_skill";
import { findSkillTool } from "./find_skill";
import { execSkillScriptTool } from "./exec_skill";
import {
  createAutomationTool,
  listAutomationsTool,
  toggleAutomationTool,
  addSavedPlaceTool,
  addSavedPersonTool,
} from "./automations";
import {
  getCurrentLocationTool,
  lookupPlaceTool,
  listSavedPlacesTool,
} from "./places";
import { BACKGROUND_AGENT_TOOLS } from "../async_agents";
import type { ToolDef } from "./types";

export const CORE_TOOLS: ToolDef[] = [
  saveMemoryTool,
  recallMemoryTool,
  recallTool,
  listMeetingsTool,
  listEmailsTool,
  readEmailTool,
  draftEmailTool,
  listCalendarTool,
  createCalendarTool,
  weatherTool,
  hackernewsTopTool,
  newsHeadlinesTool,
  githubNotificationsTool,
  notifyUserTool,
  snoozeProactiveTool,
  clearProactiveSnoozeTool,
  loadSkillTool,
  installSkillTool,
  findSkillTool,
  execSkillScriptTool,
  researchAgentTool,
  ...BACKGROUND_AGENT_TOOLS,
  outreachAgentTool,
  inboxAgentTool,
  opsAgentTool,
  conciergeAgentTool,
  startErrandTool,
  listErrandsTool,
  errandRespondTool,
  paymentsRevenueTool,
  paymentsCustomersTool,
  paymentsChargesTool,
  paymentsSubscriptionsTool,
  commerceOrdersTool,
  commerceProductsTool,
  commerceLowStockTool,
  commerceSalesTool,
  accountingInvoicesTool,
  accountingExpensesTool,
  accountingBalancesTool,
  accountingContactsTool,
  notionSearchTool,
  notionReadPageTool,
  notionAppendTool,
  notionCreatePageTool,
  notionListDatabasesTool,
  notionAddDatabaseRowTool,
  devListReposTool,
  devListIssuesTool,
  devListPullRequestsTool,
  devGetIssueTool,
  devCreateIssueTool,
  devCommentTool,
  devNotificationsTool,
  devSearchCodeTool,
  slackListChannelsTool,
  slackSendMessageTool,
  slackReadChannelTool,
  slackSendDmTool,
  slackListUsersTool,
  slackSearchMessagesTool,
  calcomEventTypesTool,
  calcomBookingsTool,
  calcomCancelBookingTool,
  calcomSchedulingUrlTool,
  tasksListTool,
  tasksCreateTool,
  tasksUpdateTool,
  tasksCloseTool,
  tasksCommentTool,
  tasksProjectsTool,
  sendTransactionalEmailTool,
  filesSearchTool,
  filesListTool,
  filesReadTool,
  filesCreateFolderTool,
  filesShareTool,
  listMySubscriptionsTool,
  scanMySubscriptionsTool,
  markSubscriptionCancelledTool,
  listMyReceiptsTool,
  scanMyReceiptsTool,
  listMyBudgetsTool,
  setMyBudgetTool,
  removeMyBudgetTool,
  runEveningWrapTool,
  runWeeklyReviewTool,
  listMyCommitmentsTool,
  scanMyCommitmentsTool,
  markCommitmentDoneTool,
  lookupContactTool,
  listHabitsTool,
  logHabitTool,
  habitStreakTool,
  focusStatsTool,
  saveLinkTool,
  listReadingTool,
  markLinkReadTool,
  logCheckinTool,
  recentCheckinsTool,
  setIntentionTool,
  todayIntentionTool,
  completeIntentionTool,
  logDecisionTool,
  listDecisionsTool,
  reviewDecisionTool,
  addImportantDateTool,
  upcomingDatesTool,
  logWinTool,
  recentWinsTool,
  addGoalTool,
  listGoalsTool,
  updateGoalTool,
  logIdeaTool,
  listIdeasTool,
  updateIdeaTool,
  logQuestionTool,
  listQuestionsTool,
  answerQuestionTool,
  logReflectionTool,
  listReflectionsTool,
  listOpenLoopsTool,
  saveSavedPromptTool,
  listSavedPromptsTool,
  fetchSavedPromptTool,
  deleteSavedPromptTool,
  logPersonTool,
  logInteractionTool,
  listPeopleTool,
  whoToReconnectWithTool,
  getPersonTool,
  saveCardTool,
  searchCardsTool,
  deleteCardTool,
  logStandupTool,
  recentStandupsTool,
  listBlockersTool,
  saveRoutineTool,
  listRoutinesTool,
  fetchRoutineTool,
  deleteRoutineTool,
  weeklySynthesisTool,
  crossSearchTool,
  lookupTagTool,
  saveThemeTool,
  updateThemeStateTool,
  listThemesTool,
  getThemeTool,
  closeThemeTool,
  savePolicyTool,
  listPoliciesTool,
  checkPoliciesTool,
  deletePolicyTool,
  logPredictionTool,
  listPredictionsTool,
  resolvePredictionTool,
  calibrationScoreTool,
  findDriftTool,
  listObservationsTool,
  runPremortemTool,
  listPremortemsTool,
  updatePremortemStatusTool,
  runCounterfactualTool,
  listCounterfactualsTool,
  projectTrajectoryTool,
  listTrajectoriesTool,
  extractIdentityTool,
  listIdentityTool,
  askFutureSelfTool,
  listFutureSelfDialoguesTool,
  askPastSelfTool,
  listPastSelfDialoguesTool,
  generateConstitutionTool,
  getLatestConstitutionTool,
  listConstitutionVersionsTool,
  scanBeliefContradictionsTool,
  listBeliefContradictionsTool,
  resolveBeliefContradictionTool,
  conveneInnerCouncilTool,
  listInnerCouncilSessionsTool,
  recordInnerCouncilSynthesisTool,
  findEchoesTool,
  listEchoesTool,
  generateSelfMirrorTool,
  listSelfMirrorsTool,
  schedulePostmortemTool,
  listPostmortemsTool,
  respondToPostmortemTool,
  drawSoulMapTool,
  listSoulMapsTool,
  preWriteDraftTool,
  listPreWritesTool,
  resolvePreWriteTool,
  forecastEnergyTool,
  listEnergyForecastsTool,
  scoreEnergyForecastTool,
  stitchLifeTimelineTool,
  listLifeTimelinesTool,
  sealTimeLetterTool,
  listTimeLettersTool,
  scanLatentDecisionsTool,
  listLatentDecisionsTool,
  respondToLatentDecisionTool,
  generateReverseBriefTool,
  listReverseBriefsTool,
  respondToReverseBriefTool,
  enterCounterSelfChamberTool,
  listCounterSelfChambersTool,
  respondToCounterSelfTool,
  scanPatternsTool,
  listPatternsTool,
  respondToPatternTool,
  scanConversationLoopsTool,
  listConversationLoopsTool,
  respondToConversationLoopTool,
  scanPromisesTool,
  listPromisesTool,
  respondToPromiseTool,
  scanInnerVoiceTool,
  listInnerVoiceTool,
  respondToInnerVoiceTool,
  scanPhantomLimbsTool,
  listPhantomLimbsTool,
  respondToPhantomLimbTool,
  scanPivotMapTool,
  listPivotMapTool,
  respondToPivotTool,
  scanQuestionGraveyardTool,
  listQuestionGraveyardTool,
  respondToQuestionTool,
  scanMirrorIndexTool,
  listMirrorIndexTool,
  respondToComparisonTool,
  scanPermissionLedgerTool,
  listPermissionLedgerTool,
  respondToPermissionSeekingTool,
  scanSelfErasuresTool,
  listSelfErasuresTool,
  respondToSelfErasureTool,
  scanDisownedTool,
  listDisownedTool,
  respondToDisownedTool,
  scanUsedToTool,
  listUsedToTool,
  respondToUsedToTool,
  scanShouldsTool,
  listShouldsTool,
  respondToShouldTool,
  buildCabinetTool,
  listCabinetTool,
  respondToVoiceTool,
  conveneMindTheatreTool,
  listMindTheatreTool,
  respondToMindTheatreTool,
  scanThresholdsTool,
  listThresholdsTool,
  respondToThresholdTool,
  scanAlmostsTool,
  listAlmostsTool,
  respondToAlmostTool,
  scanImaginedFuturesTool,
  listImaginedFuturesTool,
  respondToImaginedFutureTool,
  scanVowsTool,
  listVowsTool,
  respondToVowTool,
  composeLetterTool,
  listLettersTool,
  respondToLetterTool,
  scanLoopsRegisterTool,
  listLoopsRegisterTool,
  respondToLoopTool,
  scanSaidIWouldsTool,
  listSaidIWouldsTool,
  respondToSaidIWouldTool,
  scanContradictionsTool,
  listContradictionsTool,
  respondToContradictionTool,
  scanPermissionSlipsTool,
  listPermissionSlipsTool,
  respondToPermissionSlipTool,
  scanOwedToMeTool,
  listOwedToMeTool,
  respondToOwedToMeTool,
  scanGutChecksTool,
  listGutChecksTool,
  respondToGutCheckTool,
  scanFearsTool,
  listFearsTool,
  respondToFearTool,
  switchModeTool,
  createVentureTool,
  listVenturesTool,
  getVentureTool,
  runOperatorLoopTool,
  proposeDecisionTool,
  respondToDecisionTool,
  logSignalTool,
  logMetricTool,
  updateVentureTool,
  killVentureTool,
  setVentureAutonomyTool,
  panicStopVenturesTool,
  clearPanicStopTool,
  homeListDevicesTool,
  homeControlDeviceTool,
  bankingAccountsTool,
  bankingTransactionsTool,
  bankingSpendingTool,
  cryptoWalletsTool,
  cryptoPortfolioTool,
  cryptoTransactionsTool,
  cryptoSaveAddressTool,
  cryptoListAddressesTool,
  cryptoSendTool,
  listPendingCryptoActionsTool,
  cryptoActionRespondTool,
  createAutomationTool,
  listAutomationsTool,
  toggleAutomationTool,
  addSavedPlaceTool,
  addSavedPersonTool,
  getCurrentLocationTool,
  lookupPlaceTool,
  listSavedPlacesTool,
  browserOpenTool,
  browserScreenshotTool,
  browserReadTool,
  browserClickTool,
  browserTypeTool,
  browserPressTool,
  browserScrollTool,
  browserBackTool,
  browserWaitTool,
];

export const DEVICE_TOOLS: ToolDef[] = [
  openUrlTool,
  launchAppTool,
  runShortcutTool,
  playSpotifyTool,
  controlSpotifyTool,
  applescriptTool,
  typeTextTool,
  pressKeysTool,
  readAppTextTool,
  imessageReadTool,
  imessageSendTool,
  contactsLookupTool,
  notesReadTool,
  notesCreateTool,
  musicPlayTool,
  musicControlTool,
  obsidianSearchTool,
  codeAgentTool,
];

export const ALL_TOOLS: ToolDef[] = [...CORE_TOOLS, ...DEVICE_TOOLS];

export interface ToolFilterOptions {
  // Tool names the user has disabled via the feature library. These are
  // dropped from the returned list so the brain never sees them.
  disabledToolNames?: Set<string> | null;
}

export function toolsForDevice(
  deviceKind: string,
  opts?: ToolFilterOptions,
): ToolDef[] {
  const canControlDevice = deviceKind === "mac" || deviceKind === "desktop";
  const base = canControlDevice ? ALL_TOOLS : CORE_TOOLS;
  const disabled = opts?.disabledToolNames;
  if (!disabled || disabled.size === 0) return base;
  return base.filter((t) => !disabled.has(t.name));
}

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export type { ToolDef, ToolContext, QueueClientActionArgs, BrowserAction, BrowserResult } from "./types";
export { asAnthropicTool } from "./types";

import { loggerService } from '../utils/logger';

import PageProofService from './proofService';
import { PowerAppsService } from './powerAppsService';

export enum ProofStatus {
  Approved = 'approved',
  TodosRequested = 'todos_requested',
  Todos_Requested = 'todos-requested',
  InProofing = 'in_proofing',
  WithApprover = 'with_approver',
  New = 'new',
  Active = 'active',
  Overdue = 'overdue',
}

interface TriggeringProof {
  id: string;
  name: string;
  reason: string;
  locked: boolean;
}

interface GroupInfo {
  groupId: string | null;
  groupName: string | null;
}

interface ConditionLock {
  condition: ProofStatus.Overdue | ProofStatus.Approved | ProofStatus.TodosRequested | null;
  locked: boolean;
}

interface ProofData {
  proofId: string;
  proofName: string;
  proofStatus: ProofStatus;
  approvedDate: string | null;
  dueDate: string | null;
  email: string;
}

// Helpers
const isOverdue = (dueDate: string | null | undefined): boolean =>
  !!dueDate && !isNaN(new Date(dueDate).getTime()) && new Date(dueDate).getTime() < Date.now();

async function checkGroupStatusAndTriggerPowerApps(
  groupId: string,
  groupName: string | null,
  condition: ProofStatus | 'approved_or_todos',
  triggeringProof?: TriggeringProof,
): Promise<void> {
  const proofsInGroup = await PageProofService.getProofsInGroup(groupId);
  if (!proofsInGroup?.length) {
    loggerService.logger.warn('No proofs found in group', { groupId });
    return;
  }

  const statuses = proofsInGroup.map((p: any) => {
    if (
      (p.state === ProofStatus.InProofing || p.state === ProofStatus.Active) &&
      isOverdue(p.dueDate)
    )
      return ProofStatus.Overdue;
    return p.state;
  });

  let allMatch = false;
  let matchStatus: ProofStatus | 'approved_or_todos' = condition;

  if (condition === ProofStatus.Overdue) {
    allMatch = statuses.every(s => s === ProofStatus.Overdue);
  } else if (
    statuses.every(
      s =>
        s === ProofStatus.Approved ||
        s === ProofStatus.TodosRequested ||
        s === ProofStatus.Todos_Requested,
    )
  ) {
    allMatch = true;
    matchStatus = 'approved_or_todos';
  } else if (condition === ProofStatus.Approved) {
    allMatch = statuses.every(s => s === ProofStatus.Approved);
  } else if (condition === ProofStatus.TodosRequested) {
    allMatch = statuses.every(
      s => s === ProofStatus.TodosRequested || s === ProofStatus.Todos_Requested,
    );
  }

  const proofIds = proofsInGroup.map((p: any) => p.id);
  const proofNames = proofsInGroup.map((p: any) => p.name);

  if (allMatch) {
    loggerService.logger.info('All proofs in group meet condition', { groupId, matchStatus });
    await PowerAppsService.sendToPowerApps({
      groupName,
      status: matchStatus,
      proofIds,
      proofNames,
      locked: triggeringProof?.locked,
      reason: `All proofs are ${matchStatus}`,
      submitToNextStage: 'pv_team_review',
    });
  } else if (triggeringProof) {
    loggerService.logger.info('Mixed proof statuses in group, sending only locked proof', {
      groupId,
      condition,
    });
    await PowerAppsService.sendToPowerApps({
      groupName,
      status: condition,
      locked: triggeringProof.locked,
      lockedProofId: triggeringProof.id,
      lockedProofName: triggeringProof.name,
      reason: triggeringProof.reason,
    });
  } else {
    loggerService.logger.warn('Triggering proof info not available to send mixed status event', {
      groupId,
      condition,
    });
  }
}

async function lockProofIfApplicable(proofId: string, reason: string): Promise<boolean> {
  try {
    await PageProofService.lockProofService(proofId);
    loggerService.logger.info('Proof locked', { proofId, reason });
    return true;
  } catch (err) {
    loggerService.logger.error('Failed to lock proof', { proofId, error: err, reason });
    return false;
  }
}

const proofDetailsCache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL_MS = 10 * 1000;

const getCachedProofDetails = (proofId: string): any | null => {
  const entry = proofDetailsCache.get(proofId);
  if (entry && entry.expires > Date.now()) return entry.data;
  proofDetailsCache.delete(proofId);
  return null;
};

const getWithApprover = async (proofId: string): Promise<any> => {
  const cached = getCachedProofDetails(proofId);
  if (cached) return cached;
  const details = await PageProofService.loadProofDetails(proofId);
  if (details) {
    proofDetailsCache.set(proofId, { data: details, expires: Date.now() + CACHE_TTL_MS });
  }
  return details;
};

const extractProofData = (body: any): ProofData => ({
  proofId: body?.proof?.id || 'N/A',
  proofName: body?.proof?.name || 'N/A',
  proofStatus: body?.proof?.status as ProofStatus,
  approvedDate: body?.proof?.approvedDate || null,
  dueDate: body?.proof?.dueDate || null,
  email: body?.trigger?.email || 'N/A',
});

const getGroupInfo = async (proofId: string): Promise<GroupInfo> => {
  const proofDetails = await getWithApprover(proofId);
  const groupId = proofDetails?.groupId || proofDetails?.collectionId || null;
  const groupName = groupId ? (await PageProofService.getGroupById(groupId))?.name || null : null;
  return { groupId, groupName };
};

async function determineConditionAndLock(
  proofStatus: ProofStatus,
  dueDate: string | null,
  proofId: string,
  proofName: string,
  email: string,
): Promise<ConditionLock | { bypass: true; response: any }> {
  const hasKeywords = /markups/i.test(proofName) && /reference/i.test(proofName);

  if (!hasKeywords) {
    if (proofStatus === ProofStatus.TodosRequested || proofStatus === ProofStatus.Todos_Requested) {
      return {
        bypass: true,
        response: {
          status: 200,
          message: `Draft ${proofName} has rework requested by ${email}`,
          reworkData: {
            proofId,
            proofName,
            email,
            reason: 'request_rework',
            status: proofStatus,
          },
        },
      };
    } else if (proofStatus === ProofStatus.Approved) {
      return {
        bypass: true,
        response: {
          status: 200,
          message: `Draft ${proofName} has been approved by ${email}`,
          reworkData: {
            proofId,
            proofName,
            email,
            reason: 'approve',
            status: proofStatus,
          },
        },
      };
    }
    return { condition: null, locked: false };
  }

  if (proofStatus === ProofStatus.Approved) {
    return {
      condition: ProofStatus.Approved,
      locked: await lockProofIfApplicable(proofId, `status: ${proofStatus}`),
    };
  } else if (
    proofStatus === ProofStatus.TodosRequested ||
    proofStatus === ProofStatus.Todos_Requested
  ) {
    return {
      condition: ProofStatus.TodosRequested,
      locked: await lockProofIfApplicable(proofId, `status: ${proofStatus}`),
    };
  } else if (proofStatus === ProofStatus.InProofing && isOverdue(dueDate)) {
    return {
      condition: ProofStatus.Overdue,
      locked: await lockProofIfApplicable(proofId, 'overdue in_proofing'),
    };
  }

  return { condition: null, locked: false };
}

export class WebhookService {
  static async handleProofStatus(body: any) {
    const proofData = extractProofData(body);
    const { groupId, groupName } = await getGroupInfo(proofData.proofId);

    const result = await determineConditionAndLock(
      proofData.proofStatus,
      proofData.dueDate,
      proofData.proofId,
      proofData.proofName,
      proofData.email,
    );

    if ('bypass' in result && result.bypass) {
      loggerService.logger.info('Bypassed lock condition', {
        groupName,
        status: result.response.reworkData.status,
        proofIds: proofData.proofId,
        proofNames: proofData.proofName,
        reason: result.response.reworkData.reason,
      });

      await PowerAppsService.sendToPowerApps({
        groupName,
        status: result.response.reworkData.status,
        proofIds: [proofData.proofId],
        proofNames: [proofData.proofName],
        reason: result.response.reworkData.reason,
        email: result.response.reworkData.email,
      });

      return result.response;
    }

    const { condition, locked } = result as ConditionLock;

    if (condition && groupId) {
      await checkGroupStatusAndTriggerPowerApps(groupId, groupName, condition, {
        id: proofData.proofId,
        name: proofData.proofName,
        reason: `Triggered by ${proofData.proofStatus}`,
        locked,
      });
    } else if (!groupId) {
      loggerService.logger.warn('No groupId/collectionId found in proof details', {
        proofId: proofData.proofId,
      });
      return {
        status: 404,
        error: 'No groupId/collectionId found in proof details',
        message: 'No groupId/collectionId found in proof details',
        proofData: { ...proofData, locked, groupName },
      };
    }

    loggerService.logger.info('Proof status processed', proofData);
    return {
      status: 200,
      error: null,
      message: 'Webhook received from PageProof, proof status updated',
      proofData: { ...proofData, locked, groupName },
    };
  }

  static async handleProofOverdue(body: any) {
    const overdueData = extractProofData(body);
    const { groupId, groupName } = await getGroupInfo(overdueData.proofId);
    let locked = false;

    const validStatuses = [ProofStatus.InProofing, ProofStatus.WithApprover, ProofStatus.Active];
    if (
      validStatuses.includes(overdueData.proofStatus) &&
      (await PageProofService.loadProofDetails(overdueData.proofId))
    ) {
      locked = await lockProofIfApplicable(overdueData.proofId, 'overdue handler');
    }

    if (groupId) {
      await checkGroupStatusAndTriggerPowerApps(groupId, groupName, ProofStatus.Overdue, {
        id: overdueData.proofId,
        name: overdueData.proofName,
        reason: `Triggered by ${overdueData.proofStatus}`,
        locked,
      });
    } else {
      loggerService.logger.warn('No groupId/collectionId found in proof details', {
        proofId: overdueData.proofId,
      });
      return {
        status: 404,
        error: 'No groupId/collectionId found in proof details',
        message: 'No groupId/collectionId found in proof details',
        overdueData: { ...overdueData, locked, groupName },
      };
    }

    loggerService.logger.info('Overdue proof processed', overdueData);
    return {
      status: 200,
      error: null,
      message: 'Webhook received from PageProof, proof marked as overdue',
      overdueData: { ...overdueData, locked, groupName },
    };
  }

  static async getGroupId(proofId: string): Promise<string | null> {
    const { groupId } = await getGroupInfo(proofId);
    return groupId;
  }

  static async getProofStatusData(body: any) {
    return { proofData: extractProofData(body), status: 200 };
  }

  static async getProofOverdueData(body: any) {
    return { overdueData: extractProofData(body), status: 200 };
  }
}

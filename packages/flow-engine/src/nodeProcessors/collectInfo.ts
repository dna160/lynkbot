/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/collectInfo.ts
 * Role    : COLLECT_INFO node — sequentially collects structured answers from the buyer.
 *
 * State stored in ctx.variables:
 *   'collectInfo_<nodeId>_index'       — current question index (number)
 *   'answers.<variableName>'           — answer for each question after collection
 *
 * Resume pattern (identical to AGENT):
 *   engine.ts resumeExecution() re-enters this node when buyer replies.
 *   The node reads the current index, stores the reply, advances, and either
 *   sends the next question or exits.
 *
 * Exit ports:
 *   'default'  — used when config.onComplete === 'continue' (flow proceeds)
 *   completed  — used when config.onComplete === 'end'
 *
 * Exports : collectInfoProcessor
 */
import type { FlowNode, ExecutionContext, CollectInfoConfig, CollectInfoQuestion } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { saveOutboundMessage } from '../saveOutboundMessage';

const INDEX_KEY = (nodeId: string) => `collectInfo_${nodeId}_index`;
const ANSWER_KEY = (variableName: string) => `answers.${variableName}`;

async function sendQuestion(
  question: CollectInfoQuestion,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<void> {
  const meta = await deps.getMetaClient(ctx.tenantId);

  if (question.type === 'choice' && question.choices && question.choices.length > 0) {
    // MetaClient doesn't have sendInteractive — send numbered choice list as plain text.
    const message = `${question.promptText}\n\n${question.choices.slice(0, 3).map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
    await meta.sendText({ to: ctx.buyer.waPhone, message, isWithin24hrWindow: true }).catch(() => null);
    saveOutboundMessage(ctx.tenantId, ctx.buyerId, message, 'text').catch(() => null);
  } else {
    await meta.sendText({ to: ctx.buyer.waPhone, message: question.promptText, isWithin24hrWindow: true }).catch(() => null);
    saveOutboundMessage(ctx.tenantId, ctx.buyerId, question.promptText, 'text').catch(() => null);
  }
}

export async function collectInfoProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as CollectInfoConfig;
  const questions = config.questions ?? [];

  if (questions.length === 0) {
    ctx.executionLog.push({
      nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
      status: 'skipped', skipReason: 'no_questions_configured',
    });
    return { nextNodeId: 'default' };
  }

  const indexKey = INDEX_KEY(node.id);
  let index = (ctx.variables[indexKey] as number | undefined) ?? 0;
  const inboundText = ctx.trigger.messageText?.trim() ?? '';

  // Only store an answer if we've already sent a question (index > 0).
  // When index === 0 this is the FIRST entry into COLLECT_INFO — inboundText is the
  // keyword that triggered the flow, NOT an answer.  Never treat the trigger message
  // as an answer; always send question 0 fresh.
  if (inboundText && index > 0) {
    const prevQuestion = questions[index - 1];
    if (prevQuestion) {
      let answer = inboundText;
      // For choice questions, resolve numbered input ("1" → choice label)
      if (prevQuestion.type === 'choice' && prevQuestion.choices) {
        const numericChoice = parseInt(inboundText, 10);
        if (!isNaN(numericChoice) && numericChoice >= 1 && numericChoice <= prevQuestion.choices.length) {
          answer = prevQuestion.choices[numericChoice - 1]!;
        }
        // Also accept "ci_N" payloads from interactive button replies
        const buttonMatch = inboundText.match(/^ci_(\d+)$/);
        if (buttonMatch) {
          const btnIdx = parseInt(buttonMatch[1]!, 10);
          answer = prevQuestion.choices[btnIdx] ?? inboundText;
        }
      }
      ctx.variables[ANSWER_KEY(prevQuestion.variableName)] = answer;
    }
  }

  // Check if we've collected all answers
  if (index >= questions.length) {
    ctx.executionLog.push({
      nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
      status: 'ok',
      meta: {
        collected: questions.map(q => ({
          variableName: q.variableName,
          answered: ctx.variables[ANSWER_KEY(q.variableName)] !== undefined,
        })),
      },
    });

    if (config.onComplete === 'end') {
      return { status: 'completed' };
    }
    return { nextNodeId: 'default' };
  }

  // Send the next question
  const nextQuestion = questions[index]!;
  await sendQuestion(nextQuestion, ctx, deps);

  // Advance index so next resume knows which question was just asked
  ctx.variables[indexKey] = index + 1;

  ctx.executionLog.push({
    nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
    status: 'waiting',
    meta: { questionIndex: index, variableName: nextQuestion.variableName },
  });

  return { status: 'waiting_reply' };
}

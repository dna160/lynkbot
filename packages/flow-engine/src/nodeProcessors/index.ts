/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/index.ts
 * Role    : Registry mapping NodeType to processor function.
 * Exports : processorRegistry
 */
import type { NodeType } from '../types';
import type { NodeProcessor } from './types';
import { sendTemplateProcessor } from './sendTemplate';
import { sendTextProcessor } from './sendText';
import { sendInteractiveProcessor } from './sendInteractive';
import { sendMediaProcessor } from './sendMedia';
import { delayProcessor } from './delay';
import { waitForReplyProcessor } from './waitForReply';
import { ifConditionProcessor } from './ifCondition';
import { keywordRouterProcessor } from './keywordRouter';
import { tagBuyerProcessor } from './tagBuyer';
import { updateBuyerProcessor } from './updateBuyer';
import { sendWindowProcessor } from './sendWindow';
import { rateLimitProcessor } from './rateLimit';
import { segmentQualityGateProcessor } from './segmentQualityGate';
import { endFlowProcessor } from './endFlow';

export const processorRegistry: Partial<Record<NodeType, NodeProcessor>> = {
  SEND_TEMPLATE: sendTemplateProcessor,
  SEND_TEXT: sendTextProcessor,
  SEND_INTERACTIVE: sendInteractiveProcessor,
  SEND_MEDIA: sendMediaProcessor,
  DELAY: delayProcessor,
  WAIT_FOR_REPLY: waitForReplyProcessor,
  IF_CONDITION: ifConditionProcessor,
  KEYWORD_ROUTER: keywordRouterProcessor,
  TAG_BUYER: tagBuyerProcessor,
  UPDATE_BUYER: updateBuyerProcessor,
  SEND_WINDOW: sendWindowProcessor,
  RATE_LIMIT: rateLimitProcessor,
  SEGMENT_QUALITY_GATE: segmentQualityGateProcessor,
  END_FLOW: endFlowProcessor,
};

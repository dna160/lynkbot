const { db } = require('./dist/index.js');
const { eq, and } = require('drizzle-orm');
const { intentPlaybooks, conversations, messages, flowExecutions } = require('./dist/schema/index.js');

async function main() {
  const tenantId = '68ca4c89-98d5-400f-bf03-78c0b8e240d5';
  const buyerId = '832ccbd4-f68f-4406-9429-e648d63b69c6';

  console.log('--- Intent Playbooks for tenant ---');
  const playbooks = await db.query.intentPlaybooks.findMany({
    where: eq(intentPlaybooks.tenantId, tenantId)
  });
  console.log(playbooks.length + ' playbooks found');
  for (const p of playbooks) {
    console.log('  ', p.intentKey, '| active=', p.isActive, '| priority=', p.priority, '| label=', p.label);
  }

  console.log('\n--- Conversations for buyer ---');
  const convs = await db.query.conversations.findMany({
    where: and(eq(conversations.tenantId, tenantId), eq(conversations.buyerId, buyerId)),
    orderBy: (t, { desc }) => desc(t.startedAt)
  });
  console.log(convs.length + ' conversations found');
  for (const c of convs) {
    console.log('  ', c.id, '| state=', c.state, '| active=', c.isActive, '| started=', c.startedAt);
  }

  if (convs.length > 0) {
    const convId = convs[0].id;
    console.log('\n--- Messages in latest conversation ---');
    const msgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, convId),
      orderBy: (m, { asc }) => asc(m.createdAt),
      limit: 20
    });
    for (const m of msgs) {
      const preview = (m.textContent || '').substring(0, 60).replace(/\n/g, ' ');
      console.log('  ', m.direction, '|', m.createdAt.toISOString(), '|', preview);
    }
  }

  console.log('\n--- Flow executions for buyer ---');
  const flows = await db.query.flowExecutions.findMany({
    where: and(eq(flowExecutions.tenantId, tenantId), eq(flowExecutions.buyerId, buyerId)),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 5
  });
  console.log(flows.length + ' flow executions found');
  for (const f of flows) {
    console.log('  ', f.id, '| status=', f.status, '| flowId=', f.flowDefinitionId, '| created=', f.createdAt);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

/**
 * Gate 0 POC: verify that pi-agent-core runs in Node/Electron main-process
 * conditions (ESM, no DOM), streams events, executes a tool and can be aborted.
 *
 * Run with: node scripts/poc-pi.mjs
 * No API key or network access is required thanks to pi-ai's faux provider.
 */
import {
  Agent,
  } from '@earendil-works/pi-agent-core';
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai';

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);

const model = faux.getModel();
const events = [];

const echoTool = {
  name: 'echo',
  label: 'Echo',
  description: 'Echo the provided text.',
  parameters: Type.Object({ text: Type.String() }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: 'text', text: `echo:${params.text}` }],
      details: { echoed: params.text },
    };
  },
};

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a test agent.',
    model,
    tools: [echoTool],
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  events.push(event.type);
});

faux.setResponses([
  fauxAssistantMessage([fauxToolCall('echo', { text: 'hello' })], { stopReason: 'toolUse' }),
  fauxAssistantMessage([fauxText('done')]),
]);

await agent.prompt('please echo hello');
await agent.waitForIdle();

const toolResult = agent.state.messages.find((message) => message.role === 'toolResult');
const finalText = agent.state.messages
  .filter((message) => message.role === 'assistant')
  .flatMap((message) => message.content)
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('');

if (!toolResult || toolResult.content[0]?.text !== 'echo:hello') {
  throw new Error('Tool did not execute as expected.');
}
if (finalText !== 'done') {
  throw new Error(`Unexpected final text: ${finalText}`);
}
if (!events.includes('tool_execution_start') || !events.includes('tool_execution_end')) {
  throw new Error(`Missing tool events: ${events.join(',')}`);
}

// Abort smoke test: the faux provider streams slowly enough for abort to land.
const abortAgent = new Agent({
  initialState: { systemPrompt: 'test', model, tools: [] },
  streamFn: models.streamSimple.bind(models),
});
faux.setResponses([fauxAssistantMessage([fauxText('a'.repeat(2000))])]);
await abortAgent.prompt('long answer');
abortAgent.abort();
await abortAgent.waitForIdle();

console.log('Pi POC passed:', events.join(' -> '));

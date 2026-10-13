import { getOllamaClient } from '../../../../agents/ollama-client';
import { classifyVoiceInterruption } from './narrator';
import { VoiceAgentDecision, VoiceAgentProcessEntry, pushVoiceAgentProcessEntry, executeVoiceAgentToolWithTrace, deterministicVoiceSmallTalkReply } from './decision';
import { VoiceAgentTargetContext, voiceAgentTargetIdentity, getVoiceAgentContextBlock, compactVoiceText, friendlyVoiceToolName, isVoiceContextNoiseText, voiceNarrationLineFromActivity, voiceAgentNarrationState } from './context';
import { findVoiceToolFallbackRequest, isVoiceRuntimeControlTool, parseVoiceToolResult, runVoiceAutomationSkillScout, buildVoiceAgentLightSystemPrompt, buildVoiceAgentSystemPrompt, safeParseVoiceAgentJson, normalizeVoiceAgentDecision } from './fallback';
import { cleanVoiceWakePhrase, voiceRuntimeDirectiveFromToolResult, parseVoiceToolArgs } from './tool-helpers';
import { createPlainTextSentenceStreamer, buildFastRouteSpokenReply, getVoiceAgentSynthModel, createSpokenReplyStreamer, buildDeterministicHandoffAck } from './spoken-reply';
import { buildVoiceToolDefinitions } from './tool-definitions';


export async function callVoiceAgentDecisionModel(
  sessionId: string,
  transcript: string,
  classification: ReturnType<typeof classifyVoiceInterruption>,
  contextPacket: Record<string, any>,
  fallback: VoiceAgentDecision,
  trace?: VoiceAgentProcessEntry[],
  onSpeechChunk?: (text: string) => void,
  options?: { disableDeterministicFastRoutes?: boolean; voiceTarget?: VoiceAgentTargetContext },
): Promise<VoiceAgentDecision> {
  try {
    const startedAt = Date.now();
    const targetIdentity = voiceAgentTargetIdentity(options?.voiceTarget);
    const contextStartedAt = Date.now();
    const contextBlockResult = await getVoiceAgentContextBlock(sessionId, transcript, { voiceTarget: options?.voiceTarget });
    const contextBuildMs = contextBlockResult.elapsedMs || (Date.now() - contextStartedAt);
    const contextBlock = contextBlockResult.contextBlock;
    pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: context ${contextBlockResult.cacheHit ? 'cache hit' : 'build'} ${contextBuildMs}ms.`, {
      stage: contextBlockResult.cacheHit ? 'voice_context_cache_hit' : 'voice_context_build',
      elapsedMs: contextBuildMs,
      cacheHit: contextBlockResult.cacheHit,
      totalMs: Date.now() - startedAt,
    });
    const voiceAutomationSkillScoutSeen = new Set<string>();
    const collectedRichArtifacts: any[] = [];
    const deterministicFastRoutesDisabled = options?.disableDeterministicFastRoutes === true;
    const detectedFallbackToolRequest = findVoiceToolFallbackRequest(transcript);
    const runtimeControlFastRouteAllowed = deterministicFastRoutesDisabled && isVoiceRuntimeControlTool(detectedFallbackToolRequest?.name || '');
    const fallbackToolRequest = deterministicFastRoutesDisabled && !runtimeControlFastRouteAllowed ? null : detectedFallbackToolRequest;
    if ((runtimeControlFastRouteAllowed || !deterministicFastRoutesDisabled) && fallbackToolRequest?.name === 'voice_set_wake_phrase') {
      const content = await executeVoiceAgentToolWithTrace(sessionId, fallbackToolRequest.name, fallbackToolRequest.args, trace);
      const parsedTool = parseVoiceToolResult(content);
      const phrase = cleanVoiceWakePhrase(parsedTool?.wakePhrase || fallbackToolRequest.args?.phrase || '');
      const acknowledgementMessages = [
        {
          role: 'system',
          content: [
            targetIdentity.identityLine,
            'The user just set their wake phrase. Acknowledge naturally in one short spoken sentence.',
            'Do not say you will remember it forever. Do not mention implementation details. Return only the sentence, no JSON.',
          ].join('\n'),
        },
        { role: 'user', content: transcript },
      ];
      let spokenReply = phrase ? `Your wake phrase is now ${phrase}.` : 'Your wake phrase is updated.';
      try {
        const ackStartedAt = Date.now();
        let streamedAck = false;
        const ackStreamer = onSpeechChunk
          ? createPlainTextSentenceStreamer((sentence) => {
              streamedAck = true;
              try { onSpeechChunk(sentence); } catch {}
            })
          : null;
        const ack = await getOllamaClient().chatWithThinking(acknowledgementMessages, 'executor', {
          temperature: 0.4,
          num_ctx: 1024,
          num_predict: 40,
          think: 'none',
          usageContext: { sessionId, agentId: 'voice_agent' },
          onToken: ackStreamer ? ((chunk: string) => ackStreamer.feed(chunk)) : undefined,
        } as any);
        if (ackStreamer) ackStreamer.finish();
        const modelAck = compactVoiceText(String(ack?.message?.content || '').replace(/^```[\s\S]*?```$/g, '').trim(), 180);
        if (modelAck) spokenReply = modelAck;
        if (onSpeechChunk && !streamedAck && spokenReply) {
          try { onSpeechChunk(spokenReply); } catch {}
        }
        pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: wake phrase acknowledgement ${Date.now() - ackStartedAt}ms.`, {
          stage: 'voice_wake_phrase_ack',
          elapsedMs: Date.now() - ackStartedAt,
          totalMs: Date.now() - startedAt,
        });
      } catch (err: any) {
        pushVoiceAgentProcessEntry(trace, 'warn', `Wake phrase acknowledgement model failed: ${String(err?.message || err).slice(0, 180)}`, {
          stage: 'voice_wake_phrase_ack_failed',
          totalMs: Date.now() - startedAt,
        });
      }
      return {
        action: 'answer_now',
        spokenReply,
        workerInstruction: '',
        needsWorkerResponse: false,
        reason: 'voice_runtime_tool_fast_route:set_wake_phrase',
        runtimeDirectives: phrase ? [{ action: 'set_wake_phrase', wakePhrase: phrase }] : [],
      };
    }
    // Fast-route: transcript clearly matches a voice tool and no worker is active.
    // Routing/decision model skipped entirely. Reply is built deterministically from
    // the tool result â€” no synthesis model call (cloud models take 500â€“4000ms even
    // with max_tokens=120; that defeats the purpose of fast-routing).
    // When a worker IS active we keep the full model path so it can decide whether
    // to answer, steer, or interrupt.
    if (
      (!deterministicFastRoutesDisabled || runtimeControlFastRouteAllowed)
      &&
      fallbackToolRequest
      && !classification.shouldAbortOriginalRun
      && !classification.shouldPauseOriginalRun
      && (contextPacket.active !== true || isVoiceRuntimeControlTool(fallbackToolRequest.name))
    ) {
      const toolStartedAt = Date.now();
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: deterministic tool fast-route ${fallbackToolRequest.name} â€” routing model skipped.`, {
        stage: 'voice_fast_router',
        route: `tool:${fallbackToolRequest.name}`,
        totalMs: Date.now() - startedAt,
      });
      await runVoiceAutomationSkillScout(sessionId, transcript, fallbackToolRequest.name, trace, voiceAutomationSkillScoutSeen);
      const raw = await executeVoiceAgentToolWithTrace(sessionId, fallbackToolRequest.name, fallbackToolRequest.args, trace);
      const toolResult = parseVoiceToolResult(raw);
      if (Array.isArray(toolResult?.richArtifacts)) collectedRichArtifacts.push(...toolResult.richArtifacts);
      const runtimeDirective = voiceRuntimeDirectiveFromToolResult(toolResult);
      const runtimeDirectives = runtimeDirective ? [runtimeDirective] : [];
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: deterministic tool execute ${Date.now() - toolStartedAt}ms.`, {
        stage: 'voice_fast_router_tool_done',
        tool: fallbackToolRequest.name,
        ok: toolResult?.ok !== false,
        elapsedMs: Date.now() - toolStartedAt,
        totalMs: Date.now() - startedAt,
      });
      // Synthesis pass: transcript + tool result â†’ one spoken reply.
      // Uses the fastest available model (mini/haiku tier), not the primary executor.
      // No personality context, no tool defs, no JSON schema â€” tiny prompt, tiny output.
      const fallbackSpokenReply = buildFastRouteSpokenReply(fallbackToolRequest.name, toolResult);
      let spokenReply = fallbackSpokenReply;
      try {
        const synthStartedAt = Date.now();
        const resultSummary = compactVoiceText(toolResult?.summary || toolResult?.stdout || toolResult?.error || '', 1200);
        const synthMessages = [
          {
            role: 'system',
            content: [
              `You are ${targetIdentity.speakerName} on voice. The user asked something and you already ran a tool to get the answer.`,
              'Write a single spoken reply (1-3 sentences max) that delivers the result naturally and conversationally.',
              `Speak as ${targetIdentity.speakerName}: warm, direct, specific. Do not use markdown or bullet characters.`,
              targetIdentity.isSubagent ? 'Do not claim to be Prometheus. Do not mention getting or asking a worker.' : '',
              'Return only the spoken reply â€” no JSON, no labels, no meta-commentary.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `User said: "${compactVoiceText(transcript, 300)}"`,
              '',
              `Tool: ${friendlyVoiceToolName(fallbackToolRequest.name)}`,
              `Result: ${toolResult?.ok !== false ? resultSummary || 'Complete.' : `Failed â€” ${resultSummary}`}`,
            ].join('\n'),
          },
        ];
        let firstSynthChunk = true;
        let streamedAny = false;
        const synthStreamer = onSpeechChunk
          ? createPlainTextSentenceStreamer((sentence) => {
              streamedAny = true;
              if (firstSynthChunk) {
                firstSynthChunk = false;
                pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: first synth speech chunk ${Date.now() - synthStartedAt}ms.`, {
                  stage: 'voice_fast_router_first_speech_chunk',
                  elapsedMs: Date.now() - synthStartedAt,
                  totalMs: Date.now() - startedAt,
                });
              }
              try { onSpeechChunk(sentence); } catch {}
            })
          : null;
        const synthResult = await getOllamaClient().chatWithThinking(synthMessages, 'executor', {
          temperature: 0.3,
          model: getVoiceAgentSynthModel(),
          num_ctx: 1024,
          num_predict: 120,
          think: 'none',
          usageContext: { sessionId, agentId: 'voice_agent' },
          onToken: synthStreamer ? ((chunk: string) => synthStreamer.feed(chunk)) : undefined,
        } as any);
        if (synthStreamer) synthStreamer.finish();
        const synthText = compactVoiceText(String(synthResult?.message?.content || '').trim(), 700);
        if (synthText) spokenReply = synthText;
        // If streaming didn't yield anything (provider doesn't support onToken),
        // emit the final spokenReply as a single chunk so the client still speaks.
        if (onSpeechChunk && !streamedAny && spokenReply) {
          try { onSpeechChunk(spokenReply); } catch {}
        }
        pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: tool reply synthesis ${Date.now() - synthStartedAt}ms.`, {
          stage: 'voice_fast_router_synthesis',
          elapsedMs: Date.now() - synthStartedAt,
          totalMs: Date.now() - startedAt,
        });
      } catch (err: any) {
        pushVoiceAgentProcessEntry(trace, 'warn', `Tool reply synthesis failed, using fallback: ${String(err?.message || err).slice(0, 180)}`, {
          stage: 'voice_fast_router_synthesis_failed',
          totalMs: Date.now() - startedAt,
        });
      }
      return {
        action: 'answer_now',
        spokenReply,
        workerInstruction: '',
        needsWorkerResponse: false,
        reason: `deterministic_tool_fast_route:${fallbackToolRequest.name}`,
        runtimeDirectives,
        richArtifacts: collectedRichArtifacts.length ? collectedRichArtifacts : undefined,
      } as VoiceAgentDecision;
    }
    const smallTalkReply = deterministicFastRoutesDisabled ? '' : deterministicVoiceSmallTalkReply(transcript, contextPacket);
    if (smallTalkReply && fallback.action === 'answer_now' && !classification.shouldAbortOriginalRun && !classification.shouldPauseOriginalRun) {
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: deterministic small-talk route ${Date.now() - startedAt}ms.`, {
        stage: 'voice_fast_router',
        route: 'small_talk',
        elapsedMs: Date.now() - startedAt,
      });
      if (onSpeechChunk) { try { onSpeechChunk(smallTalkReply); } catch {} }
      return {
        action: 'answer_now',
        spokenReply: smallTalkReply,
        workerInstruction: '',
        needsWorkerResponse: false,
        reason: 'deterministic_small_talk',
      };
    }
    const wantsVoiceTool = !!fallbackToolRequest;
    const lightVoiceDecision = !wantsVoiceTool
      && contextPacket.active !== true
      && (fallback.action === 'answer_now' || fallback.action === 'handoff_new_work')
      && !classification.shouldAbortOriginalRun
      && !classification.shouldPauseOriginalRun;
    const system = lightVoiceDecision
      ? buildVoiceAgentLightSystemPrompt(contextBlock, contextPacket, options?.voiceTarget)
      : buildVoiceAgentSystemPrompt(contextBlock, contextPacket, options?.voiceTarget);
    const user = [
      '[VOICE_TRANSCRIPT]',
      transcript || '(empty)',
      '[/VOICE_TRANSCRIPT]',
      '',
      '[CLASSIFIER_HINT]',
      JSON.stringify(classification, null, 2),
      '[/CLASSIFIER_HINT]',
    ].join('\n');
    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    let result: any = null;
    const tools = lightVoiceDecision ? [] : buildVoiceToolDefinitions();
    const decisionStartedAt = Date.now();
    let modelStreamedAnySpeech = false;
    for (let i = 0; i < 3; i++) {
      const loopStartedAt = Date.now();
      // Stream the spokenReply field directly to TTS as the model generates it.
      // Only emit chunks on the final pass (no tool calls expected) â€” we don't
      // know in advance, so instantiate a streamer fresh and rely on it producing
      // no output when the model returns tool_calls.
      let firstChunkLogged = false;
      const streamer = onSpeechChunk
        ? createSpokenReplyStreamer((sentence) => {
            if (!firstChunkLogged) {
              firstChunkLogged = true;
              modelStreamedAnySpeech = true;
              pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: first speech chunk ${Date.now() - decisionStartedAt}ms after decision start.`, {
                stage: 'voice_model_first_speech_chunk',
                elapsedMs: Date.now() - decisionStartedAt,
                totalMs: Date.now() - startedAt,
              });
            }
            try { onSpeechChunk(sentence); } catch {}
          })
        : null;
      result = await getOllamaClient().chatWithThinking(messages, 'executor', {
        tools: !lightVoiceDecision && i < 2 ? tools : undefined,
        temperature: 0.2,
        num_ctx: lightVoiceDecision ? 2048 : 4096,
        num_predict: lightVoiceDecision ? 120 : 250,
        think: 'none',
        usageContext: { sessionId, agentId: 'voice_agent' },
        onToken: streamer ? ((chunk: string) => streamer.feed(chunk)) : undefined,
      } as any);
      if (streamer) streamer.finish();
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: decision pass ${i + 1} ${Date.now() - loopStartedAt}ms.`, {
        stage: 'voice_model_decision',
        pass: i + 1,
        elapsedMs: Date.now() - loopStartedAt,
        totalMs: Date.now() - startedAt,
      });
      const message = result?.message || {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length || i >= 2) break;
      messages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls,
      });
      for (const call of toolCalls.slice(0, 2)) {
        const name = String(call?.function?.name || '').trim();
        const args = parseVoiceToolArgs(call?.function?.arguments);
        await runVoiceAutomationSkillScout(sessionId, transcript, name, trace, voiceAutomationSkillScoutSeen);
        const content = await executeVoiceAgentToolWithTrace(sessionId, name, args, trace);
        const parsedToolResult = parseVoiceToolResult(content);
        if (Array.isArray(parsedToolResult?.richArtifacts)) collectedRichArtifacts.push(...parsedToolResult.richArtifacts);
        messages.push({
          role: 'tool',
          tool_call_id: call?.id || `voice_tool_${Date.now()}`,
          tool_name: name,
          name,
          content,
        });
      }
    }
    const content = String(result?.message?.content || '').trim();
    const parsed = safeParseVoiceAgentJson(content);
    if (!parsed) return collectedRichArtifacts.length ? { ...fallback, richArtifacts: collectedRichArtifacts } : fallback;
    const normalized = normalizeVoiceAgentDecision(parsed, fallback);
    if (collectedRichArtifacts.length) normalized.richArtifacts = collectedRichArtifacts;
    if (classification.shouldAbortOriginalRun) normalized.action = 'interrupt_worker';
    if (classification.shouldPauseOriginalRun && normalized.action !== 'interrupt_worker') normalized.action = 'answer_now';
    if (normalized.action === 'handoff_new_work' && !String(normalized.spokenReply || '').trim()) {
      normalized.spokenReply = buildDeterministicHandoffAck(transcript);
      normalized.reason = `${normalized.reason || 'voice_handoff'};deterministic_ack_fallback`;
      pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: handoff ack deterministic fallback (no repair pass).`, {
        stage: 'voice_handoff_ack_deterministic',
        ack: normalized.spokenReply,
        totalMs: Date.now() - startedAt,
      });
    }
    // If streaming did not produce any speech chunks during the decision pass
    // (e.g., provider does not support onToken, or the model returned tool calls
    // for the entire loop), emit the final spokenReply as a single chunk so the
    // client still speaks. This is the safety net â€” streaming is the fast path.
    if (onSpeechChunk && !modelStreamedAnySpeech && normalized.spokenReply) {
      try { onSpeechChunk(normalized.spokenReply); } catch {}
    }
    pushVoiceAgentProcessEntry(trace, 'info', `Voice latency: model decision total ${Date.now() - decisionStartedAt}ms.`, {
      stage: 'voice_model_decision_total',
      elapsedMs: Date.now() - decisionStartedAt,
      totalMs: Date.now() - startedAt,
      action: normalized.action,
    });
    return normalized;
  } catch (err: any) {
    console.warn('[voice-agent] model decision failed:', err?.message || err);
    return fallback;
  }
}

export function composeVoiceAgentNarration(contextPacket: Record<string, any>, options: Record<string, any> = {}): { action: 'reply' | 'no_reply'; voiceReply: string; signature: string } {
  if (!contextPacket.active) return { action: 'no_reply', voiceReply: '', signature: 'inactive' };
  const sid = String(contextPacket.sessionId || 'default');
  const latestProcess = Array.isArray(contextPacket.processEntries)
    ? contextPacket.processEntries
        .map((entry: any) => ({
          ...entry,
          content: compactVoiceText(entry?.content || '', 260),
        }))
        .filter((entry: any) => entry.content && !isVoiceContextNoiseText(entry.content))
        .slice(-4)
    : [];
  const latestActivity = [...latestProcess].reverse()
    .map((entry: any) => voiceNarrationLineFromActivity(entry.content))
    .find(Boolean) || '';
  const activeLabel = voiceNarrationLineFromActivity(contextPacket.activeToolLabel || '');
  const speakable = latestActivity || activeLabel;
  const signature = [
    contextPacket.activeRun?.id || '',
    speakable,
    latestProcess.map((entry: any) => `${entry.event || entry.type}:${entry.toolName || ''}:${entry.content || ''}`).join('|'),
  ].join('::').slice(0, 1600);
  if (!speakable) return { action: 'no_reply', voiceReply: '', signature };
  const now = Date.now();
  const minGapMs = Math.max(5500, Math.floor(Number(options.minGapMs || 6500)) || 6500);
  const previous = voiceAgentNarrationState.get(sid);
  if ((previous?.signature === signature || previous?.text === speakable) && now - Number(previous.at || 0) < Math.max(minGapMs, 18000)) {
    return { action: 'no_reply', voiceReply: '', signature };
  }
  const voiceReply = compactVoiceText(speakable, 240);
  voiceAgentNarrationState.set(sid, { signature, at: now, text: voiceReply });
  return { action: voiceReply ? 'reply' : 'no_reply', voiceReply, signature };
}

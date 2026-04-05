/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { CancellationToken, LanguageModelChatMessage, LanguageModelDataPart, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { CustomDataPartMimeTypes } from '../../../platform/endpoint/common/endpointTypes';
import { buildToolInputSchema } from '../../../platform/endpoint/node/messagesApi';
import { ILogService } from '../../../platform/log/common/logService';
import { APIUsage } from '../../../platform/networking/common/openai';
import { apiMessageToAnthropicMessage } from '../common/anthropicMessageConverter';
import { BYOKKnownModels, byokKnownModelsToAPIInfo, LMResponsePart } from '../common/byokProvider';
import { AbstractLanguageModelChatProvider, ExtendedLanguageModelChatInformation, LanguageModelChatConfiguration } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';

const ZHIPU_STATIC_MODELS: BYOKKnownModels = {
	'glm-4.7': {
		name: 'GLM-4.7',
		maxInputTokens: 200_000,
		maxOutputTokens: 128_000,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'glm-4.7-flash': {
		name: 'GLM-4.7 Flash',
		maxInputTokens: 200_000,
		maxOutputTokens: 128_000,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'glm-4.5-air': {
		name: 'GLM-4.5 Air',
		maxInputTokens: 128_000,
		maxOutputTokens: 96_000,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'glm-5-turbo': {
		name: 'GLM-5 Turbo',
		maxInputTokens: 200_000,
		maxOutputTokens: 128_000,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'glm-5.1': {
		name: 'GLM-5.1',
		maxInputTokens: 200_000,
		maxOutputTokens: 128_000,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
};

export class ZhipuLMProvider extends AbstractLanguageModelChatProvider {

	public static readonly providerName = 'Zhipu';

	constructor(
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
	) {
		super(
			ZhipuLMProvider.providerName.toLowerCase(),
			ZhipuLMProvider.providerName,
			ZHIPU_STATIC_MODELS,
			byokStorageService,
			logService,
		);
	}

	protected async getAllModels(silent: boolean, apiKey: string | undefined): Promise<ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		if (!apiKey && silent) {
			return [];
		}

		// Zhipu uses a static model list. Return it for interactive model enumeration even
		// before the user has saved an API key, otherwise the picker renders as empty.
		return byokKnownModelsToAPIInfo(this._name, ZHIPU_STATIC_MODELS) as ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>[];
	}

	async provideLanguageModelChatResponse(
		model: ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>,
		messages: Array<import('vscode').LanguageModelChatMessage | import('vscode').LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken,
	): Promise<void> {
		const apiKey = model.configuration?.apiKey;
		if (!apiKey) {
			throw new Error('API key not found for the model');
		}

		const anthropicClient = new Anthropic({
			apiKey,
			baseURL: ZHIPU_BASE_URL,
		});

		const { system, messages: convertedMessages } = apiMessageToAnthropicMessage(messages as LanguageModelChatMessage[]);

		// Build tools array for Anthropic-compatible API
		const tools: Anthropic.Tool[] = [];
		for (const tool of (options.tools ?? [])) {
			if (!tool.inputSchema) {
				tools.push({
					name: tool.name,
					description: tool.description,
					input_schema: {
						type: 'object',
						properties: {},
						required: [],
					},
				});
				continue;
			}

			tools.push({
				name: tool.name,
				description: tool.description,
				input_schema: buildToolInputSchema(tool.inputSchema as Record<string, unknown>),
			});
		}

		const params: Anthropic.Messages.MessageCreateParamsStreaming = {
			model: model.id,
			messages: convertedMessages,
			max_tokens: model.maxOutputTokens,
			stream: true,
			system: [system],
			tools: tools.length > 0 ? tools : undefined,
		};

		// Zhipu GLM-4.7 models have thinking enabled by default;
		// don't override the budget to avoid consuming the entire max_tokens budget.
		// The model handles thinking token allocation internally.

		await this._makeRequest(anthropicClient, progress, params, token);
	}

	async provideTokenCount(
		model: import('vscode').LanguageModelChatInformation,
		text: string | import('vscode').LanguageModelChatMessage | import('vscode').LanguageModelChatMessage2,
		token: CancellationToken,
	): Promise<number> {
		// Extract text content from messages before counting
		if (typeof text !== 'string') {
			const content = text.content;
			if (Array.isArray(content)) {
				const parts = content as Array<{ value?: string; text?: string }>;
				const extracted = parts
					.map(p => p.value ?? p.text ?? '')
					.filter(Boolean)
					.join('');
				return Math.ceil(extracted.length / 4);
			}
			return Math.ceil(String(content).length / 4);
		}
		return Math.ceil(text.length / 4);
	}

	private async _makeRequest(
		anthropicClient: Anthropic,
		progress: Progress<LMResponsePart>,
		params: Anthropic.Messages.MessageCreateParamsStreaming,
		token: CancellationToken,
	): Promise<void> {
		const stream = await anthropicClient.messages.create(params);

		let pendingToolCall: {
			toolId?: string;
			name?: string;
			jsonInput?: string;
		} | undefined;
		let pendingThinking: {
			thinking?: string;
			signature?: string;
		} | undefined;
		// Track usage across SSE events, aligned with AnthropicMessagesProcessor in messagesApi.ts
		let inputTokens = 0;
		let outputTokens = 0;
		let cacheCreationTokens = 0;
		let cacheReadTokens = 0;
		let gotMessageStart = false;

		for await (const chunk of stream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (chunk.type === 'content_block_start') {
				if ('content_block' in chunk && chunk.content_block.type === 'tool_use') {
					pendingToolCall = {
						toolId: chunk.content_block.id,
						name: chunk.content_block.name,
						jsonInput: '',
					};
				} else if ('content_block' in chunk && chunk.content_block.type === 'thinking') {
					pendingThinking = {
						thinking: '',
						signature: '',
					};
				}
				continue;
			}

			if (chunk.type === 'content_block_delta') {
				if (chunk.delta.type === 'text_delta') {
					progress.report(new LanguageModelTextPart(chunk.delta.text || ''));
				} else if (chunk.delta.type === 'thinking_delta') {
					if (pendingThinking) {
						pendingThinking.thinking = (pendingThinking.thinking || '') + (chunk.delta.thinking || '');
						progress.report(new LanguageModelThinkingPart(chunk.delta.thinking || ''));
					}
				} else if (chunk.delta.type === 'signature_delta') {
					if (pendingThinking) {
						pendingThinking.signature = (pendingThinking.signature || '') + (chunk.delta.signature || '');
					}
				} else if (chunk.delta.type === 'input_json_delta' && pendingToolCall) {
					pendingToolCall.jsonInput = (pendingToolCall.jsonInput || '') + (chunk.delta.partial_json || '');

					try {
						const parsedJson = JSON.parse(pendingToolCall.jsonInput);
						progress.report(new LanguageModelToolCallPart(
							pendingToolCall.toolId!,
							pendingToolCall.name!,
							parsedJson,
						));
						pendingToolCall = undefined;
					} catch {
						// JSON is not complete yet, continue accumulating
						continue;
					}
				}
			}

			if (chunk.type === 'content_block_stop') {
				if (pendingToolCall) {
					try {
						const parsedJson = JSON.parse(pendingToolCall.jsonInput || '{}');
						progress.report(new LanguageModelToolCallPart(
							pendingToolCall.toolId!,
							pendingToolCall.name!,
							parsedJson,
						));
					} catch (e) {
						this._logService.error('Failed to parse tool call JSON:', e);
					}
					pendingToolCall = undefined;
				} else if (pendingThinking) {
					if (pendingThinking.signature) {
						const finalThinkingPart = new LanguageModelThinkingPart('');
						finalThinkingPart.metadata = {
							signature: pendingThinking.signature,
							_completeThinking: pendingThinking.thinking,
						};
						progress.report(finalThinkingPart);
					}
					pendingThinking = undefined;
				}
			}

			if (chunk.type === 'message_start') {
				// Initialize token counts from message_start (most reliable initial values)
				inputTokens = chunk.message.usage.input_tokens ?? 0;
				outputTokens = chunk.message.usage.output_tokens ?? 0;
				cacheCreationTokens = chunk.message.usage.cache_creation_input_tokens ?? 0;
				cacheReadTokens = chunk.message.usage.cache_read_input_tokens ?? 0;
				gotMessageStart = true;
			} else if (chunk.type === 'message_delta' && chunk.usage) {
				// message_delta provides the most accurate token counts — update all fields,
				// preserving existing values when the delta doesn't include them (null).
				// Aligned with AnthropicMessagesProcessor in messagesApi.ts.
				inputTokens = chunk.usage.input_tokens ?? inputTokens;
				outputTokens = chunk.usage.output_tokens;
				cacheCreationTokens = chunk.usage.cache_creation_input_tokens ?? cacheCreationTokens;
				cacheReadTokens = chunk.usage.cache_read_input_tokens ?? cacheReadTokens;
			}
		}

		// Emit usage data part so ExtensionContributedChatEndpoint can extract real usage.
		// Always emit if we got a message_start — don't gate on completion_tokens >= 0,
		// since thinking mode may produce intermediate message_delta with output_tokens=0.
		if (gotMessageStart) {
			const computedPromptTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
			const usage: APIUsage = {
				prompt_tokens: computedPromptTokens,
				completion_tokens: outputTokens,
				total_tokens: computedPromptTokens + outputTokens,
				prompt_tokens_details: { cached_tokens: cacheReadTokens },
			};
			progress.report(new LanguageModelDataPart(
				new TextEncoder().encode(JSON.stringify(usage)),
				CustomDataPartMimeTypes.Usage,
			));
		}
	}
}

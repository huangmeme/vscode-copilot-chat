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

/**
 * Base class for Anthropic-compatible API providers (Zhipu, Tencent, Aliyun, etc.)
 * Handles streaming responses, tool calls, thinking blocks, and usage tracking.
 */
export abstract class AbstractAnthropicCompatibleLMProvider extends AbstractLanguageModelChatProvider {

	constructor(
		providerId: string,
		providerName: string,
		protected readonly _staticModels: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
	) {
		super(providerId, providerName, _staticModels, byokStorageService, logService);
	}

	/**
	 * The base URL for the Anthropic-compatible API endpoint.
	 */
	protected abstract readonly baseURL: string;

	protected async getAllModels(silent: boolean, apiKey: string | undefined): Promise<ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		if (!apiKey && silent) {
			return [];
		}

		// Static model list — return even before API key is saved so the picker renders properly
		return byokKnownModelsToAPIInfo(this._name, this._staticModels) as ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>[];
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
			baseURL: this.baseURL,
		});

		const { system, messages: convertedMessages } = apiMessageToAnthropicMessage(messages as LanguageModelChatMessage[]);

		const tools = this._buildAnthropicTools(options.tools);

		const thinkingConfig = this._getThinkingConfig(model.id, model.maxOutputTokens);

		const params: Anthropic.Messages.MessageCreateParamsStreaming = {
			model: model.id,
			messages: convertedMessages,
			max_tokens: model.maxOutputTokens,
			stream: true,
			system: [system],
			tools: tools.length > 0 ? tools : undefined,
			thinking: thinkingConfig,
		};

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

	/**
	 * Build tools array for Anthropic-compatible API.
	 */
	protected _buildAnthropicTools(tools: ProvideLanguageModelChatResponseOptions['tools']): Anthropic.Tool[] {
		const result: Anthropic.Tool[] = [];
		for (const tool of (tools ?? [])) {
			if (!tool.inputSchema) {
				result.push({
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

			result.push({
				name: tool.name,
				description: tool.description,
				input_schema: buildToolInputSchema(tool.inputSchema as Record<string, unknown>),
			});
		}
		return result;
	}

	/**
	 * Get thinking configuration for the model.
	 * Override this method to customize thinking budget behavior.
	 */
	protected _getThinkingConfig(modelId: string, maxOutputTokens: number): Anthropic.Messages.MessageCreateParamsStreaming['thinking'] {
		const modelCapabilities = this._staticModels[modelId];
		if (modelCapabilities?.thinking) {
			return { type: 'enabled', budget_tokens: this._getThinkingBudget(modelId, maxOutputTokens) };
		}
		return undefined;
	}

	/**
	 * Get thinking budget in tokens.
	 * Default implementation uses a fixed budget of 10000.
	 * Override to provide custom logic (e.g., config-based or model-specific).
	 */
	protected _getThinkingBudget(_modelId: string, _maxOutputTokens: number): number {
		return 10000;
	}

	private async _makeRequest(
		anthropicClient: Anthropic,
		progress: Progress<LMResponsePart>,
		params: Anthropic.Messages.MessageCreateParamsStreaming,
		token: CancellationToken,
	): Promise<void> {
		let stream: Awaited<ReturnType<typeof anthropicClient.messages.create>> | undefined;

		try {
			stream = await anthropicClient.messages.create(params);

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
					stream.controller.abort();
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
		} catch (e) {
			this._logService.error(`[${this._name}] API request failed:`, e);
			throw e;
		}
	}
}

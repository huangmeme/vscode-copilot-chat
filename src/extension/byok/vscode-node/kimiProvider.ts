/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { CancellationToken, LanguageModelChatMessage, LanguageModelResponsePart2, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { apiMessageToAnthropicMessage } from '../common/anthropicMessageConverter';
import { BYOKKnownModels } from '../common/byokProvider';
import { AbstractAnthropicCompatibleLMProvider } from './abstractAnthropicCompatibleProvider';
import { ExtendedLanguageModelChatInformation, LanguageModelChatConfiguration } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

// https://platform.kimi.com/docs/guide/agent-support
const KIMI_BASE_URL = 'https://api.moonshot.cn/anthropic';

const KIMI_STATIC_MODELS: BYOKKnownModels = {
	'kimi-k2.5': {
		name: 'Kimi K2.5',
		maxInputTokens: 262_144,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: true,
		thinking: true,
	},
	'kimi-k2.6': {
		name: 'Kimi K2.6',
		maxInputTokens: 262_144,
		maxOutputTokens: 131_072,
		toolCalling: true,
		vision: true,
		thinking: true,
	},
};

export class KimiLMProvider extends AbstractAnthropicCompatibleLMProvider {

	public static readonly providerName = 'Kimi';
	protected readonly baseURL = KIMI_BASE_URL;

	constructor(
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
	) {
		super(
			KimiLMProvider.providerName.toLowerCase(),
			KimiLMProvider.providerName,
			KIMI_STATIC_MODELS,
			byokStorageService,
			logService,
		);
	}

	/**
	 * Override to patch assistant messages: Kimi's Anthropic-compatible API requires that
	 * when thinking is enabled, every assistant message containing tool_use blocks must also
	 * include a thinking block. VS Code's conversation history may not preserve thinking
	 * parts from previous turns, so we inject a minimal thinking block when missing.
	 */
	override async provideLanguageModelChatResponse(
		model: ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>,
		messages: Array<LanguageModelChatMessage>,
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

		const { system, messages: convertedMessages } = apiMessageToAnthropicMessage(messages);

		// Patch assistant messages: ensure thinking blocks are present alongside tool_use blocks
		const thinkingConfig = this._getThinkingConfig(model.id, model.maxOutputTokens);
		if (thinkingConfig) {
			this._ensureThinkingWithToolUse(convertedMessages);
		}

		const tools = this._buildAnthropicTools(options.tools);

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

	/**
	 * Ensure every assistant message that has tool_use blocks also has a thinking block.
	 * Kimi's API enforces this when thinking is enabled.
	 */
	private _ensureThinkingWithToolUse(messages: Anthropic.MessageParam[]): void {
		for (const message of messages) {
			if (message.role !== 'assistant' || !Array.isArray(message.content)) {
				continue;
			}
			const content = message.content as Anthropic.ContentBlockParam[];
			const hasToolUse = content.some(block => block.type === 'tool_use');
			const hasThinking = content.some(block => block.type === 'thinking' || block.type === 'redacted_thinking');
			if (hasToolUse && !hasThinking) {
				// Inject a minimal thinking block at the beginning of the content
				content.unshift({
					type: 'thinking',
					thinking: ' ',
					signature: '',
				});
			}
		}
	}
}

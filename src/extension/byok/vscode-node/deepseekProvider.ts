/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { BYOKKnownModels } from '../common/byokProvider';
import { AbstractAnthropicCompatibleLMProvider } from './abstractAnthropicCompatibleProvider';
import { IBYOKStorageService } from './byokStorageService';

// https://api-docs.deepseek.com/zh-cn/guides/anthropic_api
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic';

const DEEPSEEK_STATIC_MODELS: BYOKKnownModels = {
	'deepseek-chat': {
		name: 'DeepSeek Chat (V3.2)',
		maxInputTokens: 131_072,
		maxOutputTokens: 8_192,
		toolCalling: true,
		vision: false,
		thinking: false,
	},
	'deepseek-reasoner': {
		name: 'DeepSeek Reasoner (V3.2)',
		maxInputTokens: 131_072,
		maxOutputTokens: 65_536,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
};

export class DeepSeekLMProvider extends AbstractAnthropicCompatibleLMProvider {

	public static readonly providerName = 'DeepSeek';
	protected readonly baseURL = DEEPSEEK_BASE_URL;

	constructor(
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
	) {
		super(
			DeepSeekLMProvider.providerName.toLowerCase(),
			DeepSeekLMProvider.providerName,
			DEEPSEEK_STATIC_MODELS,
			byokStorageService,
			logService,
		);
	}
}

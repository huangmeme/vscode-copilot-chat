/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { BYOKKnownModels } from '../common/byokProvider';
import { AbstractAnthropicCompatibleLMProvider } from './abstractAnthropicCompatibleProvider';
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

export class ZhipuLMProvider extends AbstractAnthropicCompatibleLMProvider {

	public static readonly providerName = 'Zhipu';
	protected readonly baseURL = ZHIPU_BASE_URL;

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
}

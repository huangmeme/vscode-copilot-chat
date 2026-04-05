/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { BYOKKnownModels } from '../common/byokProvider';
import { AbstractAnthropicCompatibleLMProvider } from './abstractAnthropicCompatibleProvider';
import { IBYOKStorageService } from './byokStorageService';

// https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api
const ALIYUN_CODING_PLAN_BASE_URL = 'https://coding.dashscope.aliyuncs.com/apps/anthropic';

const ALIYUN_CODING_PLAN_STATIC_MODELS: BYOKKnownModels = {
	'qwen3.5-plus': {
		name: 'Qwen3.5 Plus',
		maxInputTokens: 983616,
		maxOutputTokens: 65536,
		toolCalling: true,
		vision: true,
		thinking: true,
	},
	'kimi-k2.5': {
		name: 'Kimi K2.5',
		maxInputTokens: 258048,
		maxOutputTokens: 98304,
		toolCalling: true,
		vision: true,
		thinking: true,
	},
	'glm-5': {
		name: 'GLM-5',
		maxInputTokens: 202752,
		maxOutputTokens: 16384,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'MiniMax-M2.5': {
		name: 'MiniMax M2.5',
		maxInputTokens: 196601,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: false,
	},
};

export class AliyunCodingPlanLMProvider extends AbstractAnthropicCompatibleLMProvider {

	public static readonly providerName = 'AliyunCodingPlan';
	protected readonly baseURL = ALIYUN_CODING_PLAN_BASE_URL;

	constructor(
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
	) {
		super(
			AliyunCodingPlanLMProvider.providerName.toLowerCase(),
			AliyunCodingPlanLMProvider.providerName,
			ALIYUN_CODING_PLAN_STATIC_MODELS,
			byokStorageService,
			logService,
		);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { BYOKKnownModels } from '../common/byokProvider';
import { AbstractAnthropicCompatibleLMProvider } from './abstractAnthropicCompatibleProvider';
import { IBYOKStorageService } from './byokStorageService';

// https://cloud.tencent.com/document/product/1772/128947
const TENCENT_CODING_PLAN_BASE_URL = 'https://api.lkeap.cloud.tencent.com/coding/anthropic';

const TENCENT_CODING_PLAN_STATIC_MODELS: BYOKKnownModels = {
	'tc-code-latest': {
		name: 'Auto',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'hunyuan-2.0-instruct': {
		name: 'Tencent HY 2.0 Instruct',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'hunyuan-2.0-thinking': {
		name: 'Tencent HY 2.0 Think',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'minimax-m2.5': {
		name: 'MiniMax-M2.5',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'kimi-k2.5': {
		name: 'Kimi-K2.5',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'glm-5': {
		name: 'GLM-5',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'hunyuan-t1': {
		name: 'Hunyuan-T1',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
	'hunyuan-turbos': {
		name: 'Hunyuan-TurboS',
		maxInputTokens: 196608,
		maxOutputTokens: 32768,
		toolCalling: true,
		vision: false,
		thinking: true,
	},
};

export class TencentCodingPlanLMProvider extends AbstractAnthropicCompatibleLMProvider {

	public static readonly providerName = 'TencentCodingPlan';
	protected readonly baseURL = TENCENT_CODING_PLAN_BASE_URL;

	constructor(
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
	) {
		super(
			TencentCodingPlanLMProvider.providerName.toLowerCase(),
			TencentCodingPlanLMProvider.providerName,
			TENCENT_CODING_PLAN_STATIC_MODELS,
			byokStorageService,
			logService,
		);
	}
}

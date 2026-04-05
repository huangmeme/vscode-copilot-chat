/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { IBYOKStorageService } from '../byokStorageService';
import { ZhipuLMProvider } from '../zhipuProvider';

function createStorageService(overrides?: Partial<IBYOKStorageService>): IBYOKStorageService {
	return {
		getAPIKey: vi.fn().mockResolvedValue(undefined),
		storeAPIKey: vi.fn().mockResolvedValue(undefined),
		deleteAPIKey: vi.fn().mockResolvedValue(undefined),
		getStoredModelConfigs: vi.fn().mockResolvedValue({}),
		saveModelConfig: vi.fn().mockResolvedValue(undefined),
		removeModelConfig: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createLogService() {
	const logService = {
		_serviceBrand: undefined,
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		show: vi.fn(),
		createSubLogger: vi.fn(),
		withExtraTarget: vi.fn(),
	};
	logService.createSubLogger.mockReturnValue(logService);
	logService.withExtraTarget.mockReturnValue(logService);
	return logService;
}

describe('ZhipuLMProvider', () => {
	it('returns static models for interactive enumeration without an API key', async () => {
		const provider = new ZhipuLMProvider(createStorageService(), createLogService() as any);
		const tokenSource = new vscode.CancellationTokenSource();

		const models = await provider.provideLanguageModelChatInformation({ silent: false }, tokenSource.token);

		expect(models.map(model => model.id)).toEqual(['glm-4.7', 'glm-4.7-flash', 'glm-4.5-air', 'glm-5-turbo', 'glm-5.1']);
	});

	it('returns no models for silent discovery without an API key', async () => {
		const provider = new ZhipuLMProvider(createStorageService(), createLogService() as any);
		const tokenSource = new vscode.CancellationTokenSource();

		const models = await provider.provideLanguageModelChatInformation({ silent: true }, tokenSource.token);

		expect(models).toEqual([]);
	});
});

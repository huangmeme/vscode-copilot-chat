/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IConversationOptions } from '../../../platform/chat/common/conversationOptions';
import { IInteractionService } from '../../../platform/chat/common/interactionService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { Diff } from '../../../platform/git/common/gitDiffService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { INotificationService } from '../../../platform/notification/common/notificationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { GitCommitMessagePrompt } from '../../prompts/node/git/gitCommitMessagePrompt';
import { RecentCommitMessages } from '../common/repository';

type ResponseFormat = 'noTextCodeBlock' | 'oneTextCodeBlock' | 'multipleTextCodeBlocks';

export class GitCommitMessageGenerator {
	constructor(
		@IConversationOptions private readonly conversationOptions: IConversationOptions,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInteractionService private readonly interactionService: IInteractionService,
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@IFetcherService private readonly fetcherService: IFetcherService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) { }

	async generateGitCommitMessage(repositoryName: string, branchName: string, changes: Diff[], recentCommitMessages: RecentCommitMessages, attemptCount: number, token: CancellationToken): Promise<string | undefined> {
		const startTime = Date.now();

		// 检查是否启用了自定义 endpoint
		const useCustomEndpoint = this.configurationService.getConfig(ConfigKey.GitCommitMessageCustomEndpointEnabled);

		if (useCustomEndpoint) {
			// 使用自定义 endpoint
			return this.generateWithCustomEndpoint(repositoryName, branchName, changes, recentCommitMessages, attemptCount, token, startTime);
		}

		// 使用默认的 copilot-fast endpoint
		const endpoint = await this.endpointProvider.getChatEndpoint('copilot-fast');
		const promptRenderer = PromptRenderer.create(this.instantiationService, endpoint, GitCommitMessagePrompt, { repositoryName, branchName, changes, recentCommitMessages });
		const prompt = await promptRenderer.render(undefined, undefined);

		const temperature = Math.min(
			this.conversationOptions.temperature * (1 + attemptCount),
			2 /* MAX temperature - https://platform.openai.com/docs/api-reference/chat/create#chat/create-temperature */
		);

		const requestStartTime = Date.now();
		this.interactionService.startInteraction();
		const fetchResult = await endpoint
			.makeChatRequest(
				'gitCommitMessageGenerator',
				prompt.messages,
				undefined,
				token,
				ChatLocation.Other,
				undefined,
				{ temperature },
				true
			);

		/* __GDPR__
			"git.generateCommitMessage" : {
				"owner": "lszomoru",
				"comment": "Metadata about the git commit message generation",
				"model": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The model that is used in the endpoint." },
				"requestId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The id of the current request turn." },
				"responseType": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The result type of the response." },
				"attemptCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "How many times the user has retried." },
				"diffFileCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The number of files in the commit." },
				"diffLength": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The length of the diffs in the commit." },
				"timeToRequest": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true, "comment": "How long it took to start the request." },
				"timeToComplete": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true, "comment": "How long it took to complete the request." }
			}
		*/
		this.telemetryService.sendMSFTTelemetryEvent('git.generateCommitMessage', {
			model: endpoint.model,
			requestId: fetchResult.requestId,
			responseType: fetchResult.type
		}, {
			attemptCount: attemptCount + 1,
			diffFileCount: changes.length,
			diffLength: changes.map(c => c.diff).join('').length,
			timeToRequest: requestStartTime - startTime,
			timeToComplete: Date.now() - startTime
		});

		if (fetchResult.type === ChatFetchResponseType.QuotaExceeded || (fetchResult.type === ChatFetchResponseType.RateLimited && this.authService.copilotToken?.isNoAuthUser)) {
			await this.notificationService.showQuotaExceededDialog({ isNoAuthUser: this.authService.copilotToken?.isNoAuthUser ?? false });
			return undefined;
		}

		if (fetchResult.type !== ChatFetchResponseType.Success) {
			return undefined;
		}

		const [responseFormat, commitMessage] = this.processGeneratedCommitMessage(fetchResult.value);
		if (responseFormat !== 'oneTextCodeBlock') {
			/* __GDPR__
				"git.generateCommitMessageIncorrectResponseFormat" : {
					"owner": "lszomoru",
					"comment": "Metadata about the git commit message generation when the response is not in the expected format",
					"requestId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The id of the current request turn." },
					"responseFormat": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The type of the response format." }
				}
			*/
			this.telemetryService.sendMSFTTelemetryEvent('git.generateCommitMessageIncorrectResponseFormat', { requestId: fetchResult.requestId, responseFormat });
		}

		return commitMessage;
	}

	private async generateWithCustomEndpoint(repositoryName: string, branchName: string, changes: Diff[], recentCommitMessages: RecentCommitMessages, attemptCount: number, token: CancellationToken, startTime: number): Promise<string | undefined> {
		const customUrl = this.configurationService.getConfig(ConfigKey.GitCommitMessageCustomEndpointUrl);
		const customApiKey = this.configurationService.getConfig(ConfigKey.GitCommitMessageCustomEndpointApiKey);
		const customModel = this.configurationService.getConfig(ConfigKey.GitCommitMessageCustomEndpointModel);

		if (!customUrl || !customApiKey) {
			await this.notificationService.showWarningMessage('自定义大模型服务配置不完整。请检查 URL 和 API Key 配置。');
			return undefined;
		}

		try {
			// 直接构造提示词，不使用 PromptRenderer 和 getChatEndpoint，避免触发 Copilot 计费
			const systemMessage = `You are an AI programming assistant, helping a software developer to come with the best git commit message for their code changes.
You excel in interpreting the purpose behind code changes to craft succinct, clear commit messages that adhere to the repository's guidelines.

# First, think step-by-step:
1. Analyze the CODE CHANGES thoroughly to understand what's been modified.
2. Use the ORIGINAL CODE to understand the context of the CODE CHANGES. Use the line numbers to map the CODE CHANGES to the ORIGINAL CODE.
3. Identify the purpose of the changes to answer the *why* for the commit messages, also considering the optionally provided RECENT USER COMMITS.
4. Review the provided RECENT REPOSITORY COMMITS to identify established commit message conventions. Focus on the format and style, ignoring commit-specific details like refs, tags, and authors.
5. Generate a thoughtful and succinct commit message for the given CODE CHANGES. It MUST follow the the established writing conventions.
6. Remove any meta information like issue references, tags, or author names from the commit message. The developer will add them.
7. Now only show your message, wrapped with a single markdown \`\`\`text codeblock! Do not provide any explanations or details

Follow Microsoft content policies.
Avoid content that violates copyrights.
If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with "Sorry, I can't assist with that."
Keep your answers short and impersonal.`;

			let userMessage = `# REPOSITORY DETAILS:
Repository name: ${repositoryName}
Branch name: ${branchName}

`;

			// 添加用户最近的提交（如果有）
			if (recentCommitMessages.user.length > 0) {
				userMessage += `# RECENT USER COMMITS (For reference only, do not copy!):\n`;
				userMessage += recentCommitMessages.user.map(msg => `- ${msg}`).join('\n') + '\n\n';
			}

			// 添加仓库最近的提交（如果有）
			if (recentCommitMessages.repository.length > 0) {
				userMessage += `# RECENT REPOSITORY COMMITS (For reference only, do not copy!):\n`;
				userMessage += recentCommitMessages.repository.map(msg => `- ${msg}`).join('\n') + '\n\n';
			}

			// 添加代码变更
			for (const change of changes) {
				userMessage += `# CODE CHANGES:\n\`\`\`diff\n${change.diff}\n\`\`\`\n\n`;
			}

			userMessage += `Now generate a commit messages that describe the CODE CHANGES.
DO NOT COPY commits from RECENT COMMITS, but use it as reference for the commit style.
ONLY return a single markdown code block, NO OTHER PROSE!
\`\`\`text
commit message goes here
\`\`\``;

			const openAIMessages = [
				{ role: 'system', content: systemMessage },
				{ role: 'user', content: userMessage }
			];

			const temperature = Math.min(
				this.conversationOptions.temperature * (1 + attemptCount),
				2
			);

			// 调用自定义 API
			const requestStartTime = Date.now();
			const requestBody = JSON.stringify({
				model: customModel,
				messages: openAIMessages,
				temperature: temperature,
				stream: false
			});

			// 将 CancellationToken 转换为 AbortSignal
			const abortController = new AbortController();
			const disposable = token.onCancellationRequested(() => {
				abortController.abort();
			});

			let response;
			try {
				response = await this.fetcherService.fetch(customUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${customApiKey}`
					},
					body: requestBody,
					signal: abortController.signal,
					timeout: 60000 // 添加 60 秒超时
				});
			} finally {
				disposable.dispose();
			}

			/* __GDPR__
				"git.generateCommitMessage.customEndpoint" : {
					"owner": "lszomoru",
					"comment": "Metadata about the git commit message generation using custom endpoint",
					"model": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The model that is used in the custom endpoint." },
					"attemptCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "How many times the user has retried." },
					"diffFileCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The number of files in the commit." },
					"diffLength": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The length of the diffs in the commit." },
					"timeToRequest": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true, "comment": "How long it took to start the request." },
					"timeToComplete": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true, "comment": "How long it took to complete the request." },
					"success": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether the request was successful." }
				}
			*/
			this.telemetryService.sendMSFTTelemetryEvent('git.generateCommitMessage.customEndpoint', {
				model: customModel,
				success: response.ok ? 'true' : 'false'
			}, {
				attemptCount: attemptCount + 1,
				diffFileCount: changes.length,
				diffLength: changes.map(c => c.diff).join('').length,
				timeToRequest: requestStartTime - startTime,
				timeToComplete: Date.now() - startTime
			});

			if (!response.ok) {
				const errorText = await response.text();
				await this.notificationService.showWarningMessage(`自定义大模型服务请求失败: ${response.status} ${response.statusText}\n${errorText}`);
				return undefined;
			}

			const data = await response.json();
			const rawMessage = data.choices?.[0]?.message?.content || '';

			const [responseFormat, commitMessage] = this.processGeneratedCommitMessage(rawMessage);
			if (responseFormat !== 'oneTextCodeBlock') {
				this.telemetryService.sendMSFTTelemetryEvent('git.generateCommitMessageIncorrectResponseFormat', {
					requestId: 'custom-endpoint',
					responseFormat
				});
			}

			return commitMessage;
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			await this.notificationService.showWarningMessage(`调用自定义大模型服务时出错: ${errorMessage}`);
			this.telemetryService.sendMSFTTelemetryEvent('git.generateCommitMessage.customEndpoint', {
				model: customModel,
				success: 'false',
				error: errorMessage
			}, {
				attemptCount: attemptCount + 1,
				diffFileCount: changes.length,
				diffLength: changes.map(c => c.diff).join('').length,
				timeToRequest: 0,
				timeToComplete: Date.now() - startTime
			});
			return undefined;
		}
	}

	private processGeneratedCommitMessage(raw: string): [ResponseFormat, string] {
		const textCodeBlockRegex = /^```text\s*([\s\S]+?)\s*```$/m;
		const textCodeBlockMatch = textCodeBlockRegex.exec(raw);

		if (textCodeBlockMatch === null) {
			return ['noTextCodeBlock', raw];
		}
		if (textCodeBlockMatch.length !== 2) {
			return ['multipleTextCodeBlocks', raw];
		}

		return ['oneTextCodeBlock', textCodeBlockMatch[1]];
	}
}

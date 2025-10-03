/**
 * Copyright 2025 Justin Lai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface CommitInfo {
    hash: string;
    author: string;
    date: string;
    message: string;
    diff?: string;
    filename?: string;
}

export interface PullRequestInfo {
    number: number;
    title: string;
    body: string;
    author: string;
    url: string;
    createdAt: string;
    mergedAt: string;
    comments: PullRequestComment[];
    linkedIssues: LinkedIssue[];
}

export interface PullRequestComment {
    author: string;
    body: string;
    createdAt: string;
}

export interface LinkedIssue {
    number: number;
    title: string;
    url: string;
}

export interface GitAnalysisResult {
    commits: CommitInfo[];
    pullRequests: PullRequestInfo[];
    timeline: TimelineItem[];
}

export interface TimelineItem {
    type: 'commit' | 'pullRequest';
    date: string;
    data: CommitInfo | PullRequestInfo;
}

export interface CodeArchResults {
    summary: string;
    analysisResult: GitAnalysisResult;
    selectedText: string;
    filePath: string;
    lineRange: string;
}

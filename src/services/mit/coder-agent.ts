import type { CoderFeatureRequest, CoderFeatureResponse } from "../../mit-types.js";

type PriorityLevel = NonNullable<CoderFeatureRequest["priority"]>;

const PRIORITY_META: Record<PriorityLevel, { label: string; responseTarget: string; lane: string }> = {
  high: {
    label: "High",
    responseTarget: "Start implementation in the current sprint.",
    lane: "Expedite",
  },
  medium: {
    label: "Medium",
    responseTarget: "Plan implementation in the next sprint.",
    lane: "Standard",
  },
  low: {
    label: "Low",
    responseTarget: "Schedule when core priorities are complete.",
    lane: "Backlog",
  },
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "their",
  "about",
  "have",
  "will",
  "should",
  "could",
  "would",
  "there",
  "feature",
  "request",
]);

export class CoderAgent {
  private readonly repo: string | undefined;

  private readonly owner: string | undefined;

  constructor(config?: { repo?: string; owner?: string }) {
    this.repo = config?.repo;
    this.owner = config?.owner;
  }

  async createFeatureIssue(request: CoderFeatureRequest): Promise<CoderFeatureResponse> {
    const normalizedRequest = normalizeRequest(request);
    const title = this.generateIssueTitle(normalizedRequest.description);
    const body = this.generateIssueBody(normalizedRequest);
    const suggestion = this.suggestImplementation(normalizedRequest.description);

    const issueUrl = this.buildPrefillIssueUrl(title, body);
    return {
      issueCreated: false,
      title,
      body,
      suggestion,
      ...(issueUrl ? { issueUrl } : {}),
    };
  }

  generateIssueTitle(description: string): string {
    const clean = normalizeSentence(description);
    if (clean.length === 0) {
      return "Feature request: improve MIT trading assistant workflow";
    }

    const action = inferActionPrefix(clean);
    const keywords = extractKeywords(clean, 6)
      .map((word) => capitalize(word))
      .join(" ");
    const fallbackTitle = `${action} ${keywords || "MIT Trading Assistant capability"}`.trim();
    const compact = truncateWords(clean, 12);
    const title = compact.length <= 72
      ? `${action} ${compact}`
      : fallbackTitle;

    return trimTitle(title, 84);
  }

  generateIssueBody(request: CoderFeatureRequest): string {
    const priority = normalizePriority(request.priority);
    const meta = PRIORITY_META[priority];
    const acceptanceCriteria = this.generateAcceptanceCriteria(request.description);
    const implementation = this.suggestImplementation(request.description);
    const relatedFeatures = request.context?.relatedFeatures ?? [];

    const lines: string[] = [
      "## Description",
      normalizeSentence(request.description),
      "",
      "## User Story",
      request.context?.userStory
        ? normalizeSentence(request.context.userStory)
        : "As an MIT Trading Assistant user, I want this capability so that I can complete the workflow faster and with less manual effort.",
      "",
      "## Acceptance Criteria",
      ...acceptanceCriteria.map((item) => `- [ ] ${item}`),
      "",
      "## Suggested Implementation",
      implementation,
      "",
      "## Priority",
      `- Level: ${meta.label}`,
      `- Delivery lane: ${meta.lane}`,
      `- Response target: ${meta.responseTarget}`,
    ];

    if (relatedFeatures.length > 0) {
      lines.push("", "## Related Features", ...relatedFeatures.map((item) => `- ${normalizeSentence(item)}`));
    }

    return lines.join("\n");
  }

  generateAcceptanceCriteria(description: string): string[] {
    const normalized = normalizeSentence(description).toLowerCase();
    const criteria: string[] = [
      "Requested behavior is implemented end-to-end and matches the feature description.",
      "Validation and error handling are included for invalid or missing inputs.",
      "Automated tests cover happy path and at least one meaningful edge case.",
      "Documentation or API contract updates are added where integration behavior changes.",
    ];

    if (/\b(api|endpoint|route|request|response|payload)\b/.test(normalized)) {
      criteria.push("API request/response schema is explicit and backward compatibility is preserved or versioned.");
    }

    if (/\b(csv|export|table|chart|visuali[sz]ation|dashboard|ui|screen|page)\b/.test(normalized)) {
      criteria.push("Output format renders correctly for both normal and empty-data states.");
    }

    if (/\b(metric|calculate|analysis|score|rank|signal|indicator)\b/.test(normalized)) {
      criteria.push("Computed values are deterministic and verified against known sample inputs.");
    }

    if (/\b(auth|permission|security|access|role)\b/.test(normalized)) {
      criteria.push("Authorization boundaries are enforced and unauthorized access is rejected.");
    }

    return unique(criteria);
  }

  suggestImplementation(description: string): string {
    const normalized = normalizeSentence(description).toLowerCase();
    const steps: string[] = [
      "1. Define scope and update/introduce TypeScript interfaces for request, response, and internal payload contracts.",
      "2. Implement service logic in isolated methods so parsing, validation, and formatting can be tested independently.",
      "3. Add route-layer integration and map service errors to consistent API responses.",
      "4. Add focused unit tests plus one integration test to validate the full flow.",
    ];

    if (/\b(csv|export|table|chart|visuali[sz]ation|format)\b/.test(normalized)) {
      steps.splice(2, 0, "3. Add output template/formatter utilities to keep response structure stable across formats.");
    }

    if (/\b(cache|performance|latency|fast)\b/.test(normalized)) {
      steps.push("5. Add lightweight caching and basic performance assertions for frequent queries.");
    }

    if (/\b(auth|permission|security|access)\b/.test(normalized)) {
      steps.push("6. Add permission checks at entry points and verify security-sensitive paths in tests.");
    }

    return steps.join("\n");
  }

  private buildPrefillIssueUrl(title: string, body: string): string | undefined {
    if (!this.owner || !this.repo) {
      return undefined;
    }
    const encodedTitle = encodeURIComponent(title);
    const encodedBody = encodeURIComponent(body);
    return `https://github.com/${this.owner}/${this.repo}/issues/new?title=${encodedTitle}&body=${encodedBody}`;
  }
}

function normalizeRequest(request: CoderFeatureRequest): CoderFeatureRequest {
  const relatedFeatures = request.context?.relatedFeatures
    ?.map((item) => normalizeSentence(item))
    .filter((item) => item.length > 0);
  const userStory = request.context?.userStory
    ? normalizeSentence(request.context.userStory)
    : undefined;
  const context = request.context
    ? {
      ...(relatedFeatures && relatedFeatures.length > 0 ? { relatedFeatures } : {}),
      ...(userStory ? { userStory } : {}),
    }
    : undefined;

  return {
    description: normalizeSentence(request.description),
    priority: normalizePriority(request.priority),
    ...(context ? { context } : {}),
  };
}

function normalizePriority(priority: CoderFeatureRequest["priority"]): PriorityLevel {
  if (priority === "low" || priority === "high") {
    return priority;
  }
  return "medium";
}

function normalizeSentence(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function inferActionPrefix(description: string): string {
  if (/\b(fix|resolve|correct|repair)\b/i.test(description)) {
    return "Fix";
  }
  if (/\b(improve|optimi[sz]e|enhance|refactor|upgrade)\b/i.test(description)) {
    return "Improve";
  }
  if (/\b(add|create|build|implement|introduce|enable|support)\b/i.test(description)) {
    return "Add";
  }
  return "Implement";
}

function extractKeywords(description: string, limit: number): string[] {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

  return unique(words).slice(0, limit);
}

function truncateWords(input: string, maxWords: number): string {
  const words = input.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= maxWords) {
    return input;
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function trimTitle(input: string, maxLength: number): string {
  const squashed = input.replace(/\s+/g, " ").trim();
  if (squashed.length <= maxLength) {
    return capitalize(squashed);
  }
  return `${capitalize(squashed.slice(0, maxLength - 3).trim())}...`;
}

function capitalize(input: string): string {
  if (input.length === 0) {
    return input;
  }
  const first = input.charAt(0).toUpperCase();
  return `${first}${input.slice(1)}`;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

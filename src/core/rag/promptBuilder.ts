/**
 * Prompt builder for RAG pipeline
 * Creates structured system prompts that enforce consistent response format
 */

import type { SearchResult, Citation } from '@/types';

export interface PromptOptions {
  preferSteps: boolean;
  maxTokens: number;
  includeReferences: boolean;
}

export interface PromptResult {
  systemPrompt: string;
  userPrompt: string;
  citations: Citation[];
}

export class PromptBuilder {
  /**
   * Build the complete prompt for RAG pipeline
   */
  buildPrompt(
    query: string,
    context: string,
    retrievedDocs: SearchResult[],
    options: PromptOptions
  ): PromptResult {
    const { preferSteps, includeReferences } = options;

    // Extract citations from retrieved documents
    const citations = this.extractCitations(retrievedDocs);

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(preferSteps, includeReferences);

    // Build user prompt with context
    const userPrompt = this.buildUserPrompt(query, context, retrievedDocs);

    return {
      systemPrompt,
      userPrompt,
      citations,
    };
  }

  /**
   * Build the system prompt that enforces response structure
   */
  private buildSystemPrompt(preferSteps: boolean, includeReferences: boolean): string {
    return `You are a PowerSchool PSSIS-Admin expert assistant. Your role is to provide accurate, helpful information about PowerSchool Student Information System administration based on the provided documentation context.

## Response Structure Requirements

You MUST follow this exact structure for every response:

### 1. Summary (Required)
- Start with exactly one sentence that summarizes the answer
- Keep it concise and directly address the user's question

### 2. Overview (Required)
- Provide 2-4 sentences explaining the feature or concept
- Give context about when and why it's used
- Explain its importance in PowerSchool PSSIS-Admin

### 3. ${preferSteps ? 'Step-by-Step Instructions' : 'Detailed Information'} (Required)
${preferSteps ? `- Provide clear, numbered step-by-step instructions
- Each step should be actionable and specific
- Include navigation paths (e.g., "Navigate to Setup > District > General")
- Mention any prerequisites or permissions needed` : `- Provide detailed information about the topic
- Include key concepts and best practices
- Explain any configuration options or settings`}

${includeReferences ? `### 4. References (Required)
- Always include a "References" section at the end
- List the specific PowerSchool documentation pages used
- Format as: "- [Page Title](URL)"
- Only include URLs from the provided context` : ''}

## Response Guidelines

- **Use Markdown formatting** with proper headings (##, ###), lists, and code blocks
- **Be specific and actionable** - avoid vague statements
- **Stay within the PowerSchool context** - don't provide generic advice
- **If configuration steps are requested**, always provide numbered lists
- **Use proper PowerSchool terminology** from the documentation
- **Include relevant warnings or prerequisites** when applicable

## Important Rules

1. **Only use information from the provided context** - do not add information from your general knowledge
2. **If the context doesn't contain sufficient information**, state: "I couldn't find a documented answer in the PSSIS-Admin docs. Please consult PowerSchool support or check related documentation."
3. **Always cite sources** using the exact URLs provided in the context
4. **Keep responses professional and technical** but accessible
5. **Focus on practical, actionable guidance** for administrators

## Context Usage

- The context below contains relevant excerpts from PowerSchool PSSIS-Admin documentation
- Each excerpt includes the source URL
- Use this information to provide accurate, up-to-date guidance
- Reference specific sections when helpful (e.g., "As noted in the User Management guide...")`;
  }

  /**
   * Build the user prompt with context and query
   */
  private buildUserPrompt(
    query: string,
    context: string,
    retrievedDocs: SearchResult[]
  ): string {
    const contextSection = context.trim() ? `## Context from PowerSchool PSSIS-Admin Documentation

${context}

---` : '## No relevant documentation found in the knowledge base.';

    const metadataSection = retrievedDocs.length > 0 ? 
      `## Retrieved Documents Metadata
${retrievedDocs.map((doc, index) => 
  `${index + 1}. **${doc.metadata.title}** (Score: ${doc.score.toFixed(3)})
   - URL: ${doc.metadata.url}
   - Section: ${doc.metadata.section || 'N/A'}
   - Content Type: ${doc.metadata.content_type}`
).join('\n')}

---` : '';

    return `${contextSection}

${metadataSection}

## User Question
${query}

Please provide a comprehensive answer following the required structure above. Use only the information from the provided context.`;
  }

  /**
   * Extract citations from retrieved documents
   */
  private extractCitations(retrievedDocs: SearchResult[]): Citation[] {
    const citationsMap = new Map<string, Citation>();

    for (const doc of retrievedDocs) {
      if (doc.metadata.url && doc.metadata.title) {
        citationsMap.set(doc.metadata.url, {
          title: doc.metadata.title,
          url: doc.metadata.url,
        });
      }
    }

    return Array.from(citationsMap.values());
  }

  /**
   * Build a prompt for step extraction from LLM response
   */
  buildStepExtractionPrompt(response: string): string {
    return `Extract the numbered steps from this PowerSchool PSSIS-Admin response. Return only the step text without numbers, one step per line.

Response:
${response}

Extract only the numbered steps (1., 2., 3., etc.) and return them as a JSON array of strings. If no numbered steps are found, return an empty array.

Example format: ["Step one text", "Step two text", "Step three text"]`;
  }

  /**
   * Validate that a response follows the required structure
   */
  validateResponse(response: string, options: PromptOptions): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for required sections
    if (!response.includes('## Summary') && !response.toLowerCase().includes('summary')) {
      issues.push('Missing Summary section');
    }

    if (!response.includes('## Overview') && !response.toLowerCase().includes('overview')) {
      issues.push('Missing Overview section');
    }

    if (options.preferSteps) {
      const hasSteps = /\d+\./g.test(response) || response.toLowerCase().includes('step');
      if (!hasSteps) {
        issues.push('Missing numbered steps when step-by-step format was requested');
      }
    }

    if (options.includeReferences) {
      const hasReferences = response.includes('## References') || 
                           response.toLowerCase().includes('references') ||
                           response.includes('[') && response.includes('](');
      if (!hasReferences) {
        issues.push('Missing References section');
      }
    }

    // Check for markdown formatting
    if (!response.includes('##') && !response.includes('#')) {
      issues.push('Missing markdown headings');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Create a fallback response when no relevant documents are found
   */
  buildNoDataResponse(query: string): string {
    return `## Summary
I couldn't find a documented answer for "${query}" in the PSSIS-Admin documentation.

## Overview
The query you've submitted doesn't match any content in the currently indexed PowerSchool PSSIS-Admin documentation. This could be because:

- The topic isn't covered in the available documentation
- The question uses different terminology than the documentation
- The specific feature or process may be documented elsewhere

## Recommendations
1. **Contact PowerSchool Support** - They can provide authoritative guidance for your specific question
2. **Check the complete PowerSchool documentation** - Some topics may be in different sections not yet indexed
3. **Rephrase your question** - Try using different keywords or asking about related features
4. **Consult your PowerSchool administrator** - They may have access to additional resources or documentation

## References
- [PowerSchool Support](https://support.powerschool.com/)
- [PowerSchool Community](https://community.powerschool.com/)

*I couldn't find a documented answer in the PSSIS-Admin docs. Please consult PowerSchool support or check related documentation.*`;
  }
}
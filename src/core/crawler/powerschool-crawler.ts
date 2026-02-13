/**
 * PowerSchool PSSIS-Admin documentation crawler
 */

import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { RAGError } from '@/types';
import type { CrawledDocument, CrawlResult, CrawlError, CrawlStats, DocumentMetadata } from '@/types';
import config from '@/utils/config';

export interface CrawlerOptions {
  baseUrl?: string;
  maxPages?: number;
  delayMs?: number;
  timeout?: number;
  respectRobots?: boolean;
  maxDepth?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  userAgent?: string;
}

/**
 * PowerSchool PSSIS-Admin documentation crawler
 */
export class PowerSchoolCrawler {
  private readonly client: AxiosInstance;
  private readonly turndownService: TurndownService;
  private readonly purify: any;
  private readonly baseUrl: string;
  private readonly maxPages: number;
  private readonly delayMs: number;
  // private readonly maxDepth: number;
  private readonly includePatterns: RegExp[];
  private readonly excludePatterns: RegExp[];

  // Track crawled URLs to avoid duplicates
  private crawledUrls: Set<string> = new Set();
  private queuedUrls: Set<string> = new Set();

  constructor(options: CrawlerOptions = {}) {
    this.baseUrl = options.baseUrl || config.CRAWL_BASE_URL;
    this.maxPages = options.maxPages || config.MAX_PAGES;
    this.delayMs = options.delayMs || config.CRAWL_DELAY_MS;
    // this.maxDepth = options.maxDepth || 5;

    // Convert patterns to regex
    this.includePatterns = (options.includePatterns || ['.*']).map(pattern => new RegExp(pattern));
    this.excludePatterns = (options.excludePatterns || [
      // Exclude common non-content patterns
      '/search',
      '/api/',
      '\\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$',
      '/download/',
      '/print/',
      '#',
      '\\?',
    ]).map(pattern => new RegExp(pattern));

    // Initialize HTTP client
    this.client = axios.create({
      timeout: options.timeout || 30000,
      headers: {
        'User-Agent': options.userAgent || 'PowerSchool-RAG-Bot/1.0 (Educational Documentation Indexer)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
    });

    // Initialize HTML to Markdown converter
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });

    // Configure Turndown for better documentation parsing
    this.turndownService.addRule('preserveCodeBlocks', {
      filter: ['pre', 'code'],
      replacement: (content, node) => {
        if (node.nodeName === 'PRE') {
          const codeElement = node.querySelector('code');
          const language = codeElement?.className.match(/language-(\w+)/)?.[1] || '';
          return `\n\`\`\`${language}\n${content}\n\`\`\`\n`;
        }
        return `\`${content}\``;
      },
    });

    // Initialize DOM purifier
    const window = new JSDOM('').window;
    this.purify = DOMPurify(window as any);
  }

  /**
   * Crawl the PowerSchool documentation site
   */
  async crawlSite(startUrl?: string): Promise<CrawlResult> {
    const startTime = new Date();
    const documents: CrawledDocument[] = [];
    const errors: CrawlError[] = [];
    
    const initialUrl = startUrl || this.baseUrl;
    
    try {
      console.log(`Starting crawl from: ${initialUrl}`);
      console.log(`Max pages: ${this.maxPages}, Delay: ${this.delayMs}ms`);

      // Reset state
      this.crawledUrls.clear();
      this.queuedUrls.clear();

      // Add initial URL to queue
      this.queuedUrls.add(initialUrl);

      let crawledCount = 0;

      while (this.queuedUrls.size > 0 && crawledCount < this.maxPages) {
        const url = Array.from(this.queuedUrls)[0];
        if (!url) break;

        this.queuedUrls.delete(url);

        try {
          console.log(`Crawling [${crawledCount + 1}/${this.maxPages}]: ${url}`);
          
          const document = await this.crawlPage(url);
          if (document) {
            documents.push(document);
          }

          crawledCount++;
          
          // Respect rate limiting
          if (this.delayMs > 0) {
            await this.delay(this.delayMs);
          }

        } catch (error) {
          console.error(`Error crawling ${url}:`, error);
          
          const status_code = axios.isAxiosError(error) ? error.response?.status : undefined;
          errors.push({
            url,
            error: error instanceof Error ? error.message : 'Unknown error',
            ...(status_code !== undefined && { status_code }),
          });
        }
      }

      const endTime = new Date();
      const stats: CrawlStats = {
        total_pages: crawledCount,
        successful_pages: documents.length,
        failed_pages: errors.length,
        total_chunks: documents.reduce((sum, doc) => sum + (doc.metadata.total_chunks || 1), 0),
        start_time: startTime,
        end_time: endTime,
        duration_ms: endTime.getTime() - startTime.getTime(),
      };

      console.log(`Crawl completed: ${stats.successful_pages} pages, ${stats.total_chunks} chunks`);
      
      return {
        documents,
        errors,
        stats,
      };

    } catch (error) {
      throw new RAGError(
        `Crawl failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CRAWL_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Crawl a single page
   */
  private async crawlPage(url: string): Promise<CrawledDocument | null> {
    if (this.crawledUrls.has(url)) {
      return null;
    }

    if (!this.shouldCrawlUrl(url)) {
      return null;
    }

    this.crawledUrls.add(url);

    try {
      const response = await this.client.get(url);
      const html = response.data as string;

      // Parse HTML with Cheerio
      const $ = cheerio.load(html);

      // Extract page metadata
      const title = this.extractTitle($);
      const section = this.extractSection($, url);
      const subsection = this.extractSubsection($);

      // Extract and clean content
      const { content, rawHtml } = this.extractContent($);

      // Find additional URLs to crawl
      this.discoverUrls($, url);

      // Create document metadata
      const metadata: Partial<DocumentMetadata> = {
        url,
        title,
        content_type: this.determineContentType(content),
        chunk_index: 0,
        total_chunks: 1,
        created_at: new Date(),
        updated_at: new Date(),
        raw_html: rawHtml,
        ...(section && { section }),
        ...(subsection && { subsection }),
      };

      return {
        url,
        title,
        content: content.trim(),
        raw_html: rawHtml,
        metadata,
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new RAGError(
          `HTTP error ${error.response?.status}: ${error.message}`,
          'HTTP_ERROR',
          { url, status: error.response?.status }
        );
      }
      
      throw new RAGError(
        `Failed to crawl page: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PAGE_CRAWL_FAILED',
        { url, originalError: error }
      );
    }
  }

  /**
   * Extract page title
   */
  private extractTitle($: cheerio.CheerioAPI): string {
    // Try multiple selectors for title
    const titleSelectors = [
      'h1',
      '.page-title',
      '.content-header h1',
      '.main-content h1',
      'title',
    ];

    for (const selector of titleSelectors) {
      const title = $(selector).first().text().trim();
      if (title && title.length > 0) {
        return title;
      }
    }

    return 'Untitled Page';
  }

  /**
   * Extract section from URL or navigation
   */
  private extractSection($: cheerio.CheerioAPI, url: string): string | undefined {
    // Try to extract from breadcrumbs or navigation
    const breadcrumbSelectors = [
      '.breadcrumb li',
      '.nav-breadcrumb li',
      '.page-breadcrumb li',
    ];

    for (const selector of breadcrumbSelectors) {
      const breadcrumbs = $(selector).map((_, el) => $(el).text().trim()).get();
      if (breadcrumbs.length > 1) {
        return breadcrumbs[1]; // First breadcrumb after "Home"
      }
    }

    // Fall back to URL parsing
    const urlParts = new URL(url).pathname.split('/').filter(part => part.length > 0);
    return urlParts[urlParts.length - 2]; // Second-to-last part
  }

  /**
   * Extract subsection
   */
  private extractSubsection($: cheerio.CheerioAPI): string | undefined {
    // Look for secondary headings that might indicate subsection
    const h2Text = $('h2').first().text().trim();
    return h2Text || undefined;
  }

  /**
   * Extract and clean content from page
   */
  private extractContent($: cheerio.CheerioAPI): { content: string; rawHtml: string } {
    // Remove unwanted elements
    const elementsToRemove = [
      'script',
      'style',
      'nav',
      'header',
      'footer',
      '.sidebar',
      '.navigation',
      '.breadcrumb',
      '.footer',
      '.header',
      '.ad',
      '.advertisement',
      '.social-share',
    ];

    elementsToRemove.forEach(selector => {
      $(selector).remove();
    });

    // Try to find main content area
    const contentSelectors = [
      '.main-content',
      '.content',
      '.documentation-content',
      'main',
      'article',
      '.page-content',
      'body',
    ];

    let contentElement: cheerio.Cheerio<any> = $('body');
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        contentElement = element.first();
        break;
      }
    }

    // Get raw HTML for storage
    const rawHtml = this.purify.sanitize(contentElement.html() || '');

    // Convert to Markdown
    const content = this.turndownService.turndown(rawHtml);

    return {
      content: this.cleanContent(content),
      rawHtml,
    };
  }

  /**
   * Clean and normalize content
   */
  private cleanContent(content: string): string {
    return content
      .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
      .replace(/[ \t]+/g, ' ') // Normalize whitespace
      .replace(/^\s+|\s+$/gm, '') // Trim lines
      .trim();
  }

  /**
   * Determine content type based on content analysis
   */
  private determineContentType(content: string): 'text' | 'code' | 'heading' | 'list' | 'table' {
    const codeBlockCount = (content.match(/```/g) || []).length / 2;
    const listItemCount = (content.match(/^[\s]*[-*+]\s/gm) || []).length;
    const tableRowCount = (content.match(/^\|.*\|$/gm) || []).length;

    if (codeBlockCount > 2 || content.includes('```')) {
      return 'code';
    } else if (tableRowCount > 2) {
      return 'table';
    } else if (listItemCount > 3) {
      return 'list';
    } else if (content.match(/^#{1,6}\s/m)) {
      return 'heading';
    }

    return 'text';
  }

  /**
   * Discover additional URLs to crawl
   */
  private discoverUrls($: cheerio.CheerioAPI, currentUrl: string): void {
    const currentUrlObj = new URL(currentUrl);
    
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      try {
        // Resolve relative URLs
        const absoluteUrl = new URL(href, currentUrl).href;
        
        // Check if URL should be crawled
        if (this.shouldCrawlUrl(absoluteUrl) && 
            !this.crawledUrls.has(absoluteUrl) && 
            !this.queuedUrls.has(absoluteUrl) &&
            new URL(absoluteUrl).hostname === currentUrlObj.hostname) {
          
          this.queuedUrls.add(absoluteUrl);
        }
      } catch (error) {
        // Invalid URL, skip
      }
    });
  }

  /**
   * Check if URL should be crawled based on patterns
   */
  private shouldCrawlUrl(url: string): boolean {
    // Check exclude patterns first
    for (const pattern of this.excludePatterns) {
      if (pattern.test(url)) {
        return false;
      }
    }

    // Check include patterns
    for (const pattern of this.includePatterns) {
      if (pattern.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get crawl statistics
   */
  getStats(): {
    crawledUrls: number;
    queuedUrls: number;
  } {
    return {
      crawledUrls: this.crawledUrls.size,
      queuedUrls: this.queuedUrls.size,
    };
  }
}
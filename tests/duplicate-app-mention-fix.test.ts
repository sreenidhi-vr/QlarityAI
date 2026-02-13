/**
 * Test to verify the fix for duplicate responses with app_mentions
 * Tests the deduplication logic directly without full server setup
 */

describe('Duplicate App Mention Fix - Direct Logic Test', () => {
  let processingQueries: Map<string, Promise<any>>;
  let processedQueries: Map<string, number>;
  let responseCount = 0;
  
  const DEDUP_WINDOW_MS = 3000;

  // Copy the actual deduplication functions from the route file
  function shouldProcessQuery(userId: string, cleanQuery: string, eventType: string, eventId: string):
    { shouldProcess: boolean; reason?: string; existingPromise?: Promise<any> } {
    
    const now = Date.now();
    // Content-based key (no eventType to prevent app_mention/message duplicates) 
    const contentKey = `${userId}|${cleanQuery?.substring(0, 100)}`;
    
    // Check if identical query is currently being processed (regardless of event type)
    for (const [processingKey, promise] of processingQueries.entries()) {
      // Extract content part from processing key (remove eventId and timestamp)
      const processingContentKey = processingKey.split('|').slice(0, 2).join('|');
      if (processingContentKey === contentKey) {
        const existingEventId = processingKey.split('|')[3];
        console.log('[TEST-DEDUP] Query already processing - content match detected', {
          eventId,
          eventType,
          userId,
          query: cleanQuery?.substring(0, 50),
          existingEventId
        });
        return {
          shouldProcess: false,
          reason: 'already_processing_content_match',
          existingPromise: promise
        };
      }
    }
    
    // Check if same query was recently processed (content-based only)
    if (processedQueries.has(contentKey)) {
      const timestamp = processedQueries.get(contentKey)!;
      if (now - timestamp < DEDUP_WINDOW_MS) {
        console.log('[TEST-DEDUP] Query recently processed - content duplicate', {
          eventId,
          eventType,
          userId,
          query: cleanQuery?.substring(0, 50),
          timeSinceLastMs: now - timestamp
        });
        return { shouldProcess: false, reason: 'recently_processed_content' };
      }
    }
    
    return { shouldProcess: true };
  }

  function markQueryAsProcessing(userId: string, cleanQuery: string, eventType: string, eventId: string, promise: Promise<any>): string {
    const now = Date.now();
    const uniqueKey = `${userId}|${cleanQuery?.substring(0, 100)}|${eventType}|${eventId}|${now}`;
    processingQueries.set(uniqueKey, promise);
    return uniqueKey;
  }

  function markQueryAsCompleted(processingKey: string, userId: string, cleanQuery: string): void {
    const now = Date.now();
    const contentKey = `${userId}|${cleanQuery?.substring(0, 100)}`;
    
    // Remove from processing
    processingQueries.delete(processingKey);
    
    // Mark as recently processed (content-based to prevent app_mention/message duplicates)
    processedQueries.set(contentKey, now);
    
    console.log('[TEST-DEDUP] Query completed with content-based dedup', {
      processingKey: processingKey.split('|')[3],
      eventType: processingKey.split('|')[2],
      userId,
      query: cleanQuery?.substring(0, 50),
      contentKey
    });
  }

  // Mock query processing
  async function mockProcessQuery(userId: string, cleanQuery: string, eventType: string, eventId: string): Promise<void> {
    const checkResult = shouldProcessQuery(userId, cleanQuery, eventType, eventId);
    
    if (!checkResult.shouldProcess) {
      console.log(`[TEST-MOCK] Skipping duplicate query: ${checkResult.reason}`);
      return;
    }

    // Simulate processing
    const processingPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        responseCount++;
        console.log(`[TEST-MOCK] Response #${responseCount} sent for ${eventType} event ${eventId}`);
        resolve();
      }, 50);
    });

    const processingKey = markQueryAsProcessing(userId, cleanQuery, eventType, eventId, processingPromise);
    
    try {
      await processingPromise;
      markQueryAsCompleted(processingKey, userId, cleanQuery);
    } catch (error) {
      markQueryAsCompleted(processingKey, userId, cleanQuery);
      throw error;
    }
  }

  beforeEach(() => {
    processingQueries = new Map();
    processedQueries = new Map();
    responseCount = 0;
  });

  test('should only process one response for app_mention + message event with same content', async () => {
    const userId = 'U2147483697';
    const cleanQuery = 'What are the grading options in Schoology?';
    const timestamp = Date.now();

    console.log('[TEST] Testing app_mention + message deduplication...');

    // Simulate simultaneous app_mention and message events
    const promises = await Promise.allSettled([
      mockProcessQuery(userId, cleanQuery, 'app_mention', `Ev_${timestamp}_mention`),
      mockProcessQuery(userId, cleanQuery, 'message', `Ev_${timestamp}_message`)
    ]);

    // Both should complete without errors
    promises.forEach(result => {
      if (result.status === 'rejected') {
        console.error('Promise rejected:', result.reason);
      }
    });

    // Should only have sent ONE response despite two events
    expect(responseCount).toBe(1);
    console.log(`[TEST] Final response count: ${responseCount} (expected: 1)`);
  });

  test('should process different queries separately even if from same user', async () => {
    const userId = 'U2147483697';
    const query1 = 'What are grading options?';
    const query2 = 'How do I create assignments?';
    const timestamp = Date.now();

    console.log('[TEST] Testing different queries processing...');

    // Process different queries simultaneously
    await Promise.all([
      mockProcessQuery(userId, query1, 'app_mention', `Ev_${timestamp}_1`),
      mockProcessQuery(userId, query2, 'app_mention', `Ev_${timestamp}_2`)
    ]);

    // Should have sent TWO responses for different queries
    expect(responseCount).toBe(2);
    console.log(`[TEST] Final response count: ${responseCount} (expected: 2)`);
  });

  test('should not process duplicate after recent completion', async () => {
    const userId = 'U2147483697';
    const cleanQuery = 'Test duplicate prevention';
    const timestamp = Date.now();

    console.log('[TEST] Testing post-completion duplicate prevention...');

    // Process first query
    await mockProcessQuery(userId, cleanQuery, 'app_mention', `Ev_${timestamp}_first`);
    expect(responseCount).toBe(1);

    // Try to process identical query shortly after
    await mockProcessQuery(userId, cleanQuery, 'app_mention', `Ev_${timestamp}_second`);

    // Should still be only ONE response (duplicate rejected)
    expect(responseCount).toBe(1);
    console.log(`[TEST] Final response count: ${responseCount} (expected: 1)`);
  });

  test('should allow processing after deduplication window expires', async () => {
    const userId = 'U2147483697';
    const cleanQuery = 'Test window expiration';
    const timestamp = Date.now();

    console.log('[TEST] Testing deduplication window expiration...');

    // Process first query
    await mockProcessQuery(userId, cleanQuery, 'app_mention', `Ev_${timestamp}_first`);
    expect(responseCount).toBe(1);

    // Manually expire the deduplication window by setting old timestamp
    const contentKey = `${userId}|${cleanQuery.substring(0, 100)}`;
    processedQueries.set(contentKey, Date.now() - DEDUP_WINDOW_MS - 1000); // Expired

    // Try to process same query after window expiration
    await mockProcessQuery(userId, cleanQuery, 'app_mention', `Ev_${timestamp}_second`);

    // Should allow processing after window expiration
    expect(responseCount).toBe(2);
    console.log(`[TEST] Final response count: ${responseCount} (expected: 2)`);
  });

  test('should handle concurrent processing of same content correctly', async () => {
    const userId = 'U2147483697';
    const cleanQuery = 'Concurrent processing test';
    const timestamp = Date.now();

    console.log('[TEST] Testing concurrent processing handling...');

    // Start processing first query but don't await it yet
    const firstPromise = mockProcessQuery(userId, cleanQuery, 'app_mention', `Ev_${timestamp}_first`);
    
    // Immediately try to process identical query (should be blocked)
    const secondPromise = mockProcessQuery(userId, cleanQuery, 'message', `Ev_${timestamp}_second`);

    // Wait for both to complete
    await Promise.all([firstPromise, secondPromise]);

    // Should only have one response (second was blocked by first still processing)
    expect(responseCount).toBe(1);
    console.log(`[TEST] Final response count: ${responseCount} (expected: 1)`);
  });
});
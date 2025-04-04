import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import keyManager from '@/lib/services/keyManager';
import { logError, requestLogger } from '@/lib/services/logger';
import { v4 as uuidv4 } from 'uuid';

// Helper function to handle streaming response
async function handleStreamingResponse(axiosResponse: any, res: any) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of axiosResponse.data) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(req: NextRequest) {
  const masterApiKey = process.env.MASTER_API_KEY;

  // --- Master API Key Check ---
  if (masterApiKey) {
    const authHeader = req.headers.get('Authorization');
    const incomingKey = authHeader?.split(' ')[1]; // Extract key from "Bearer <key>"

    if (!incomingKey || incomingKey !== masterApiKey) {
      requestLogger.warn('Unauthorized access attempt with Master Key', { path: req.nextUrl.pathname });
      return NextResponse.json(
        { error: { message: 'Unauthorized', type: 'authentication_error' } },
        { status: 401 }
      );
    }
    // If Master Key is set and valid, proceed
  }
  // If Master Key is NOT set, we proceed without this specific check
  // (maintaining previous behavior where any request could pass this stage,
  // relying on keyManager for outgoing requests).
  // --- End Master API Key Check ---

  const maxRetries = 3;
  let retryCount = 0;
  const requestId = uuidv4();
  const startTime = Date.now();
  
  // Parse the request body
  const body = await req.json();
  const isStreaming = body?.stream === true;

  // Log incoming request
  requestLogger.info('Incoming Request', {
    requestId,
    path: '/api/v1/chat/completions',
    method: 'POST',
    body,
    model: body?.model,
    streaming: isStreaming
  });

  while (retryCount < maxRetries) {
    try {
      // Get the current key or rotate if needed
      const currentKey = await keyManager.getKey();
      
      const axiosConfig: any = {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`,
        }
      };

      // Add responseType: 'stream' for streaming requests
      if (isStreaming) {
        axiosConfig.responseType = 'stream';
      }

      const response = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        body,
        axiosConfig
      );

      // Mark the successful use of the key
      await keyManager.markKeySuccess();

      // Log successful response
      const responseTime = Date.now() - startTime;
      requestLogger.info('Outgoing Response', {
        requestId,
        statusCode: 200,
        responseTime,
        model: body?.model,
        streaming: isStreaming
      });

      // Handle streaming response differently
      if (isStreaming) {
        return handleStreamingResponse(response, null);
      }

      return NextResponse.json(response.data);
    } catch (error: any) {
      const isRateLimit = await keyManager.markKeyError(error);

      // Only retry on rate limits or server errors
      if ((isRateLimit || error.response?.status >= 500) && retryCount < maxRetries - 1) {
        retryCount++;
        continue;
      }

      // Determine if it's an API key related error
      const statusCode = error.response?.status;
      const isApiKeyError = statusCode === 401 || statusCode === 403 || statusCode === 429;

      logError(error, {
        context: 'Chat completions',
        requestId,
        retryCount,
        statusCode: statusCode,
        streaming: isStreaming,
        responseTime: Date.now() - startTime,
        model: body?.model,
        ...(isApiKeyError && { errorType: 'ApiKeyError' }) // Add errorType if it's an API key error
      });

      // For non-streaming requests, send error response
      return NextResponse.json(
        {
          error: {
            message: error.response?.data?.error?.message || error.message,
            type: error.response?.data?.error?.type || 'internal_error'
          }
        },
        { status: error.response?.status || 500 }
      );
    }
  }

  // This should never be reached, but TypeScript requires a return
  return NextResponse.json(
    {
      error: {
        message: 'Maximum retries exceeded',
        type: 'internal_error'
      }
    },
    { status: 500 }
  );
}
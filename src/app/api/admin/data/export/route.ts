import { NextResponse } from 'next/server';
import { ApiKey } from '@/lib/models/ApiKey';
import { RequestLogData } from '@/lib/models/RequestLog'; // Import RequestLogData type
import { Settings } from '@/lib/db'; // Import Settings type
import { logError } from '@/lib/services/logger';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from '@/lib/session';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db'; // Import getDb

export async function GET(req: Request) {
  // --- Authentication Check ---
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (process.env.REQUIRE_ADMIN_LOGIN !== 'false' && !session.isLoggedIn) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  // --- End Authentication Check ---

  try {
    const db = await getDb();

    // Fetch data from all relevant tables
    // Use raw SQL for simplicity and to ensure we get plain data
    const apiKeysData = await db.all<ApiKey[]>('SELECT * FROM api_keys');
    const settingsData = await db.get< { id: number; config: string } >('SELECT * FROM settings WHERE id = 1');
    const requestLogsData = await db.all<RequestLogData[]>('SELECT * FROM request_logs ORDER BY timestamp ASC'); // Order for potential consistency

    // Structure the export data
    const exportData = {
      version: 1, // Add a version number for future compatibility
      exportedAt: new Date().toISOString(),
      data: {
        api_keys: apiKeysData || [],
        // Parse settings JSON string before exporting
        settings: settingsData ? JSON.parse(settingsData.config) : {},
        request_logs: requestLogsData || [],
      }
    };

    // Create a JSON response with headers for file download
    const jsonString = JSON.stringify(exportData, null, 2); // Pretty print JSON
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Content-Disposition', `attachment; filename="gemini-lb-data-export-${new Date().toISOString().split('T')[0]}.json"`);

    return new NextResponse(jsonString, { status: 200, headers });

  } catch (error: any) {
    logError(error, { context: 'Export All Data' });
    return NextResponse.json(
      { message: 'Failed to export data', error: error.message },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic'; // Force dynamic rendering
import { NextRequest, NextResponse } from 'next/server';
import { ApiKey } from '@/lib/models/ApiKey';
import { RequestLogData } from '@/lib/models/RequestLog'; // Import RequestLogData
import { getDb } from '@/lib/db'; // Import getDb
import { logError } from '@/lib/services/logger';

// Function to get date range based on timeRange parameter
function getDateRange(timeRange: string): { startDate: Date, endDate: Date } {
  const endDate = new Date();
  let startDate = new Date();
  
  switch (timeRange) {
    case '24h':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(startDate.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(startDate.getDate() - 90);
      break;
    default:
      startDate.setDate(startDate.getDate() - 7); // Default to 7 days
  }
  
  // For time ranges other than 24h, adjust to full days
  if (timeRange !== '24h') {
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
  }
  // For 24h, use the exact start/end times calculated above
  
  return { startDate, endDate };
}

// Format date for display in charts
function formatDate(date: Date, timeRange: string): string {
  if (timeRange === '24h') {
    // Use 24-hour format HH:00 for chronological string sorting
    const hour = date.getHours().toString().padStart(2, '0');
    return `${hour}:00`;
  } else if (timeRange === '7d') {
    return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// Generate time periods for chart based on timeRange
function generateTimePeriods(startDate: Date, endDate: Date, timeRange: string): Date[] {
  const periods: Date[] = [];
  let current = new Date(startDate);
  
  while (current <= endDate) {
    periods.push(new Date(current));
    
    if (timeRange === '24h') {
      current.setHours(current.getHours() + 1);
    } else {
      current.setDate(current.getDate() + 1);
    }
  }
  
  return periods;
}

// Function to analyze log files and generate statistics
async function generateStats(timeRange: string) {
  // Dates for the main requestData chart based on selected timeRange
  const { startDate: requestStartDate, endDate: requestEndDate } = getDateRange(timeRange);
  const requestStartDateISO = requestStartDate.toISOString();
  const requestEndDateISO = requestEndDate.toISOString();

  // Always calculate dates for the rolling 24-hour hourly chart, explicitly using UTC
  const hourlyEndDateUTC = new Date(); // Current time is the end point
  const hourlyStartDateUTC = new Date(hourlyEndDateUTC.getTime() - 24 * 60 * 60 * 1000); // Exactly 24 hours prior
  const hourlyStartDateISO = hourlyStartDateUTC.toISOString();
  const hourlyEndDateISO = hourlyEndDateUTC.toISOString();

  try { // Re-add the try block
    const db = await getDb();
    // Get all keys from the database first (still needed for lifetime total and key usage pie chart)
    const keys = await ApiKey.findAll({});
    
    // Initialize statistics
    // Calculate totals directly from DB data
    let totalRequests = keys.reduce((sum, key) => sum + (key.requestCount || 0), 0);
    let totalRequestsToday = keys.reduce((sum, key) => sum + (key.dailyRequestsUsed || 0), 0);

    // Initialize stats derived from DB queries
    let totalRequests24h = 0;
    let totalErrors = 0;
    let apiKeyErrors = 0;
    let avgResponseTime = 0;
    
    // Generate time periods for charts
    const timePeriods = generateTimePeriods(requestStartDate, requestEndDate, timeRange); // Use request dates for requestData chart periods
    
    // Initialize request data with all time periods
    // --- Database Queries for Stats ---

    // 1. Total Requests (Last 24h)
    const requests24hResult = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM request_logs WHERE isError = 0 AND timestamp >= ? AND timestamp <= ?`,
      hourlyStartDateISO, hourlyEndDateISO
    );
    totalRequests24h = requests24hResult?.count || 0;

    // 2. Total Errors & API Key Errors (within selected timeRange)
    const errorsResult = await db.get<{ total: number, api: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN errorType = 'ApiKeyError' THEN 1 ELSE 0 END) as api
       FROM request_logs
       WHERE isError = 1 AND timestamp >= ? AND timestamp <= ?`,
      requestStartDateISO, requestEndDateISO
    );
    totalErrors = errorsResult?.total || 0;
    apiKeyErrors = errorsResult?.api || 0;

    // 3. Average Response Time (within selected timeRange)
    const avgTimeResult = await db.get<{ avg: number }>(
      `SELECT AVG(responseTime) as avg
       FROM request_logs
       WHERE isError = 0 AND responseTime IS NOT NULL AND timestamp >= ? AND timestamp <= ?`,
      requestStartDateISO, requestEndDateISO
    );
    avgResponseTime = avgTimeResult?.avg ? Math.round(avgTimeResult.avg) : 0;

    // 4. Request Data (Grouped by period for chart)
    let groupByFormat = '';
    if (timeRange === '24h') {
      groupByFormat = `strftime('%Y-%m-%d %H:00:00', timestamp)`; // Group by hour for 24h
    } else {
      groupByFormat = `strftime('%Y-%m-%d', timestamp)`; // Group by day otherwise
    }
    const requestDataDbResult = await db.all<any[]>(
      `SELECT
         ${groupByFormat} as period,
         COUNT(*) as total_requests,
         SUM(CASE WHEN isError = 1 THEN 1 ELSE 0 END) as errors,
         SUM(CASE WHEN isError = 1 AND errorType = 'ApiKeyError' THEN 1 ELSE 0 END) as apiKeyErrors
       FROM request_logs
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY period
       ORDER BY period ASC`,
      requestStartDateISO, requestEndDateISO
    );

    // Map DB results to the expected chart format, filling gaps
    const requestDataMap = new Map<string, { name: string, requests: number, errors: number, apiKeyErrors: number, date: Date }>();
    timePeriods.forEach(date => {
      const name = formatDate(date, timeRange);
      requestDataMap.set(name, { name, requests: 0, errors: 0, apiKeyErrors: 0, date });
    });

    requestDataDbResult.forEach(row => {
      let nameToUpdate: string | null = null;
      const periodDateUTC = new Date(row.period.replace(' ', 'T') + (timeRange === '24h' ? ':00Z' : 'T00:00:00Z')); // Parse UTC date from DB

      if (timeRange === '24h') {
        // For 24h, the map keys are local "HH:00". Find the key matching the local hour of the UTC timestamp.
        const localHourStr = periodDateUTC.getHours().toString().padStart(2, '0') + ':00';
        if (requestDataMap.has(localHourStr)) {
          nameToUpdate = localHourStr;
        } else {
           // Fallback or logging if needed - maybe the hour doesn't exist due to DST?
           console.warn(`Local hour key ${localHourStr} derived from UTC period ${row.period} not found in requestDataMap.`);
        }
      } else {
        // For other time ranges, use the existing formatDate logic (assuming it works)
        const name = formatDate(periodDateUTC, timeRange); // Note: formatDate might need adjustment for non-24h UTC dates too, but focusing on 24h per user feedback
        if (requestDataMap.has(name)) {
           nameToUpdate = name;
        }
      }

      if (nameToUpdate) {
        const entry = requestDataMap.get(nameToUpdate)!;
        entry.requests = row.total_requests - row.errors; // Store successful requests
        entry.errors = row.errors;
        entry.apiKeyErrors = row.apiKeyErrors;
      }
    });
    const requestData = Array.from(requestDataMap.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map(({ name, requests, errors, apiKeyErrors }) => ({ name, requests, errors, apiKeyErrors }));


    // 5. Hourly Data (Last 24h UTC)
    const hourlyDbResult = await db.all<{ hour: string, requests: number }[]>(
      `SELECT
         strftime('%Y-%m-%dT%H:00:00.000Z', timestamp) as hour,
         COUNT(*) as requests
       FROM request_logs
       WHERE isError = 0 AND timestamp >= ? AND timestamp <= ?
       GROUP BY hour
       ORDER BY hour ASC`,
      hourlyStartDateISO, hourlyEndDateISO
    );

    // Map DB results to the expected chart format, filling gaps
    const hourlyMap = new Map<string, { hour: string, requests: number, timestamp: Date }>();
    let currentUTCHourMarker = new Date(hourlyStartDateUTC);
    currentUTCHourMarker.setUTCMinutes(0, 0, 0);
    for (let i = 0; i < 24; i++) {
      if (currentUTCHourMarker > hourlyEndDateUTC) break;
      const hourUTCSlotStart = new Date(currentUTCHourMarker);
      const hourKey = hourUTCSlotStart.toISOString();
      hourlyMap.set(hourKey, { hour: hourKey, requests: 0, timestamp: hourUTCSlotStart });
      currentUTCHourMarker.setUTCHours(currentUTCHourMarker.getUTCHours() + 1);
    }
    hourlyDbResult.forEach(row => {
      if (hourlyMap.has(row.hour)) {
        hourlyMap.get(row.hour)!.requests = row.requests;
      }
    });
    const finalHourlyData = Array.from(hourlyMap.values())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(({ hour, requests }) => ({ hour, requests }));


    // 6. Model Usage (within selected timeRange)
    const modelUsageDbResult = await db.all<{ modelUsed: string, count: number }[]>(
      `SELECT modelUsed, COUNT(*) as count
       FROM request_logs
       WHERE modelUsed IS NOT NULL AND timestamp >= ? AND timestamp <= ?
       GROUP BY modelUsed
       ORDER BY count DESC`,
      requestStartDateISO, requestEndDateISO
    );
    const modelUsageData = modelUsageDbResult.map(row => ({ name: row.modelUsed, value: row.count }));

    // --- End Database Queries ---

    // Note: totalRequests and totalRequestsToday are now calculated from DB data above

    // Note: requestData and finalHourlyData are now populated directly from DB queries above

    // Prepare key usage data for chart directly from DB key request counts
    const keyUsageData = keys
        .filter(key => (key.requestCount || 0) > 0) // Only include keys with usage
        .map(key => {
            const maskedKey = `Key ${key._id.substring(0, 4)}...`;
            return {
                name: key.name || maskedKey,
                value: key.requestCount || 0 // Use total request count from DB
            };
        })
        .sort((a, b) => b.value - a.value); // Sort by usage descending
    
    // Fallback logic removed - primary loop should now work correctly
    // if (keyUsageData.length === 0) {
    //   keyUsageData = keys.map(key => ({
    //     name: `Key ${key._id.substring(0, 4)}...`,
    //     value: key.requestCount || 0
    //   })).filter(item => item.value > 0);
    // }
    
    // Note: modelUsageData is now populated directly from DB query above
    
    // Calculate success rate based on DB query results for the timeRange
    // Use total requests within the timeRange for calculation. Let's query that.
    const totalRequestsTimeRangeResult = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM request_logs WHERE timestamp >= ? AND timestamp <= ?`,
        requestStartDateISO, requestEndDateISO
    );
    const totalRequestsTimeRange = totalRequestsTimeRangeResult?.count || 0;
    const successRate = totalRequestsTimeRange > 0
      ? ((totalRequestsTimeRange - totalErrors) / totalRequestsTimeRange) * 100
      : 100;
    // Note: avgResponseTime is already calculated from DB query above
    
    // Note: finalHourlyData is now populated directly from DB query above

    return {
      totalRequests, // Lifetime total from ApiKey table
      totalRequestsToday, // Since midnight from ApiKey table
      totalRequests24h, // Last 24h total from request_logs table
      totalErrors, // Total errors in timeRange from request_logs
      apiKeyErrors, // API Key errors in timeRange from request_logs
      successRate, // Calculated from request_logs data for timeRange
      avgResponseTime, // Calculated from request_logs data for timeRange
      requestData, // Calculated from request_logs data for timeRange
      hourlyData: finalHourlyData, // Calculated from request_logs data for last 24h UTC
      keyUsageData, // From ApiKey table
      modelUsageData // Calculated from request_logs data for timeRange
    };
  // } catch (error: any) { // Remove the duplicate catch block start
  //   console.error('Error generating stats:', error);
  //   // DB errors are caught below
  } catch (error: any) {
    logError(error, { context: 'generateStats DB Query' });
    console.error('Error generating stats from DB:', error);
    // Return empty stats on DB error
    return createEmptyStats(requestStartDate, requestEndDate, timeRange);
  }
}

// Create empty stats object with proper time periods
function createEmptyStats(startDate: Date, endDate: Date, timeRange: string) {
  // Generate empty requestData structure based on time periods
  const timePeriods = generateTimePeriods(startDate, endDate, timeRange);
  const requestData = timePeriods.map(date => ({
    name: formatDate(date, timeRange),
    requests: 0,
    errors: 0,
    apiKeyErrors: 0
  }));

  // Always generate empty hourly data for the rolling 24h window
  const emptyHourlyData: { hour: string, requests: number }[] = [];
  const hourlyEndDate = new Date(); // Use current time as end
  const hourlyStartDate = new Date();
  hourlyStartDate.setHours(hourlyStartDate.getHours() - 24);
  let currentHour = new Date(hourlyStartDate);
  currentHour.setMinutes(0, 0, 0);
  for (let i = 0; i < 24; i++) {
    const hourTimestamp = new Date(currentHour);
    const hourKey = hourTimestamp.toISOString();
    emptyHourlyData.push({ hour: hourKey, requests: 0 });
    currentHour.setHours(currentHour.getHours() + 1);
  }
  
  return {
    totalRequests: 0,       // Lifetime (would ideally come from ApiKey query even on error, but default 0)
    totalRequestsToday: 0,  // Since midnight (same as above)
    totalRequests24h: 0,    // Last 24h
    totalErrors: 0,
    apiKeyErrors: 0,
    successRate: 100,
    avgResponseTime: 0,
    requestData,            // Empty structure based on time range
    hourlyData: emptyHourlyData, // Empty structure for 24h
    keyUsageData: [],       // Empty array
    modelUsageData: []      // Empty array
  };
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const timeRange = searchParams.get('timeRange') || '7d';
    
    const stats = await generateStats(timeRange);
    
    return NextResponse.json(stats);
  } catch (error: any) {
    logError(error, { context: 'Stats API' });
    
    return NextResponse.json(
      {
        error: {
          message: error.message || 'Failed to generate statistics',
          type: 'internal_error'
        }
      },
      { status: 500 }
    );
  }
}
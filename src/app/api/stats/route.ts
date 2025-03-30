export const dynamic = 'force-dynamic'; // Force dynamic rendering
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { ApiKey } from '@/lib/models/ApiKey';
import { logError } from '@/lib/services/logger';

// Function to parse date from log filename
function parseDateFromFilename(filename: string): Date | null {
  const match = filename.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return null;
  return new Date(match[0]);
}

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
  const logsDir = path.join(process.cwd(), 'logs');
  // Dates for the main requestData chart based on selected timeRange
  const { startDate: requestStartDate, endDate: requestEndDate } = getDateRange(timeRange);
  
  // Always calculate dates for the rolling 24-hour hourly chart, explicitly using UTC
  const hourlyEndDateUTC = new Date(); // Current time is the end point
  const hourlyStartDateUTC = new Date(hourlyEndDateUTC.getTime() - 24 * 60 * 60 * 1000); // Exactly 24 hours prior
  
  try {
    // Check if logs directory exists
    try {
      await fs.access(logsDir);
    } catch (error) {
      // If logs directory doesn't exist, return empty stats
      return createEmptyStats(requestStartDate, requestEndDate, timeRange);
    }
    
    // Get all log files
    const allFiles = await fs.readdir(logsDir);

    // --- Determine required dates ---
    const requiredDates = new Set<string>(); // Store dates as YYYY-MM-DD strings

    // Add dates for the requestData range
    let currentRequestDate = new Date(requestStartDate);
    currentRequestDate.setHours(0, 0, 0, 0); // Start from the beginning of the day
    while (currentRequestDate <= requestEndDate) {
      requiredDates.add(currentRequestDate.toISOString().split('T')[0]);
      currentRequestDate.setDate(currentRequestDate.getDate() + 1);
    }

    // Add dates for the hourlyData range (today and potentially yesterday) based on UTC window
    requiredDates.add(hourlyStartDateUTC.toISOString().split('T')[0]);
    requiredDates.add(hourlyEndDateUTC.toISOString().split('T')[0]);
    // --- End Determine required dates ---

    // --- Filter log files based on required dates ---
    const requiredDateStrings = Array.from(requiredDates);

    const requestLogFiles = allFiles.filter(file =>
      file.startsWith('requests-') && requiredDateStrings.some(dateStr => file.includes(dateStr))
    );
    const errorLogFiles = allFiles.filter(file =>
      file.startsWith('errors-') && requiredDateStrings.some(dateStr => file.includes(dateStr))
    );
    const keyLogFiles = allFiles.filter(file =>
      file.startsWith('keys-') && requiredDateStrings.some(dateStr => file.includes(dateStr))
    );
    // --- End Filter log files ---
    
    // Initialize statistics
    let totalRequests = 0;
    let totalErrors = 0; // Overall errors
    let apiKeyErrors = 0; // Specific API key errors
    let responseTimesSum = 0;
    let responseTimesCount = 0;
    let totalRequestsToday = 0; // Initialize today's request counter
    
    // Generate time periods for charts
    const timePeriods = generateTimePeriods(requestStartDate, requestEndDate, timeRange); // Use request dates for requestData chart periods
    
    // Initialize request data with all time periods
    // Initialize request data map with all time periods, including apiKeyErrors
    const requestDataMap = new Map<string, { name: string, requests: number, errors: number, apiKeyErrors: number, date: Date }>();
    timePeriods.forEach(date => {
      const name = formatDate(date, timeRange);
      requestDataMap.set(name, { name, requests: 0, errors: 0, apiKeyErrors: 0, date });
    });
    
    // Always initialize hourly map for the rolling 24-hour window using UTC hours
    const hourlyMap = new Map<string, { hour: string, requests: number, timestamp: Date }>();
    let currentUTCHourMarker = new Date(hourlyStartDateUTC);
    // Align the marker to the start of the UTC hour it falls within
    currentUTCHourMarker.setUTCMinutes(0, 0, 0);

    // Generate 24 slots, representing the start of each UTC hour in the window
    for (let i = 0; i < 24; i++) {
      // Ensure we don't go past the end date if the window isn't exactly 24 hours due to DST changes etc.
      if (currentUTCHourMarker > hourlyEndDateUTC) break;

      const hourUTCSlotStart = new Date(currentUTCHourMarker);
      // Use the UTC ISO string of the UTC hour start time as the unique key
      const hourKey = hourUTCSlotStart.toISOString();
      // Store the key and the Date object representing the start of the UTC slot
      hourlyMap.set(hourKey, { hour: hourKey, requests: 0, timestamp: hourUTCSlotStart });
      // Move marker to the start of the next UTC hour
      currentUTCHourMarker.setUTCHours(currentUTCHourMarker.getUTCHours() + 1);
    }
    
    // Model usage tracking
    const modelUsage: Record<string, number> = {};
    
    // Key usage tracking with timestamps
    const keyUsage: Record<string, { count: number, lastUsed: Date | null }> = {};
    
    // Process request logs
    for (const file of requestLogFiles) {
      const filePath = path.join(logsDir, file);
      let content = '';
      
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (error) {
        console.error(`Error reading log file ${file}:`, error);
        continue;
      }
      
      // Parse log entries
      const lines = content.split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          const timestamp = new Date(log.timestamp);

          // Process for requestData chart if within its range
          if (timestamp >= requestStartDate && timestamp <= requestEndDate) {
            // Track model usage
            let model = 'unknown';
            if (log.body?.model) model = log.body.model;
            else if (log.model) model = log.model;
            else if (log.data?.model) model = log.data.model;
            modelUsage[model] = (modelUsage[model] || 0) + 1;

            // Track response times
            if (log.message === 'Outgoing Response' && log.responseTime) {
              responseTimesSum += log.responseTime;
              responseTimesCount++;
            }
            // Note: Request counts and key usage (for pie chart) are handled via key logs.
          }

          // Process for hourlyData chart if within its UTC range
          // Note: This check is primarily for completeness; actual incrementing happens in key logs processing
          if (timestamp >= hourlyStartDateUTC && timestamp <= hourlyEndDateUTC) {
             const logTimestampDate = new Date(timestamp); // Parse log timestamp
             // Find the start of the UTC hour slot this log belongs to
             const logUTCHourStartDate = new Date(logTimestampDate);
             logUTCHourStartDate.setUTCMinutes(0, 0, 0); // Truncate to start of the UTC hour
             // Generate the key using the UTC ISO string of that UTC start time
             const logUTCHourKey = logUTCHourStartDate.toISOString();
             // Check if the key exists (no incrementing here)
             // if (hourlyMap.has(logUTCHourKey)) { }
           }

        } catch (e) {
          // Skip invalid log entries
          continue;
        }
      }
    }
    
    // Process error logs
    for (const file of errorLogFiles) {
      const filePath = path.join(logsDir, file);
      let content = '';
      
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (error) {
        console.error(`Error reading log file ${file}:`, error);
        continue;
      }
      
      // Parse log entries
      const lines = content.split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          const timestamp = new Date(log.timestamp);

          // Process for requestData chart if within its range
          if (timestamp >= requestStartDate && timestamp <= requestEndDate) {
            totalErrors++; // Increment total errors for the period

            // Check if it's an API Key Error
            const isApiKeyError = log.errorType === 'ApiKeyError' || log.message?.includes('API Key');
            if (isApiKeyError) {
              apiKeyErrors++;
            }

            // Group by formatted date for the error data chart
            const formattedDate = formatDate(timestamp, timeRange);
            const entry = requestDataMap.get(formattedDate);
            if (entry) {
              entry.errors++; // Increment total errors for the period
              if (isApiKeyError) {
                entry.apiKeyErrors++; // Increment specific API key errors for the period
              }
            }
          }
          // Note: Errors are not currently shown on the hourly chart.
        } catch (e) {
          // Count as error but skip invalid log entries for chart
          totalErrors++;
          continue;
        }
      }
    }
    
    // Process key logs for more accurate key usage data
    const todayStart = new Date(); // Get start of today
    todayStart.setHours(0, 0, 0, 0);
    for (const file of keyLogFiles) {
      const filePath = path.join(logsDir, file);
      let content = '';
      
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (error) {
        console.error(`Error reading log file ${file}:`, error);
        continue;
      }
      
      // Parse log entries
      const lines = content.split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          const timestamp = new Date(log.timestamp);

          // Check if it's a 'Key Success' message to count as a request
          const isSuccess = log.message === 'Key Success';

          // Process for requestData chart if within its range
          if (timestamp >= requestStartDate && timestamp <= requestEndDate) {
            if (isSuccess) {
              totalRequests++; // Increment total requests for the selected period

              // Increment requests for the specific period in requestDataMap
              const formattedDate = formatDate(timestamp, timeRange);
              const entry = requestDataMap.get(formattedDate);
              if (entry) {
                entry.requests++;
              }
            }

            // Track API key usage from key logs (for pie chart)
            const keyIdentifier = log.keyId; // Declare keyIdentifier here
            // Use 'Key Success' message to count usage for the pie chart
            // Use 'Key Success' message to count usage for the pie chart
            if (keyIdentifier && log.message === 'Key Success') {
               if (!keyUsage[keyIdentifier]) {
                   keyUsage[keyIdentifier] = { count: 0, lastUsed: null };
               }
               // Use the count from key logs for the pie chart
               keyUsage[keyIdentifier].count++;
               keyUsage[keyIdentifier].lastUsed = timestamp > (keyUsage[keyIdentifier].lastUsed || 0) ? timestamp : keyUsage[keyIdentifier].lastUsed;
            }
          }

          // Process for hourlyData chart if within its UTC range
          const logTimestampDate = new Date(timestamp); // Parse log timestamp only once
          if (isSuccess && logTimestampDate >= hourlyStartDateUTC && logTimestampDate <= hourlyEndDateUTC) {
              // Find the start of the UTC hour slot this log belongs to
              const logUTCHourStartDate = new Date(logTimestampDate);
              logUTCHourStartDate.setUTCMinutes(0, 0, 0); // Truncate to start of the UTC hour

              // Generate the key using the UTC ISO string of that UTC start time
              const logUTCHourKey = logUTCHourStartDate.toISOString();

              // Find the corresponding bucket in the map and increment
              if (hourlyMap.has(logUTCHourKey)) {
                hourlyMap.get(logUTCHourKey)!.requests++;
              } else {
                // This case might happen if a log timestamp is exactly on the boundary
                // or if there are slight precision differences. Could be ignored or logged.
                // console.warn(`Hourly map key not found for timestamp: ${timestamp}, generated UTC key: ${logUTCHourKey}`);
              }
            }

          // Count requests for today specifically
          if (isSuccess && timestamp >= todayStart) {
            totalRequestsToday++;
          }
        } catch (e) {
          // Skip invalid log entries
          continue;
        }
      }
    }

    // Convert request data map to array and sort by date
    // Convert request data map to array, including apiKeyErrors
    const requestData = Array.from(requestDataMap.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map(({ name, requests, errors, apiKeyErrors }) => ({ name, requests, errors, apiKeyErrors }));

    // Get API keys for key usage statistics
    const keys = await ApiKey.findAll({});
    
    // Prepare key usage data for chart
    let keyUsageData = [];
    for (const key of keys) {
      // Use key._id for matching with keyUsage keys (assuming keyId logged is _id)
      const usage = keyUsage[key._id] || { count: 0, lastUsed: null };
      const maskedKey = `Key ${key._id.substring(0, 4)}...`;
      
      // Only include keys that have been used in the selected time range
      if (usage.count > 0) {
        keyUsageData.push({
          name: key.name || maskedKey, // Use key.name if available, otherwise fallback to masked ID
          value: usage.count
        });
      }
    }
    
    // Fallback logic removed - primary loop should now work correctly
    // if (keyUsageData.length === 0) {
    //   keyUsageData = keys.map(key => ({
    //     name: `Key ${key._id.substring(0, 4)}...`,
    //     value: key.requestCount || 0
    //   })).filter(item => item.value > 0);
    // }
    
    // Convert model usage to chart data format and sort by usage
    const modelUsageData = Object.entries(modelUsage)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    
    // Calculate success rate and average response time
    const successRate = totalRequests > 0 ? ((totalRequests - totalErrors) / totalRequests) * 100 : 100;
    const avgResponseTime = responseTimesCount > 0 ? Math.round(responseTimesSum / responseTimesCount) : 0;
    
    // Always finalize hourlyData from the hourlyMap (rolling 24h)
    const finalHourlyData = Array.from(hourlyMap.values())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      // Map to the structure expected by the frontend chart { hour: string, requests: number }
      // The 'hour' field contains the ISO timestamp string
      .map(({ hour, requests }) => ({ hour, requests }));

    return {
      totalRequests,
      totalRequestsToday, // Add today's count
      totalErrors,
      apiKeyErrors,
      successRate,
      avgResponseTime,
      requestData,
      hourlyData: finalHourlyData,
      keyUsageData,
      modelUsageData
    };
  } catch (error: any) {
    console.error('Error generating stats:', error);
    // If logs directory doesn't exist yet, return empty stats
    return createEmptyStats(requestStartDate, requestEndDate, timeRange);
  }
}

// Create empty stats object with proper time periods
function createEmptyStats(startDate: Date, endDate: Date, timeRange: string) {
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
    totalRequests: 0,
    totalErrors: 0,
    apiKeyErrors: 0,
    successRate: 100,
    avgResponseTime: 0,
    requestData,
    hourlyData: emptyHourlyData, // Use the generated empty data
    keyUsageData: [],
    modelUsageData: [],
    totalRequestsToday: 0 // Add to empty stats
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
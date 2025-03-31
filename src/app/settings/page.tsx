'use client';

import { useState, useEffect, useCallback } from 'react'; // Add useCallback
import {
  Box,
  // Grid, // Removed unused import
  // GridItem, // Removed unused import
  Heading,
  Text,
  FormControl,
  FormLabel,
  Input,
  Select,
  Switch,
  Button,
  useToast,
  Card,
  CardHeader,
  CardBody,
  Divider,
  Flex,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  useColorModeValue,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  IconButton,
  Tooltip,
  Spinner,
  SimpleGrid, // Import SimpleGrid
} from '@chakra-ui/react';
import { FiSave, FiRefreshCw } from 'react-icons/fi';
import AppLayout from '@/components/layout/AppLayout'; // Import AppLayout
import { useContext } from 'react';
import { ThemeContext } from '@/contexts/ThemeContext';

interface Settings {
  keyRotationRequestCount: number;
  maxFailureCount: number;
  rateLimitCooldown: number;
  logRetentionDays: number;
  keyRotationDelaySeconds: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    keyRotationRequestCount: 5,
    maxFailureCount: 5,
    rateLimitCooldown: 60,
    logRetentionDays: 14,
    keyRotationDelaySeconds: 5, // Default value, will be updated on fetch
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false); // State for cleanup button
  const [cleanupResult, setCleanupResult] = useState<string | null>(null); // State for cleanup result message
  
  const toast = useToast();
  const { colorMode, toggleColorMode } = useContext(ThemeContext);
  
  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  const fetchSettings = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error(`Error fetching settings: ${response.statusText}`);
      }
      
      const data = await response.json();
      setSettings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch settings');
      console.error('Error fetching settings:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to fetch settings',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setError(null);
    setIsSaved(false);
    
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }
      
      const data = await response.json();
      setSettings(data.settings);
      setIsSaved(true);
      
      toast({
        title: 'Settings saved',
        description: 'Your settings have been updated successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
      toast({
        title: 'Error',
        description: err.message || 'Failed to save settings',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Function to trigger log cleanup
  const handleCleanupLogs = useCallback(async () => {
    setIsCleaning(true);
    setCleanupResult(null);
    setError(null); // Clear previous general errors

    try {
      const response = await fetch('/api/admin/cleanup-logs', {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Log cleanup failed');
      }

      setCleanupResult(data.message || 'Log cleanup completed successfully.');
      toast({
        title: 'Log Cleanup Successful',
        description: data.message || 'Old log files have been deleted.',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

    } catch (err: any) {
      setCleanupResult(`Error: ${err.message}`);
      setError(`Cleanup Error: ${err.message}`); // Show error specifically
      toast({
        title: 'Log Cleanup Failed',
        description: err.message || 'Could not delete old log files.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsCleaning(false);
    }
  }, [toast]);

  if (isLoading) {
    return (
      <AppLayout> {/* Use AppLayout for loading state */}
        {/* Removed Grid and Sidebar */}
        <Box p={6}> {/* Wrap content */}
          <Flex justify="center" align="center" h="80vh">
            <Spinner size="xl" color="blue.500" />
          </Flex>
        </Box>
      </AppLayout>
    );
  }

  return (
    <AppLayout> {/* Use AppLayout for main content */}
      {/* Removed Grid and Sidebar */}
      {/* Main content starts here */}
        <Flex justify="space-between" align="center" mb={6}>
          <Box>
            <Heading size="lg">Settings</Heading>
            <Text color="gray.500">Configure your Gemini Load Balancer</Text>
          </Box>
          <Tooltip label="Refresh Settings">
            <IconButton
              aria-label="Refresh settings"
              icon={<FiRefreshCw />}
              onClick={fetchSettings}
              isLoading={isLoading}
            />
          </Tooltip>
        </Flex>

        {error && (
          <Alert status="error" mb={6} borderRadius="md">
            <AlertIcon />
            <AlertTitle>Error!</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isSaved && (
          <Alert status="success" mb={6} borderRadius="md">
            <AlertIcon />
            <AlertTitle>Success!</AlertTitle>
            <AlertDescription>Settings saved successfully</AlertDescription>
          </Alert>
        )}

        <SimpleGrid columns={{ base: 1, md: 2 }} gap={6}> {/* Replace Grid with SimpleGrid */}
          <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="lg" shadow="sm">
            <CardHeader>
              <Heading size="md">API Key Settings</Heading>
            </CardHeader>
            <Divider borderColor={borderColor} />
            <CardBody>
              <FormControl mb={4}>
                <FormLabel>Key Rotation Request Count</FormLabel>
                <NumberInput
                  value={settings.keyRotationRequestCount}
                  onChange={(_, value) => setSettings({ ...settings, keyRotationRequestCount: value })}
                  min={1}
                  max={100}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
                <Text fontSize="sm" color="gray.500" mt={1}>
                  Number of requests before rotating to the next API key
                </Text>
              </FormControl>

              <FormControl mb={4}>
                <FormLabel>Maximum Failure Count</FormLabel>
                <NumberInput
                  value={settings.maxFailureCount}
                  onChange={(_, value) => setSettings({ ...settings, maxFailureCount: value })}
                  min={1}
                  max={100}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
                <Text fontSize="sm" color="gray.500" mt={1}>
                  Number of failures before deactivating an API key
                </Text>
              </FormControl>

              <FormControl mb={4}>
                <FormLabel>Rate Limit Cooldown (seconds)</FormLabel>
                <NumberInput
                  value={settings.rateLimitCooldown}
                  onChange={(_, value) => setSettings({ ...settings, rateLimitCooldown: value })}
                  min={1}
                  max={3600}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
                <Text fontSize="sm" color="gray.500" mt={1}>
                  Default cooldown period when rate limit is hit (if not specified by API)


              <FormControl mb={4}>
                <FormLabel>Key Rotation Delay (seconds)</FormLabel>
                <NumberInput
                  value={settings.keyRotationDelaySeconds}
                  onChange={(_, value) => setSettings({ ...settings, keyRotationDelaySeconds: value })}
                  min={0} // Allow 0 for no delay
                  max={300} // Set a reasonable max, e.g., 5 minutes
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
                <Text fontSize="sm" color="gray.500" mt={1}>
                  Delay after a key hits rate limit before trying the next key.
                </Text>
              </FormControl>
                </Text>
              </FormControl>
            </CardBody>
          </Card>

          <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="lg" shadow="sm">
            <CardHeader>
              <Heading size="md">System Settings</Heading>
            </CardHeader>
            <Divider borderColor={borderColor} />
            <CardBody>
              <FormControl mb={4}>
                <FormLabel>Log Retention (days)</FormLabel>
                <NumberInput
                  value={settings.logRetentionDays}
                  onChange={(_, value) => setSettings({ ...settings, logRetentionDays: value })}
                  min={1}
                  max={90}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
                <Text fontSize="sm" color="gray.500" mt={1}>
                  Number of days to keep request/error logs before manual cleanup
                </Text>
              </FormControl>

              <FormControl display="flex" alignItems="center" mb={4}>
                <FormLabel mb="0">Dark Mode</FormLabel>
                <Switch 
                  isChecked={colorMode === 'dark'}
                  onChange={toggleColorMode}
                />
             </FormControl>

             {/* Add Cleanup Button */}
             <Flex direction="column" mt={4}>
               <Button
                 colorScheme="red"
                 variant="outline"
                 onClick={handleCleanupLogs}
                 isLoading={isCleaning}
                 loadingText="Cleaning..."
                 size="sm"
               >
                 Cleanup Logs Now
               </Button>
               {cleanupResult && (
                 <Text fontSize="sm" color={cleanupResult.startsWith('Error:') ? 'red.500' : 'green.500'} mt={2}>
                   {cleanupResult}
                 </Text>
               )}
                <Text fontSize="xs" color="gray.500" mt={1}>
                 Deletes log files older than the configured retention period.
               </Text>
             </Flex>

           </CardBody>
         </Card>
       </SimpleGrid>

        <Flex justify="flex-end" mt={6}>
          <Button
            leftIcon={<FiSave />}
            colorScheme="blue"
            onClick={handleSaveSettings}
            isLoading={isSaving}
            loadingText="Saving..."
          >
            Save Settings
          </Button>
        </Flex>
      {/* Removed GridItem */}
    </AppLayout>
  );
}
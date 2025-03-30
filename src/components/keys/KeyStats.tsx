'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Skeleton,
  Text,
  useColorModeValue,
  Flex,
  Button,
  IconButton,
  Tooltip,
  HStack,
  useToast,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
  Switch,
  // Add NumberInput components
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
} from '@chakra-ui/react';
import { FiRefreshCw, FiTrash2, FiEdit2 } from 'react-icons/fi'; // Add FiEdit2
import { useRef } from 'react';
// Import modal components for editing
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Input,
} from '@chakra-ui/react';

interface ApiKey {
  _id: string;
  key: string;
  name?: string;
  isActive: boolean;
  lastUsed: string | null;
  rateLimitResetAt: string | null; // Global rate limit reset time
  failureCount: number;
  requestCount: number; // Total requests
  // New fields for daily rate limiting
  dailyRateLimit?: number | null;
  dailyRequestsUsed: number;
  lastResetDate: string | null; // We might not display this, but it's good to have
  isDisabledByRateLimit: boolean;
}

export default function KeyStats() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState<{[key: string]: boolean}>({});
  // Removed dailyRequests state as it's now part of the ApiKey object
  // State for Delete confirmation
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const cancelRefDelete = useRef<HTMLButtonElement>(null); // Rename ref for clarity
  const toast = useToast();
  // State for Rate Limit Override confirmation
  const { isOpen: isWarnOpen, onOpen: onWarnOpen, onClose: onWarnClose } = useDisclosure();
  const cancelRefWarn = useRef<HTMLButtonElement>(null); // Separate ref for warning dialog
  const [keyToToggle, setKeyToToggle] = useState<string | null>(null); // Store key ID for warning confirmation

  // State for Edit modal
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [editRateLimitValue, setEditRateLimitValue] = useState<string>(''); // Store as string for input flexibility
  const [isSavingChanges, setIsSavingChanges] = useState(false); // Renamed state

  const tableBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  
  // Removed getCurrentDate as fetchDailyRequests is removed

  const fetchKeys = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/keys');
      if (!response.ok) {
        throw new Error(`Error fetching keys: ${response.statusText}`);
      }
      const data = await response.json();
      setKeys(data);
    } catch (error) {
      console.error('Error fetching keys:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch API keys',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Removed fetchDailyRequests function

  // Fetch keys on mount
  useEffect(() => {
    fetchKeys();
  }, []);

  // Removed useEffect hook for fetchDailyRequests

  // Refresh keys data
  const refreshData = () => {
    fetchKeys();
  };

  // Function to get status badge
  const getStatusBadge = (key: ApiKey) => {
    // Order of checks matters: Disabled > Daily Limited > Globally Limited > Active
    if (!key.isActive) {
      return <Badge colorScheme="gray">Disabled</Badge>;
    }
    if (key.isDisabledByRateLimit) {
      return <Badge colorScheme="orange">Daily Limited</Badge>; // New status
    }
    if (key.rateLimitResetAt && new Date(key.rateLimitResetAt) > new Date()) {
      return <Badge colorScheme="yellow">Rate Limited</Badge>; // Global limit
    }
    return <Badge colorScheme="green">Active</Badge>;
  };

  // Function to format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Function to delete a key
  const handleDeleteKey = async () => {
    if (!selectedKeyId) return;
    
    try {
      const response = await fetch(`/api/admin/keys/${selectedKeyId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete key');
      }
      
      toast({
        title: 'Success',
        description: 'API key deleted successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      
      // Refresh the keys list
      fetchKeys();
    } catch (error) {
      console.error('Error deleting key:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete API key',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      onDeleteClose();
      setSelectedKeyId(null); // Clear selected key ID after closing
    }
  };

  // Extracted API call logic for toggling
  const proceedWithToggle = async (keyId: string) => {
    setIsToggling(prev => ({ ...prev, [keyId]: true }));
    let success = false;
    try {
      const response = await fetch(`/api/admin/keys/${keyId}`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        throw new Error('Failed to update key status');
      }

      const data = await response.json();
      success = true; // Mark as success before potential fetchKeys error

      toast({
        title: 'Success',
        description: `API key status updated successfully.`, // Simplified message
        status: 'success',
        duration: 3000,
        isClosable: true,
      });

      // Refresh the keys list
      fetchKeys();

    } catch (error) {
      console.error('Error toggling key status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update API key status',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsToggling(prev => ({ ...prev, [keyId]: false }));
      onWarnClose(); // Close warning dialog if open
      setKeyToToggle(null); // Clear the key ID
    }
  };

  // Function to handle the toggle action, potentially showing a warning
  const handleToggleKey = (keyId: string, currentStatus: boolean, isDisabledByRateLimit: boolean) => {
    // Check if we are trying to ENABLE a key that was DISABLED BY RATE LIMIT
    if (!currentStatus && isDisabledByRateLimit) {
      setKeyToToggle(keyId); // Store the key ID we want to toggle
      onWarnOpen(); // Open the warning dialog
    } else {
      // Otherwise, proceed directly with the toggle
      proceedWithToggle(keyId);
    }
  };

  // Function to handle opening the edit modal
  const handleOpenEditModal = (key: ApiKey) => {
    setEditingKey(key);
    setEditNameValue(key.name || '');
    // Pre-fill rate limit, handle null/undefined by setting to empty string for the input
    setEditRateLimitValue(key.dailyRateLimit?.toString() ?? '');
    onEditOpen();
  };

  // Function to save the edited changes (name and rate limit)
  const handleSaveChanges = async () => {
    if (!editingKey) return;
    setIsSavingChanges(true);

    // --- Input Validation ---
    let rateLimitToSend: number | null = null;
    if (editRateLimitValue.trim() === '') {
      rateLimitToSend = null; // Empty input means no limit
    } else {
      const parsedLimit = parseInt(editRateLimitValue, 10);
      if (isNaN(parsedLimit) || parsedLimit < 0) {
        toast({
          title: 'Invalid Input',
          description: 'Daily Rate Limit must be a non-negative number or empty.',
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
        setIsSavingChanges(false);
        return; // Stop execution
      }
      rateLimitToSend = parsedLimit;
    }
    // --- End Validation ---

    try {
      const bodyToSend = {
        name: editNameValue.trim() || undefined, // Send undefined if name is empty after trimming
        dailyRateLimit: rateLimitToSend,
      };

      const response = await fetch(`/api/admin/keys/${editingKey._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyToSend),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update key');
      }

      toast({
        title: 'Success',
        description: 'API key updated successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });

      onEditClose();
      fetchKeys(); // Refresh list

    } catch (error: any) {
      console.error('Error updating key:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update API key',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSavingChanges(false);
    }
  };


  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="sm" color="gray.500">
          Showing {keys.length} API keys
        </Text>
        <Button
          size="sm"
          leftIcon={<FiRefreshCw />}
          onClick={refreshData}
          isLoading={isLoading}
        >
          Refresh
        </Button>
      </Flex>

      <Box overflowX="auto">
        <Table variant="simple" size="sm" bg={tableBg} borderWidth="1px" borderColor={borderColor} borderRadius="md">
          <Thead><Tr><Th>Name</Th><Th>API Key</Th><Th>Status</Th><Th>Last Used</Th><Th>Daily Usage / Limit</Th><Th>Requests (Total)</Th><Th>Failures</Th><Th>Enabled</Th><Th>Actions</Th></Tr></Thead>
          <Tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (<Tr key={index}><Td><Skeleton height="20px" width="100px" /></Td><Td><Skeleton height="20px" /></Td><Td><Skeleton height="20px" width="80px" /></Td><Td><Skeleton height="20px" width="150px" /></Td><Td><Skeleton height="20px" width="100px" /></Td>{/* Adjusted width for daily usage/limit */}<Td><Skeleton height="20px" width="60px" /></Td><Td><Skeleton height="20px" width="60px" /></Td><Td><Skeleton height="20px" width="60px" /></Td><Td><Skeleton height="20px" width="100px" /></Td></Tr>))
            ) : keys.length === 0 ? (
              <Tr><Td colSpan={9} textAlign="center" py={4}>No API keys found. Add a key to get started.</Td></Tr>
            ) : (
              keys.map((key) => (<Tr key={key._id}><Td>{key.name || <Text as="i" color="gray.500">N/A</Text>}</Td><Td fontFamily="mono">{`${key.key.substring(0, 10)}...${key.key.substring(key.key.length - 4)}`}</Td><Td>{getStatusBadge(key)}</Td><Td>{formatDate(key.lastUsed)}</Td><Td>{key.dailyRequestsUsed} / {(key.dailyRateLimit === null || key.dailyRateLimit === undefined) ? '∞' : key.dailyRateLimit}</Td><Td>{key.requestCount}</Td><Td>{key.failureCount}</Td><Td><Switch isChecked={key.isActive} isDisabled={isToggling[key._id]} onChange={() => handleToggleKey(key._id, key.isActive, key.isDisabledByRateLimit)} size="sm" /></Td><Td><HStack spacing={2}><Tooltip label="Edit Name & Limit"><IconButton aria-label="Edit key name and limit" icon={<FiEdit2 />} size="sm" variant="ghost" colorScheme="blue" onClick={() => handleOpenEditModal(key)} /></Tooltip><Tooltip label="Delete Key"><IconButton aria-label="Delete key" icon={<FiTrash2 />} size="sm" variant="ghost" colorScheme="red" onClick={() => { setSelectedKeyId(key._id); onDeleteOpen(); }} /></Tooltip></HStack></Td></Tr>))
            )}
          </Tbody>
        </Table>
      </Box>

      {/* Delete Confirmation Dialog */}
      {/* Delete Confirmation Dialog */}
      <AlertDialog
        isOpen={isDeleteOpen}
        leastDestructiveRef={cancelRefDelete}
        onClose={onDeleteClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete API Key
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to delete this API key? This action cannot be undone.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRefDelete} onClick={onDeleteClose}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={handleDeleteKey} ml={3}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Edit Name Modal */}
      <Modal isOpen={isEditOpen} onClose={onEditClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit API Key</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <FormControl>
              <FormLabel>Key Name</FormLabel>
              <Input
                placeholder="Enter a name for this key"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
              />
              <Text fontSize="xs" color="gray.500" mt={1}>
                Optional name to help identify the key.
              </Text>
            </FormControl>

            {/* Daily Rate Limit Input */}
            <FormControl mt={4}>
              <FormLabel>Daily Rate Limit (Requests)</FormLabel>
              <NumberInput
                value={editRateLimitValue}
                onChange={(valueAsString) => setEditRateLimitValue(valueAsString)}
                min={0} // Allow 0
                allowMouseWheel
              >
                <NumberInputField placeholder="Leave empty for no limit" />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
              <Text fontSize="xs" color="gray.500" mt={1}>
                Max requests per key per day (UTC). Leave empty or set to 0 for unlimited.
              </Text>
            </FormControl>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onEditClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleSaveChanges} // Use renamed handler
              isLoading={isSavingChanges} // Use renamed state
            >
              Save Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Rate Limit Override Warning Dialog */}
      <AlertDialog
        isOpen={isWarnOpen}
        leastDestructiveRef={cancelRefWarn}
        onClose={() => { onWarnClose(); setKeyToToggle(null); }} // Clear key ID on close
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Enable Rate Limited Key?
            </AlertDialogHeader>

            <AlertDialogBody>
              This API key was automatically disabled because it hit its daily request limit.
              Manually enabling it now will allow it to be used again today, potentially exceeding the intended limit.
              Are you sure you want to proceed?
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRefWarn} onClick={() => { onWarnClose(); setKeyToToggle(null); }}>
                Cancel
              </Button>
              <Button colorScheme="orange" onClick={() => keyToToggle && proceedWithToggle(keyToToggle)} ml={3}>
                Enable Anyway
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

    </Box>
  );
}

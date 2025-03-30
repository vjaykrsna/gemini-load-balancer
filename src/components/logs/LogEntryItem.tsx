import React from "react";
import {
  Box,
  Text,
  Badge,
  VStack,
  HStack,
  Code,
  useColorModeValue,
  Collapse, // Import Collapse for optional details
  Button,   // Import Button for toggling details
  useDisclosure // Hook for managing Collapse state
} from "@chakra-ui/react";

interface LogEntryItemProps {
  log: any; // Log object can have various shapes
}

const LogEntryItem: React.FC<LogEntryItemProps> = ({ log }) => {
  const boxBg = useColorModeValue("gray.50", "gray.700");
  const codeBg = useColorModeValue("whiteAlpha.700", "gray.800");
  const borderColor = useColorModeValue("gray.200", "gray.600");
  const { isOpen, onToggle } = useDisclosure(); // For showing/hiding raw JSON

  // Basic log data extraction
  const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : "N/A";
  const level = log.level || "info"; // Default level if not present
  const message = log.message || log.event || "No message"; // Use event for key logs if message missing

  // Determine badge color based on level
  const getLevelColor = (lvl: string) => {
    switch (lvl.toLowerCase()) {
      case "error":
        return "red";
      case "warn":
        return "yellow";
      case "info":
        return "blue";
      case "debug":
        return "purple";
      default:
        return "gray";
    }
  };

  // Extract common context/metadata fields
  const context = log.context;
  const requestId = log.requestId;
  const keyEventDetails = log.keyId ? `Key ID: ${log.keyId.substring(0, 6)}...` : null; // Example for key logs

  return (
    <Box
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="md"
      p={3} // Reduced padding
      mb={3} // Increased margin bottom
      bg={boxBg}
      shadow="sm"
    >
      <VStack align="stretch" spacing={1}>
        <HStack justify="space-between" >
          <HStack spacing={3}>
             <Badge colorScheme={getLevelColor(level)} variant="solid" fontSize="0.8em">
               {level.toUpperCase()}
             </Badge>
             <Text fontSize="sm" color="gray.500">
               {timestamp}
             </Text>
          </HStack>
          {/* Optional: Button to show raw details */}
          <Button size="xs" variant="outline" onClick={onToggle}>
            {isOpen ? "Hide Details" : "Show Details"}
          </Button>
        </HStack>

        <Text fontWeight="medium" pt={1}>{message}</Text>

        {/* Display context/metadata concisely */}
        {(context || requestId || keyEventDetails) && (
           <HStack spacing={3} wrap="wrap" pt={1}>
            {context && <Text fontSize="xs" color="gray.500">[Context: {context}]</Text>}
            {requestId && <Text fontSize="xs" color="gray.500">[Request ID: {requestId}]</Text>}
            {keyEventDetails && <Text fontSize="xs" color="gray.500">[{keyEventDetails}]</Text>}
            {/* Add other relevant fields here */}
           </HStack>
        )}

        {/* Collapsible section for raw JSON */}
        <Collapse in={isOpen} animateOpacity>
          <Code
            display="block"
            whiteSpace="pre-wrap"
            p={2}
            mt={2}
            borderRadius="sm"
            bg={codeBg}
            fontSize="xs" // Smaller font size for raw data
            maxHeight="300px"
            overflowY="auto"
          >
            {JSON.stringify(log, null, 2)}
          </Code>
        </Collapse>
      </VStack>
    </Box>
  );
};

export default LogEntryItem;
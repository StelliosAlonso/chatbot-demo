import useSpeechToText from './js/useSpeechToText';
import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from "react-markdown"
import rehypeRaw from 'rehype-raw'
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import Avatar from "@cloudscape-design/chat-components/avatar";
import LoadingBar from "@cloudscape-design/chat-components/loading-bar";
import LiveRegion from "@cloudscape-design/components/live-region";
import Box from "@cloudscape-design/components/box";
import {
  Container,
  Form,
  FormField,
  PromptInput,
  Button,
  Modal,
  SpaceBetween,
  TopNavigation
} from "@cloudscape-design/components";
import PropTypes from 'prop-types';



import * as Amplify from 'aws-amplify'
const { Auth } = Amplify;

// import * as AmplifyLib from 'aws-amplify';



/*
// IMPORTS robustos para aws-amplify (funciona con Vite)
import * as Amplify from 'aws-amplify';   // import "todo" como objeto
console.log('Amplify object present?', Boolean(Amplify));
*/

import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import './ChatComponent.css';

/**
 * Main chat interface component that handles message interaction with Bedrock agent
 * @param {Object} props - Component properties
 * @param {Object} props.user - Current authenticated user information
 * @param {Function} props.onLogout - Callback handler for logout action
 * @param {Function} props.onConfigEditorClick - Callback for configuration editor
 * @returns {JSX.Element} The chat interface
 */
const ChatComponent = ({ user, onLogout, onConfigEditorClick }) => {
  // AWS Bedrock client instance for agent communication
  const [bedrockClient, setBedrockClient] = useState(null);
  // AWS Lambda client for Strands agent communication
  const [lambdaClient, setLambdaClient] = useState(null);
  // AgentCore client for AgentCore agent communication
  const [agentCoreClient, setAgentCoreClient] = useState(null);
  // Array of chat messages in the conversation
  const [messages, setMessages] = useState([]);
  // Current message being composed by the user
  const [newMessage, setNewMessage] = useState('');
  // Unique identifier for the current chat session
  const [sessionId, setSessionId] = useState(null);
  // Reference to automatically scroll to latest messages
  const messagesEndRef = useRef(null);
  // Tracks when the AI agent is processing a response
  const [isAgentResponding, setIsAgentResponding] = useState(false);
  // Controls visibility of the clear conversation modal
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  // Name of the AI agent for display purposes
  const [agentName, setAgentName] = useState({ value: 'Agent' });
  // Tracks completed tasks and their explanation
  const [tasksCompleted, setTasksCompleted] = useState({ count: 0, latestRationale: '' });
  // Flag to determine if using Strands Agent
  const [isStrandsAgent, setIsStrandsAgent] = useState(false);
  // Flag to determine if using AgentCore Agent
  const [isAgentCoreAgent, setIsAgentCoreAgent] = useState(false);

  /**
  * Scrolls the chat window to the most recent message
  * Uses smooth scrolling behavior for better user experience
  */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  /**
 * Shows the modal for confirming conversation clearing
 */
  const handleClearData = () => {
    setShowClearDataModal(true);
  };

  /**
  Lines added for Speech to Text functionality
   */
  const { transcript, isListening, startListening, stopListening, speechRecognitionSupported } = useSpeechToText();
  console.log('Speech Recognition Supported', speechRecognitionSupported);
  useEffect(() => {
    if (transcript) {
      setNewMessage(transcript.trim());
      scrollToBottom();
    }
  }, [transcript]);


  /**
   * Handles the confirmation action for clearing conversation data
   */
  /**
   * Handles the confirmation action for clearing conversation data
   * Clears all local storage and reloads the application
   */
  const confirmClearData = () => {
    // Clear all stored data from localStorage
    localStorage.clear();
    // Reload the application to reset state
    window.location.reload();
  };

  /**
   * Creates a new chat session with a unique identifier
   * Clears existing messages and initializes storage for the new session
   * Uses timestamp as session identifier
   */
  const createNewSession = useCallback(() => {
    // Generate new session ID using current timestamp
    const newSessionId = `agentcore-session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
    // Update session state
    setSessionId(newSessionId);
    // Clear existing messages
    setMessages([]);
    // Store session information in localStorage
    localStorage.setItem('lastSessionId', newSessionId);
    localStorage.setItem(`messages_${newSessionId}`, JSON.stringify([]));
    console.log('New session created:', newSessionId);
  }, []);

  /**
   * Retrieves messages for a specific chat session from localStorage
   * @param {string} sessionId - The identifier of the session to fetch messages for
   * @returns {Array} Array of messages for the session, or empty array if none found
   */
  const fetchMessagesForSession = useCallback((sessionId) => {
    const storedMessages = localStorage.getItem(`messages_${sessionId}`);
    return storedMessages ? JSON.parse(storedMessages) : [];
  }, []);

  /**
   * Persists messages to localStorage for a specific session
   * Merges new messages with existing ones before storing
   * @param {string} sessionId - The identifier of the session to store messages for
   * @param {Array} newMessages - New messages to add to storage
   */
  const storeMessages = useCallback((sessionId, newMessages) => {
    // Retrieve existing messages for the session
    const currentMessages = fetchMessagesForSession(sessionId);
    // Merge existing and new messages
    const updatedMessages = [...currentMessages, ...newMessages];
    // Save updated message list to localStorage
    localStorage.setItem(`messages_${sessionId}`, JSON.stringify(updatedMessages));
  }, [fetchMessagesForSession]);

  /**
   * Attempts to load the last active chat session
   * Creates a new session if no existing session is found
   * Restores messages from localStorage for existing sessions
   */
  const loadExistingSession = useCallback(() => {
    // Try to get the ID of the last active session
    const lastSessionId = localStorage.getItem('lastSessionId');
    if (lastSessionId) {
      // If found, restore the session and its messages
      setSessionId(lastSessionId);
      const loadedMessages = fetchMessagesForSession(lastSessionId);
      setMessages(loadedMessages);
    } else {
      // If no existing session, create a new one
      createNewSession();
    }
  }, [createNewSession, fetchMessagesForSession]);




  // -------------------------------
  // Helper para resolver el módulo Auth (compatible v5 y v6)
  // -------------------------------
  const ensureAuthModule = async ({ timeout = 5000, interval = 200 } = {}) => {
    const start = Date.now();

    const wait = (ms) => new Promise((res) => setTimeout(res, ms));

    while (Date.now() - start < timeout) {
      try {
        // 1) Si declaraste `const { Auth } = Amplify;` y Auth ya está definido:
        if (typeof Auth !== 'undefined' && Auth && typeof Auth.currentCredentials === 'function') {
          return Auth; // objeto Auth estilo v5
        }

        // 2) Si importaste Amplify como namespace: import * as Amplify from 'aws-amplify'
        //    y Amplify.Auth está presente:
        if (typeof Amplify !== 'undefined' && Amplify && Amplify.Auth && typeof Amplify.Auth.currentCredentials === 'function') {
          return Amplify.Auth;
        }

        // 3) Intentar import dinámico (v6 modular): 'aws-amplify/auth'
        //    En v6 se exportan funciones como currentCredentials, signOut, etc.
        try {
          const authModule = await import('aws-amplify/auth');
          // Si el módulo tiene currentCredentials o signOut lo consideramos válido
          if (authModule && (typeof authModule.currentCredentials === 'function' || typeof authModule.signOut === 'function')) {
            return authModule;
          }
        } catch (e) {
          // ignore, seguiremos intentando fallbacks
        }

        // 4) Algunos bundles pueden exponer Amplify.default.Auth
        if (typeof Amplify !== 'undefined' && Amplify && Amplify.default && Amplify.default.Auth && typeof Amplify.default.Auth.currentCredentials === 'function') {
          return Amplify.default.Auth;
        }
      } catch (err) {
        // no detener el loop por errores temporales
        console.debug('ensureAuthModule check error (ignorando):', err);
      }

      // esperar un poco antes de reintentar
      await wait(interval);
    }

    // Timeout: no se encontró Auth
    throw new Error('Auth module no disponible: revisa tu import de aws-amplify / versión. Timeout alcanzado en ensureAuthModule.');
  };


  
  /**
   * Effect hook to initialize AWS Bedrock client and fetch credentials
   * Sets up the connection to AWS Bedrock service using stored configuration
   */
  useEffect(() => {
    /**
     * Fetches AWS credentials and initializes Bedrock client
     * Retrieves configuration from localStorage and establishes AWS session
     */
    const fetchCredentials = async () => {
      try {
        // Resolver el módulo Auth (ensureAuthModule debe estar definido en el archivo)
        let AuthModule;
        try {
          AuthModule = await ensureAuthModule();
          console.log('AuthModule resolved:', AuthModule);
        } catch (authErr) {
          console.error('No se pudo resolver el módulo Auth:', authErr);
          return; // abortar si no hay Auth disponible
        }
  
        // Opcional: verificar que Amplify.configure() ya se ejecutó (ConfigComponent debería marcar localStorage)
        if (localStorage.getItem('amplifyConfigured') !== '1') {
          console.warn(
            'Advertencia: Amplify.configure() parece no haberse ejecutado aún (localStorage.amplifyConfigured != 1). ' +
            'Asegúrate de ejecutar configure antes.'
          );
        }
  
        // Cargar configuración de la app desde localStorage (manejo seguro)
        let appConfig = {};
        try {
          appConfig = JSON.parse(localStorage.getItem('appConfig') || '{}');
        } catch (err) {
          console.warn('appConfig en localStorage no es un JSON válido, usando {}', err);
          appConfig = {};
        }
  
        const bedrockConfig = appConfig.bedrock || {};
        const strandsConfig = appConfig.strands || {};
        const agentCoreConfig = appConfig.agentcore || {};
  
        setIsStrandsAgent(Boolean(strandsConfig.enabled));
        setIsAgentCoreAgent(Boolean(agentCoreConfig.enabled));
  
        // Obtener credenciales temporales del usuario autenticado
        let awsCreds;
        if (AuthModule && typeof AuthModule.currentCredentials === 'function') {
          awsCreds = await AuthModule.currentCredentials();
        } else if (typeof Amplify !== 'undefined' && Amplify && Amplify.Auth && typeof Amplify.Auth.currentCredentials === 'function') {
          // fallback por si Amplify.Auth está disponible
          awsCreds = await Amplify.Auth.currentCredentials();
        } else {
          console.error('currentCredentials no disponible en el módulo Auth. Abortando inicialización de clientes.');
          return;
        }
  
        // Normalizar campos de credenciales (por si vienen en diferente forma)
        const creds = {
          accessKeyId: awsCreds.accessKeyId || awsCreds.AccessKeyId || awsCreds.identityId || undefined,
          secretAccessKey: awsCreds.secretAccessKey || awsCreds.SecretAccessKey || awsCreds.secretKey || undefined,
          sessionToken: awsCreds.sessionToken || awsCreds.SessionToken || undefined
        };
  
        // Comprobar que hubo credenciales válidas
        if (!creds.accessKeyId || !creds.secretAccessKey) {
          console.error('Credenciales AWS incompletas o inválidas:', creds);
          return;
        }
  
        // Inicializar Bedrock client si aplica (Bedrock Agent Runtime)
        if (!strandsConfig.enabled && !agentCoreConfig.enabled && bedrockConfig.region) {
          const newBedrockClient = new BedrockAgentRuntimeClient({
            region: bedrockConfig.region,
            credentials: creds
          });
          setBedrockClient(newBedrockClient);
          if (bedrockConfig.agentName) setAgentName({ value: bedrockConfig.agentName });
          console.log('Bedrock client inicializado en región', bedrockConfig.region);
        }
  
        // Inicializar Lambda client para Strands si aplica
        if (strandsConfig.enabled && strandsConfig.region && strandsConfig.lambdaArn) {
          const newLambdaClient = new LambdaClient({
            region: strandsConfig.region,
            credentials: creds
          });
          setLambdaClient(newLambdaClient);
          if (strandsConfig.agentName) setAgentName({ value: strandsConfig.agentName });
          console.log('Lambda client (Strands) inicializado en región', strandsConfig.region);
        }
  
        // Inicializar AgentCore client si aplica
        if (agentCoreConfig.enabled && agentCoreConfig.region && agentCoreConfig.agentArn) {
          const newAgentCoreClient = new BedrockAgentCoreClient({
            region: agentCoreConfig.region,
            credentials: creds
          });
          setAgentCoreClient(newAgentCoreClient);
          if (agentCoreConfig.agentName) setAgentName({ value: agentCoreConfig.agentName });
          console.log('AgentCore client inicializado en región', agentCoreConfig.region);
        }
  
      } catch (error) {
        console.error('Error fetching credentials:', error);
      }
    };
  
    fetchCredentials();
  }, []); // mantiene la dependencia vacía o la que tu diseño requiera
  

  useEffect(() => {
    if ((bedrockClient || lambdaClient || agentCoreClient) && !sessionId) {
      loadExistingSession();
    }
  }, [bedrockClient, lambdaClient, agentCoreClient, sessionId, loadExistingSession]);

  /**
   * Effect hook to scroll to latest messages
   * Triggered whenever messages array is updated
   */
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /**
   * Handles the submission of new messages to the chat
   * Sends message to Bedrock agent or Strands agent and processes response
   * @param {Event} e - Form submission event
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    // Only proceed if we have a message and active session
    if (newMessage.trim() && sessionId) {
      const appConfig = JSON.parse(localStorage.getItem('appConfig'));
      
      // Clear input field
      setNewMessage('');
      // Create message object with user information
      const userMessage = { text: newMessage, sender: user.username };
      setMessages(prevMessages => [...prevMessages, userMessage]);
      setIsAgentResponding(true); // Set to true when starting to wait for response

      try {
        let agentMessage;
        
        // Handle Bedrock Agent
        if (!isStrandsAgent && bedrockClient) {
          const bedrockConfig = appConfig.bedrock;
          // obtener credenciales para incluir en atributos si lo necesitas
          const awsCreds = await Amplify.Auth.currentCredentials();
          const sessionAttributes = {
            aws_session: {
              accessKeyId: awsCreds.accessKeyId,
              secretAccessKey: awsCreds.secretAccessKey,
              sessionToken: awsCreds.sessionToken
            }
          };


          const command = new InvokeAgentCommand({
            agentId: bedrockConfig.agentId,
            agentAliasId: bedrockConfig.agentAliasId,
            sessionId: sessionId,
            endSession: false,
            enableTrace: true,
            inputText: newMessage,
            promptSessionAttributes: sessionAttributes
          });

          let completion = "";
          const response = await bedrockClient.send(command);

          if (response.completion === undefined) {
            throw new Error("Completion is undefined");
          }

          for await (const chunkEvent of response.completion) {
            if (chunkEvent.trace) {
              console.log("Trace: ", chunkEvent.trace);
              tasksCompleted.count++;
              if (typeof (chunkEvent.trace.trace.failureTrace) !== 'undefined') {
                throw new Error(chunkEvent.trace.trace.failureTrace.failureReason);
              }

              if (chunkEvent.trace.trace.orchestrationTrace.rationale) {
                tasksCompleted.latestRationale = chunkEvent.trace.trace.orchestrationTrace.rationale.text;
                scrollToBottom();
              }
              setTasksCompleted({ ...tasksCompleted });

            } else if (chunkEvent.chunk) {
              const chunk = chunkEvent.chunk;
              const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
              completion += decodedResponse;
            }
          }

          console.log('Full completion:', completion);
          agentMessage = { text: completion, sender: agentName.value };
        } 
        // Handle Strands Agent
        else if (isStrandsAgent && lambdaClient) {
          const strandsConfig = appConfig.strands;
          
          // Prepare payload for Lambda function
          const payload = {
            query: newMessage
          };
          
          // Extract Lambda function name from ARN
          const lambdaArn = strandsConfig.lambdaArn;
          
          const command = new InvokeCommand({
            FunctionName: lambdaArn,
            Payload: JSON.stringify(payload),
            InvocationType: 'RequestResponse'
          });
          
          const response = await lambdaClient.send(command);
          
          // Process Lambda response
          const responseBody = new TextDecoder().decode(response.Payload);
          const parsedResponse = JSON.parse(responseBody);
          
          console.log('Lambda response:', parsedResponse);
          
          // Extract the response text from the Lambda result
          let responseText;
          if (parsedResponse.body) {
            const body = JSON.parse(parsedResponse.body);
            responseText = body.response;
          } else if (parsedResponse.response) {
            responseText = parsedResponse.response;
          } else {
            responseText = "Sorry, I couldn't process your request.";
          }
          
          agentMessage = { text: responseText, sender: agentName.value };
        }
        // Handle AgentCore Agent
        else if (isAgentCoreAgent && agentCoreClient) {
          const agentCoreConfig = appConfig.agentcore;
          
          const command = new InvokeAgentRuntimeCommand({
            agentRuntimeArn: agentCoreConfig.agentArn,
            runtimeSessionId: sessionId,
            payload: JSON.stringify({ prompt: newMessage })
          });

          const response = await agentCoreClient.send(command);
          
          // Handle ReadableStream response
          let responseBody = '';
          if (response.response && response.response.getReader) {
            const reader = response.response.getReader();
            const decoder = new TextDecoder();
            let done = false;
            
            while (!done) {
              const { value, done: streamDone } = await reader.read();
              done = streamDone;
              if (value) {
                responseBody += decoder.decode(value, { stream: true });
              }
            }
          } else {
            responseBody = response.response || '';
          }
          
          console.log('AgentCore raw response:', responseBody);
          
          const parsedResponse = JSON.parse(responseBody);
          const responseText = parsedResponse.result || "Sorry, I couldn't process your request.";
          agentMessage = { text: responseText, sender: agentName.value };
        } else {
          throw new Error("No agent client available");
        }

        setMessages(prevMessages => [...prevMessages, agentMessage]);
        // Store the new messages
        storeMessages(sessionId, [userMessage, agentMessage]);

      } catch (err) {
        console.error('Error invoking agent:', err);

        let errReason = "**"+String(err).toString()+"**";

        const errorMessage = { text: `An error occurred while processing your request:\n${errReason}`, sender: 'agent' };
        setMessages(prevMessages => [...prevMessages, errorMessage]);
        storeMessages(sessionId, [userMessage, errorMessage]);
      } finally {
        setIsAgentResponding(false); // Set to false when response is received
        setTasksCompleted({ count: 0, latestRationale: '' });
      }
    }
  };

  const handleLogout = async () => {
    try {
      try {
        const AuthModule = await ensureAuthModule();
        if (AuthModule && typeof AuthModule.signOut === 'function') {
          await AuthModule.signOut();
        } else if (Amplify && Amplify.Auth && typeof Amplify.Auth.signOut === 'function') {
          await Amplify.Auth.signOut();
        } else {
          console.warn('signOut no disponible en el módulo Auth');
        }
      } catch (err) {
        console.error('Error durante logout (no se resolvió Auth):', err);
      }
      onLogout();
    } catch (error) {
      console.error('Error signing out: ', error);
    }
  };

  return (
    // <ContentLayout
    //   defaultPadding
    //   header={
    <div className="chat-component">
      <Container stretch>
        <div className="chat-container">
          <TopNavigation
            identity={{
              href: "#",
              title: `Chat with ${agentName.value}`,
            }}
            utilities={
              [
                //This is the button to start a new conversation
                {
                  type: "button",
                  iconName: "add-plus",
                  title: "Start a new conversation",
                  ariaLabel: "Start a new conversation",
                  disableUtilityCollapse: true,
                  onClick: () => createNewSession()
                },
                //This is the settings handler
                {
                  type: "menu-dropdown",
                  iconName: "settings",
                  ariaLabel: "Settings",
                  title: "Settings",
                  disableUtilityCollapse: true,
                  onItemClick: ({ detail }) => {
                    switch (detail.id) {
                      case "edit-settings":
                        onConfigEditorClick();
                        break;
                      case "clear-settings":
                        handleClearData();
                        break;
                    }
                  },
                  items: [
                    {
                      id: "clear-settings",
                      type: "button",
                      iconName: "remove",
                      text: "Clear settings and local storage",
                    },
                    {
                      id: "edit-settings",
                      text: "Edit Settings",
                      iconName: "edit",
                      type: "icon-button",
                    }
                  ]
                },
                //This is the user session menu options
                {
                  type: "menu-dropdown",
                  text: user.username,
                  iconName: "user-profile",
                  title: user.username,
                  ariaLabel: "User",
                  disableUtilityCollapse: true,
                  onItemClick: ({ detail }) => {
                    switch (detail.id) {
                      case "logout":
                        handleLogout();
                        break;
                    }
                  },
                  items: [
                    {
                      id: "logout",
                      text: "Logout",
                      iconName: "exit",
                      type: "icon-button",
                    }
                  ]
                }
              ]
            }
          />
          {/* <div className="chat-header">
                <div className="header-buttons">
                </div>
              </div> */}
          <div className="messages-container scrollable">
            {messages.map((message, index) => (
              <div key={index}>
                <ChatBubble
                  ariaLabel={`${message.sender} message`}
                  type={message.sender === user.username ? "outgoing" : "incoming"}
                  avatar={
                    <Avatar
                      ariaLabel={message.sender}
                      tooltipText={message.sender}
                      color={message.sender === user.username ? "default" : "gen-ai"}
                      initials={message.sender.substring(0, 2).toUpperCase()}
                    />
                  }
                >
                  {message.text.split('\n').map((line, i) => (
                    <ReactMarkdown
                      key={'md-rendering' + i}
                      rehypePlugins={[rehypeRaw]} // Enables HTML parsing
                    >
                      {line}
                    </ReactMarkdown>
                  ))}
                </ChatBubble>
              </div>
            ))}
            <div ref={messagesEndRef} />
            {isAgentResponding && (
              <LiveRegion>
                <Box
                  margin={{ bottom: "xs", left: "l" }}
                  color="text-body-secondary"
                >
                  {!isStrandsAgent && tasksCompleted.count > 0 && (
                    <div>
                      {agentName.value} is working on your request | Tasks completed ({tasksCompleted.count})
                      <br />
                      <i>{tasksCompleted.latestRationale}</i>
                    </div>
                  )}
                  {isStrandsAgent && (
                    <div>
                      {agentName.value} is processing your request...
                    </div>
                  )}
                  <LoadingBar variant="gen-ai" />
                </Box>
              </LiveRegion>
            )}
          </div>
          <form onSubmit={handleSubmit} className="message-form">
            <Form
            >
              <FormField stretch>
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <button
                    type="button"
                    onClick={isListening ? stopListening : startListening}
                    title={isListening ? "Stop Listening" : "Start Listening"}
                    className="mic-button"
                    hidden={!speechRecognitionSupported}
                  >
                    {isListening ? (
                      <svg xmlns="http://www.w3.org/2000/svg" height="28" width="28" fill="red" viewBox="0 0 24 24">
                        <path d="M12 14q-1.25 0-2.125-.875T9 11V5q0-1.25.875-2.125T12 2q1.25 0 2.125.875T15 5v6q0 1.25-.875 2.125T12 14Zm-1 7v-3.1q-2.875-.35-4.437-2.35Q5 13.55 5 11h2q0 2.075 1.463 3.538Q9.925 16 12 16q2.075 0 3.538-1.462Q17 13.075 17 11h2q0 2.55-1.563 4.55-1.562 2-4.437 2.35V21Z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" height="28" width="28" fill="black" viewBox="0 0 24 24">
                        <path d="M12 14q-1.25 0-2.125-.875T9 11V5q0-1.25.875-2.125T12 2q1.25 0 2.125.875T15 5v6q0 1.25-.875 2.125T12 14Zm-1 7v-3.1q-2.875-.35-4.437-2.35Q5 13.55 5 11h2q0 2.075 1.463 3.538Q9.925 16 12 16q2.075 0 3.538-1.462Q17 13.075 17 11h2q0 2.55-1.563 4.55-1.562 2-4.437 2.35V21Z" />
                      </svg>
                    )}
                  </button>
                  <div style={{ flex: 1 }}>
                    <PromptInput
                      type='text'
                      value={newMessage}
                      onChange={({ detail }) => setNewMessage(detail.value)}
                      placeholder='Type your question here...'
                      actionButtonAriaLabel="Send message"
                      actionButtonIconName="send"
                    />
                  </div>
                </div>

              </FormField>
            </Form>

          </form>
          {/* Clear Data Confirmation Modal */}

          <Modal
            onDismiss={() => setShowClearDataModal(false)}
            visible={showClearDataModal}
            header="Confirm clearing data"
            footer={
              <Box float="right">
                <SpaceBetween direction="horizontal" size="xs">
                  <Button variant="link" onClick={() => setShowClearDataModal(false)}>Cancel</Button>
                  <Button variant="primary" onClick={confirmClearData}>Ok</Button>
                </SpaceBetween>
              </Box>
            }
          >
            <strong>This action cannot be undone.</strong> Configuration for this application will be deleted along with the chat history with {agentName.value}. Do you want to continue?
          </Modal>
        </div>
      </Container>

    </div>
    //   }
    // >

    // </ContentLayout>  
  );
};

ChatComponent.propTypes = {
  user: PropTypes.object.isRequired,
  onLogout: PropTypes.func.isRequired,
  onConfigEditorClick: PropTypes.func.isRequired
};

export default ChatComponent;
